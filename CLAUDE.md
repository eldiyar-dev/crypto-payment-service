# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service does

A NestJS backend that watches multiple blockchains (TRON, BTC, ETH + EVM chains: Base, BSC, Polygon, Arbitrum, Optimism, Avalanche-C, Fantom) for incoming deposits to managed wallets, and automatically splits/withdraws funds to configured destination wallets. It manages private keys (AES-256-GCM encrypted at rest, with a per-record salt), pays gas/energy fees on behalf of source wallets, and reports results back to an external "client API".

## Additional documentation

For a deeper walkthrough of the fund-movement pipeline, reliability patterns, and known gaps, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

```bash
npm run start:dev        # run with watch mode (primary dev loop)
npm run start:debug       # watch mode + --inspect-brk
npm run build             # nest build
npm run lint               # eslint --fix over src,apps,libs,test
npm run format              # prettier --write src/**/*.ts test/**/*.ts

npm run test               # unit tests (jest, rootDir=src, pattern *.spec.ts)
npm run test:watch
npm run test:cov
npm run test:e2e            # e2e tests, config test/jest-e2e.json, pattern *.e2e-spec.ts

# run a single unit test file
npx jest path/to/file.spec.ts
# run a single e2e test file
npx jest --config ./test/jest-e2e.json test/app.e2e-spec.ts
```

Unit tests live beside the code they cover (`*.spec.ts` under `src/`). Coverage is concentrated on the money path — the split, base-unit arithmetic, address/key validation, the TRC20 decoder, the deposit state machine, the serial queue, BTC fee sizing and coin selection. The `test/app.e2e-spec.ts` boilerplate is **skipped**: booting `AppModule` needs a live Postgres and Redis, so there is no working end-to-end coverage.

Docker: `docker-compose.yaml` brings up `db` (Postgres), `redis`, and `app` together; `Dockerfile` is a plain multi-step `npm install && npm run build` image. `ecosystem.config.js` is a PM2 config for running `dist/main.js` in cluster mode in production.

## Formatting/lint conventions

- No semicolons, single quotes, `printWidth: 180`, trailing commas everywhere (`.prettierrc`).
- Path alias `@/*` → `src/*` (`tsconfig.json`). Use it instead of deep relative imports.
- ESLint has type-checked rules mostly relaxed (`no-explicit-any`, `no-unsafe-*`, `no-misused-promises` are all off) — don't hold new code to stricter unsafe-type rules than the existing code follows.
- `strictNullChecks` is on but `noImplicitAny` is off.

## Architecture

Clean Architecture / Hexagonal, enforced by directory layout under `src/`:

