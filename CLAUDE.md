# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this service does

A NestJS backend that watches multiple blockchains (TRON, BTC, ETH + EVM chains: Base, BSC, Polygon, Arbitrum, Optimism, Avalanche-C, Fantom) for incoming deposits to managed wallets, and automatically splits/withdraws funds to configured destination wallets. It manages private keys (AES-256-CBC encrypted at rest), pays gas/energy fees on behalf of source wallets, and reports results back to an external "client API".

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

There are currently no unit `*.spec.ts` files in `src/` (only the generated `test/app.e2e-spec.ts` e2e boilerplate) — do not assume test coverage exists for a module just because the pattern is wired up.

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
  - `manageWallets/` — `StoreWalletUseCase`: persists new wallets.
  - `monitor-blockchain/` — one use case per chain family (`ethMonitor`, `btcMonitor`, `tronMonitor`.usecase.ts). Each implements `OnModuleInit`, seeds Redis with known deposit addresses from Postgres on boot, starts the chain's monitor service, and on deposit events pushes work onto an in-memory queue (`depositQueue`) that is drained serially (`processQueue`) to avoid concurrent withdraw races per instance.
  - `autoWithdraw/` — `SplitWithdrawUseCase`: called after a deposit is confirmed. Fetches destination wallets + split percentage (`pie`) from the external client API, tops up gas/energy on the source wallet if needed (TRON energy rental via `TronEnergyService`, EVM gas via `EthInfoService.get*GasPriceInEth`), then sends funds to the "additional" and "main" destination addresses. Failures at each step call `ReportService.sendReport` to notify the client API rather than throwing.
- **`infrastructure/`** — everything with an external dependency:
  - `blockchain/{btc,eth,tron}/` — per-chain `*Info`, `*Monitor`, `*Transaction` services (RPC/WebSocket calls via `ethers`, `tronweb`, `bitcoinjs-lib`). `blockchain/transaction/transaction.service.ts` (`BlockchainTransactionService`) is the chain-agnostic facade use cases call to actually send funds (`sendFunds({ currency, toAddress, amount, privateKey, chain, nonce })`), dispatching to the right chain implementation.
  - `clientApi/` — HTTP client wrappers (axios) talking to the external backend configured via `CLIENT_API_URL`: `deposit.service.ts` (notify new deposit), `withdraw.service.ts` (fetch destination wallets/split), `report.service.ts` (failure reporting).
  - `redis/` — `RedisService` + `redis.repository.ts` track known deposit addresses per chain (used by monitor services to know which incoming txs are relevant) and fee-transaction hashes.
  - `database/postgresql.module.ts` — TypeORM/Postgres wiring.
  - `config/configuration.ts` — the single source of typed config (`TConfiguration`), loaded from `process.env` via `@nestjs/config`. All EVM chain RPC/WSS URLs and USDT contract addresses live in `evmNetworks`, keyed by `EvmNetwork`. Add new env vars here, not ad-hoc `process.env` reads elsewhere.
  - `modules/` — NestJS wiring only (no business logic): `app.module.ts` is the root; `modules/blockchain/*BlockhainModule` wire a chain's monitor/info/transaction services + its use case together; `modules/common/blockchainTransaction.module.ts` provides the shared `BlockchainTransactionService`.
- **`presentation/`** — `controllers/` (REST, documented with `@nestjs/swagger` decorators), `dto/`, `pipes/` (`TrimPipe` trims all string inputs globally).
- **`common/`** — cross-cutting: `guards/` (`ApiKeyGuard` validates an HMAC-signed, base64 `x-api-key` header; `IpWhitelistGuard` checks `request.ip` against `IP_WHITELIST`) — both exist but are commented out on controllers currently, `services/aes.service.ts` (`AESCipherService`, AES-256-CBC for wallet private keys), `utils/` (`detectBlockchainNetwork`, `retry.util`, `splitAmountByPercentage`, etc.), `enums/` (`Chain`, `Currency`, `Roles` — `EVM_CHAINS` is the array of chain values treated as EVM-compatible, see `isEvmNetwork`).

### Data flow for a deposit

1. A chain monitor service (`infrastructure/blockchain/{chain}/*.MonitorService`) detects an incoming tx to a known address (address set is cached in Redis) and emits it.
2. The matching `*MonitorUseCase.onModuleInit` handler enqueues the deposit onto its serial `depositQueue`.
3. The queued task calls `DepositService.notifyNewDeposit` (informs the external client API) and `SplitWithdrawUseCase.execute` (moves funds out).
4. `SplitWithdrawUseCase` asks the client API for destination wallets + split percentage, funds gas/energy if the source wallet is empty, then sends the split amounts via `BlockchainTransactionService.sendFunds`.
5. Any failure along the way is reported to the client API via `ReportService.sendReport` and logged — these flows intentionally swallow errors after reporting rather than throwing, since they run inside fire-and-forget queue tasks.

### Gotchas

- `deposit.entity.ts` and `depositRepository.ts` exist but are **empty files** — deposits are not persisted to Postgres in this codebase; only `Wallet` is a real TypeORM entity (`config/configuration.ts` → `postgres.entities: [Wallet]`).
- `deposit.controller.ts` is empty — deposit-related HTTP surface isn't implemented yet.
- `TypeOrmModuleOptions.synchronize: true` is set — schema is auto-synced from entities, there are no migrations.
- Only `Chain.ETH` monitoring is actually started in `EthMonitorUseCase.onModuleInit`; the other EVM chains (`EVM_BASE`, `EVM_BSC`, etc.) are wired in config/enums but their `ethMonitorService.start(...)` calls are commented out.
- Guards (`ApiKeyGuard`, `IpWhitelistGuard`) are defined but commented out on `WalletController` — auth is not currently enforced on that endpoint.