- **`domain/`** — framework-free core: TypeORM `entities/` (`Wallet` is the only entity actually registered — see gotcha below) and repository abstractions in `repositories/` (e.g. `WalletRepository` extends TypeORM's `Repository<Wallet>` directly rather than being an interface + impl pair).
- **`application/usecases/`** — orchestration logic, grouped by feature:
  - `manageWallets/` — `StoreWalletUseCase`: encrypts key material, persists new wallets (Postgres first, awaited), then advertises them in Redis.
  - `monitor-blockchain/processDeposit.usecase.ts` — `ProcessDepositUseCase`: the single entry point from detection into the money path for all three chains. Record → claim → notify → CAS to sweeping → sweep → record outcome.
  - `reconciliation/` — `ReconcileDepositsUseCase`: periodic, read-only ledger-vs-chain check; alerts on stuck, failed or held deposits and on stranded funds.
  - `monitor-blockchain/` — one use case per chain family (`ethMonitor`, `btcMonitor`, `tronMonitor`.usecase.ts). Each implements `OnModuleInit`, seeds Redis with known deposit addresses from Postgres on boot, starts the chain's monitor service, and on deposit events pushes work onto an in-memory queue (`depositQueue`) that is drained serially (`processQueue`) to avoid concurrent withdraw races per instance.
  - `autoWithdraw/` — `SplitWithdrawUseCase`: called after a deposit is confirmed. Fetches destination wallets + split percentage (`pie`) from the external client API, tops up gas/energy on the source wallet if needed (TRON energy rental via `TronEnergyService`, EVM gas via `EthInfoService.get*GasPriceInEth`), then sends funds to the "additional" and "main" destination addresses. Failures at each step call `ReportService.sendReport` to notify the client API rather than throwing.
- **`infrastructure/`** — everything with an external dependency:
  - `blockchain/{btc,eth,tron}/` — per-chain `*Info`, `*Monitor`, `*Transaction` services (RPC/WebSocket calls via `ethers`, `tronweb`, `bitcoinjs-lib`). `blockchain/transaction/transaction.service.ts` (`BlockchainTransactionService`) is the chain-agnostic facade use cases call to actually send funds (`sendFunds({ currency, toAddress, amount, privateKey, chain, nonce })`), dispatching to the right chain implementation.
  - `clientApi/` — HTTP client wrappers (axios) talking to the external backend configured via `CLIENT_API_URL`: `deposit.service.ts` (notify new deposit), `withdraw.service.ts` (fetch destination wallets/split), `report.service.ts` (failure reporting).
  - `redis/` — `RedisService` + `redis.repository.ts` track known deposit addresses per chain and fee-transaction hashes. Membership is tested with `isKnownAddress` (SISMEMBER) or `filterKnownAddresses` (SMISMEMBER); `getAddresses()` loads the whole set and must never be used on the detection path. `leaderElection.service.ts` holds the single-writer monitor lease.
  - `database/postgresql.module.ts` — TypeORM/Postgres wiring.
  - `config/configuration.ts` — the single source of typed config (`TConfiguration`), loaded from `process.env` via `@nestjs/config`. All EVM chain RPC/WSS URLs and USDT contract addresses live in `evmNetworks`, keyed by `EvmNetwork`. Add new env vars here, not ad-hoc `process.env` reads elsewhere.
  - `modules/` — NestJS wiring only (no business logic): `app.module.ts` is the root; `modules/blockchain/*BlockhainModule` wire a chain's monitor/info/transaction services + its use case together; `modules/common/blockchainTransaction.module.ts` provides the shared `BlockchainTransactionService`.
- **`presentation/`** — `controllers/` (REST, documented with `@nestjs/swagger` decorators), `dto/`, `pipes/` (`TrimPipe` trims all string inputs globally).
- **`common/`** — cross-cutting: `guards/` (`ApiKeyGuard` validates an HMAC-signed, base64 `x-api-key` header; `IpWhitelistGuard` checks `request.ip` against `IP_WHITELIST`) — both enabled on `WalletController`, `services/aes.service.ts` (`AESCipherService`, AES-256-GCM for wallet private keys), `utils/` (`detectBlockchainNetwork`, `retry.util`, `splitAmountByPercentage`, etc.), `enums/` (`Chain`, `Currency`, `Roles` — `EVM_CHAINS` is the array of chain values treated as EVM-compatible, see `isEvmNetwork`).

### Data flow for a deposit

1. A chain monitor service (`infrastructure/blockchain/{chain}/*.MonitorService`) detects an incoming tx to a known address (address set is cached in Redis) and emits it.
2. The matching `*MonitorUseCase.onModuleInit` handler enqueues the deposit onto its serial `depositQueue`.
3. The queued task calls `DepositService.notifyNewDeposit` (informs the external client API) and `SplitWithdrawUseCase.execute` (moves funds out).
4. `SplitWithdrawUseCase` asks the client API for destination wallets + split percentage, funds gas/energy if the source wallet is empty, then sends the split amounts via `BlockchainTransactionService.sendFunds`.
5. Any failure along the way is reported to the client API via `ReportService.sendReport` and logged — these flows intentionally swallow errors after reporting rather than throwing, since they run inside fire-and-forget queue tasks.

### Money-path invariants

These are load-bearing. Breaking one is a fund-loss bug, not a style regression.

- **Amounts are `bigint` base units end to end** (wei / satoshi / SUN / token base units). A JS `number` never touches an amount. Convert with `formatBaseUnits` / `parseBaseUnits` only at the edges — logs and client-API payloads.
- **The split conserves value.** `splitAmountByPercentage` derives one leg and assigns the remainder to the other, so the legs always sum to the deposit; the main leg absorbs the rounding dust. `SplitWithdrawUseCase` asserts this at runtime.
- **Never substitute a different amount.** If a wallet cannot cover the requested send, fail and let the caller top up and retry; do not silently send less.
- **Record before moving money.** `ProcessDepositUseCase` writes the `Deposit` row, claims it atomically (`ON CONFLICT DO NOTHING` on `(chain, txHash, address, outputIndex)`), then compare-and-swaps `DETECTED -> SWEEPING`. That claim is the idempotency key — it is what stops a re-delivered deposit becoming a second withdrawal.
- **A returned tx hash means confirmed**, not broadcast. TRON waits for `receipt.result === 'SUCCESS'`.
- **Sweeps are serialised** per chain (`SerialQueue`): concurrent sweeps race on the shared fee wallet's nonce and balance.

### Gotchas

- `Deposit` and `ChainCheckpoint` are real entities alongside `Wallet`. Deposits are persisted; the ledger is what makes recovery and reconciliation possible.
- `synchronize` defaults to **off** outside `NODE_ENV=development`; migrations in `infrastructure/database/migrations/` run instead. The baseline migration is hand-written and has not been executed against a real Postgres — verify it on staging.
- Which EVM chains are monitored is `ENABLED_EVM_NETWORKS` (default `ETH`), not a code edit.
- `ApiKeyGuard` and `IpWhitelistGuard` are **enabled** on `WalletController`. Both fail closed: without `API_KEY_SECRET` and `IP_WHITELIST` the endpoint rejects everything.
- Redis must run with `--maxmemory-policy noeviction`. The `{chain}:address` sets are the allow-list consulted at detection time; evicting a member makes deposits to that address silently undetectable.
- PM2 `instances: 1` is load-bearing unless `MONITOR_LEADER_ELECTION=true`.
- Private keys are encrypted with AES-256-GCM (`v2:` envelope). Legacy `v1:` CBC rows still decrypt; plaintext rows are refused unless `ALLOW_LEGACY_PLAINTEXT_KEYS=true`.
