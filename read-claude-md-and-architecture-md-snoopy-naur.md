# Deep Code Review — crypto-payment-service

**Scope:** deposit detection → confirmation → crediting → split → withdrawal, across BTC / ETH+EVM / TRON.
**Method:** full read of `src/` (75 files). Every finding below is cited to code I read in this session. Items I could not confirm from code are isolated in the last section rather than guessed at.
**Status:** report only — no code changed.

---

## Context

This service custodies private keys for deposit wallets and automatically sweeps incoming deposits to destination wallets supplied by an external client API. The stated priorities are money correctness and crash safety at ~3M wallets. The review found that several of the safety properties asserted in `CLAUDE.md` and `ARCHITECTURE.md` are **not implemented in the code** — most importantly private-key encryption. Those doc/reality gaps are called out explicitly because they would otherwise cause an operator to assume protection that does not exist.

---

## Executive summary — top 5 risks

| # | Risk | Severity | Core location |
|---|---|---|---|
| 1 | **Private keys are stored in plaintext and written to 30-day log files.** `AESCipherService.encrypt`/`decrypt` are never called anywhere in the codebase; TypeORM `logging: true` + a winston combined-file transport persists every wallet INSERT — including `privateKey` — to `logs/*.log`. Both docs claim AES-256-CBC at rest. | Critical | [aes.service.ts](src/common/services/aes.service.ts), [configuration.ts:21](src/infrastructure/config/configuration.ts:21), [logger.config.ts:26](src/infrastructure/config/logger.config.ts:26) |
| 2 | **Redis runs `allkeys-lru` and holds the only deposit-address allow-list.** At 3M wallets the address sets exceed the 3 GB cap and are silently evicted → monitors stop recognising deposits, permanently and without error. Also evicts the BTC pending-tx set and the BTC block checkpoint. | Critical | [docker-compose.yaml:20](docker-compose.yaml:20), [redis.service.ts:11](src/infrastructure/redis/redis.service.ts:11) |
| 3 | **No idempotency and no durable ledger anywhere in the pipeline**, combined with a WebSocket reconnect path that duplicates block listeners on every error → the same deposit is swept more than once. `txHash` is never recorded or deduplicated. | Critical | [ethMonitor.service.ts:58-65](src/infrastructure/blockchain/eth/ethMonitor.service.ts:58), [splitWithdraw.usecase.ts:51](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:51) |
| 4 | **Withdrawals silently send a different amount than the split calculated, and still report success.** All three chains clamp or reduce the amount internally (ETH balance clamp, BTC max-possible fallback, TRON unconditional −0.5 TRX); TRC20 sends report success on broadcast without checking the receipt, so an out-of-energy revert counts as a completed withdrawal. | Critical | [ethTransaction.service.ts:88](src/infrastructure/blockchain/eth/ethTransaction.service.ts:88), [btcTransaction.service.ts:82](src/infrastructure/blockchain/btc/btcTransaction.service.ts:82), [tronTransaction.service.ts:53](src/infrastructure/blockchain/tron/tronTransaction.service.ts:53), [tronTransaction.service.ts:100](src/infrastructure/blockchain/tron/tronTransaction.service.ts:100) |
| 5 | **The destination hot-wallet private key is fetched over plain HTTP per deposit**, from an endpoint with no auth, no TLS enforcement, no timeout and no response validation. The same response dictates both destination addresses and the split ratio — whoever answers that URL controls where all customer funds go. | Critical | [withdraw.service.ts:31-36](src/infrastructure/clientApi/withdraw.service.ts:31) |

---

## Pipeline map (actual code path)

### ETH / EVM — the only chain family actually started
| Stage | Location |
|---|---|
| Boot: seed Redis from Postgres, start monitor | [ethMonitor.usecase.ts:43-57](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:43) — 7 of 8 EVM chains commented out |
| Detect (native ETH): subscribe `block`, scan every tx | [ethMonitor.service.ts:77](src/infrastructure/blockchain/eth/ethMonitor.service.ts:77) → [:87-115](src/infrastructure/blockchain/eth/ethMonitor.service.ts:87) |
| Detect (USDT): ERC-20 `Transfer` event | [ethMonitor.service.ts:121-139](src/infrastructure/blockchain/eth/ethMonitor.service.ts:121) |
| **Confirm** | **none — fires on first block sight** ([:113](src/infrastructure/blockchain/eth/ethMonitor.service.ts:113)) |
| Credit | no persistence; fire-and-forget POST [ethMonitor.usecase.ts:70](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:70) |
| Queue | in-memory serial array [ethMonitor.usecase.ts:14-33](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:14) |
| Split | [splitWithdraw.usecase.ts:77](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:77) → [calculate.util.ts:10](src/common/utils/calculate.util.ts:10) |
| Send + gas top-up retry | [splitWithdraw.usecase.ts:117-160](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:117), [:247-270](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:247) |
| Sign/broadcast | [ethTransaction.service.ts:62](src/infrastructure/blockchain/eth/ethTransaction.service.ts:62) / [:125](src/infrastructure/blockchain/eth/ethTransaction.service.ts:125) |

### TRON
Boot [tronMonitor.usecase.ts:22-29](src/application/usecases/monitor-blockchain/tronMonitor.usecase.ts:22) → poll 3 s [tronMonitor.service.ts:69](src/infrastructure/blockchain/tron/tronMonitor.service.ts:69) → decode TRX [:109](src/infrastructure/blockchain/tron/tronMonitor.service.ts:109) / TRC20 [:129](src/infrastructure/blockchain/tron/tronMonitor.service.ts:129) → confirmation check [:102](src/infrastructure/blockchain/tron/tronMonitor.service.ts:102) (**no-op, see M-1**) → **no queue**, fire-and-forget [:122](src/infrastructure/blockchain/tron/tronMonitor.service.ts:122)/[:171](src/infrastructure/blockchain/tron/tronMonitor.service.ts:171) → energy rental [splitWithdraw.usecase.ts:64-74](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:64) → send [tronTransaction.service.ts:41](src/infrastructure/blockchain/tron/tronTransaction.service.ts:41)/[:84](src/infrastructure/blockchain/tron/tronTransaction.service.ts:84).

### BTC
Boot [btcMonitor.usecase.ts:22-29](src/application/usecases/monitor-blockchain/btcMonitor.usecase.ts:22) → poll 60 s [btcMonitor.service.ts:38](src/infrastructure/blockchain/btc/btcMonitor.service.ts:38) → stage txid in Redis pending set [:86](src/infrastructure/blockchain/btc/btcMonitor.service.ts:86) → confirm ≥2 [:95-110](src/infrastructure/blockchain/btc/btcMonitor.service.ts:95) → **no queue** [btcMonitor.usecase.ts:41](src/application/usecases/monitor-blockchain/btcMonitor.usecase.ts:41) → build/sign PSBT [btcTransaction.service.ts:35](src/infrastructure/blockchain/btc/btcTransaction.service.ts:35).

**Crediting stage does not exist.** `deposit.entity.ts`, `depositRepository.ts`, `deposit.controller.ts` are all 0 bytes (verified). There is no local record that a deposit occurred, was swept, or failed — only an HTTP notification to the client API.

---

## Findings by dimension

### Security

**S-1 · Critical · Private keys are never encrypted.**
[splitWithdraw.usecase.ts:35](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:35) injects `AESCipherService` but never calls it; [:79](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:79) comments "Get source wallet's encrypted private key" and then passes `wallet.privateKey` raw to `sendFunds` at [:90](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:90) and [:103](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:103). [store-wallet.usecase.ts:44](src/application/usecases/manageWallets/store-wallet.usecase.ts:44) persists the DTO as-is. A grep for `encrypt|decrypt` across `src/` returns only the class definition and DI registrations — **zero call sites**. Postgres holds plaintext keys for every managed wallet.
*Fix:* encrypt in `StoreWalletUseCase` before `createEntity`, decrypt in `SplitWithdrawUseCase` at send time; treat the existing rows as compromised and rotate. Correct `CLAUDE.md` / `ARCHITECTURE.md`, which both assert encryption at rest.

**S-2 · Critical · Private keys written to disk logs with 30-day retention.**
[configuration.ts:21](src/infrastructure/config/configuration.ts:21) sets TypeORM `logging: true`, which logs every query with parameters. [logger.config.ts:26-32](src/infrastructure/config/logger.config.ts:26) adds a `DailyRotateFile` transport at **all** levels, `maxFiles: '30d'`. Every wallet INSERT therefore writes the plaintext `privateKey` into `logs/YYYY-MM-DD-combined.log`. Compounds S-1: even after encrypting at rest, the log path leaks.
*Fix:* `logging: ['error','warn']` or a query-parameter redactor; add a winston format that scrubs `privateKey`/`mainSecret`/`privateKeySecret`; purge existing log files.

**S-3 · Critical · Hot-wallet key and fund destinations come from an unauthenticated HTTP call.**
[withdraw.service.ts:31-36](src/infrastructure/clientApi/withdraw.service.ts:31) issues `axios.get` with no auth header, no timeout, no TLS enforcement, no schema validation, and maps `mainSecret` → `mainPrivateKey`. The response fully determines `mainAddress`, `additionalAddress` and `pie`. A spoofed/compromised response redirects 100% of every deposit. The missing timeout also stalls the ETH serial queue indefinitely (head-of-line block).
*Fix:* mTLS or signed responses, `https` enforced, explicit timeout + retry budget, strict response validation (address format per chain, `0 ≤ pie ≤ 100`). Strategically, the hot-wallet key should not cross a network boundary at all — sign locally or use a signing service.

**S-4 · High · Wallet-creation endpoint is unauthenticated, unthrottled, and accepts arbitrary key material.**
[wallet.controller.ts:21](src/presentation/controllers/wallet.controller.ts:21) has `@UseGuards(ApiKeyGuard, IpWhitelistGuard)` commented out. `ThrottlerModule` is **never imported** — [app.module.ts:16-32](src/infrastructure/modules/app.module.ts:16) has no `ThrottlerModule.forRoot()` and no `APP_GUARD`, despite `@nestjs/throttler` being a dependency and `throttler: [{ttl:60000,limit:10}]` sitting unused in [configuration.ts:28](src/infrastructure/config/configuration.ts:28). Anyone who can reach the port can inject arbitrary `(address, privateKey, chain)` rows into the monitored set, unbounded, in 4 MB batches ([main.ts:22](src/main.ts:22)).
*Fix:* re-enable both guards, register `ThrottlerModule` + `APP_GUARD`, and verify the `address`↔`privateKey` correspondence server-side before accepting a wallet.

**S-5 · High · No address validation beyond loose regex; chain can be spoofed.**
[detectBlockchainNetwork.util.ts:29,34,45](src/common/utils/detectBlockchainNetwork.util.ts:29) does pure pattern matching — no EIP-55 checksum for EVM, no Base58Check for BTC or TRON. The TRON regex `^T[A-Za-z1-9]{33}$` admits `O`/`I`/`l`, which are not in the Base58 alphabet. Separately, [wallet.controller.ts:43](src/presentation/controllers/wallet.controller.ts:43) reads `if (chain !== Chain.ETH && chain !== wallet.chain)` — when the detected chain **is** ETH, any declared `wallet.chain` is accepted, so an EVM-format address can be registered as `BTC` or `TRON`. Destination addresses returned by the client API are never validated at all before being used as PSBT/tx outputs.
*Fix:* use `ethers.isAddress` (checksummed), `bitcoinjs-lib` address decode, and `TronWeb.isAddress`; validate both stored and destination addresses; make the controller check strict equality.

**S-6 · Medium · `ApiKeyGuard` weaknesses (currently moot — guard is disabled).**
[apiKey.guard.ts:31](src/common/guards/apiKey.guard.ts:31) compares signatures with `!==` (non-constant-time; use `crypto.timingSafeEqual`). [:25](src/common/guards/apiKey.guard.ts:25) only bounds the *upper* age — a future-dated `timestamp` yields a negative difference and passes indefinitely. No nonce/jti tracking, so a captured key is replayable for its full 24 h window.
*Fix:* constant-time compare, two-sided timestamp window, replay cache keyed on the signature.

**S-7 · Medium · AES construction is weak for key custody.**
[aes.service.ts:21](src/common/services/aes.service.ts:21) derives the key with a **hardcoded salt** `'salt'`, so the same passphrase always yields the same key across every deployment. AES-256-CBC is unauthenticated — an attacker with DB write access can tamper with ciphertext undetected. [:43](src/common/services/aes.service.ts:43) has no error handling or format validation on malformed input.
*Fix:* AES-256-GCM with a per-record random salt stored alongside the ciphertext, plus a KMS/HSM-managed master key. Relevant once S-1 is fixed.

**S-8 · Medium · Raw signed BTC transaction sent in a URL path.**
[btcTransaction.service.ts:126](src/infrastructure/blockchain/btc/btcTransaction.service.ts:126) does `GET /api/v2/sendtx/${txHex}`. Multi-input transactions will exceed typical 8 KB URL limits and fail silently; the signed transaction also lands in every proxy/access log along the path.
*Fix:* use the POST broadcast endpoint.

**S-9 · Low · No hot/cold separation, and no bound on automated outflow.**
Any detected deposit triggers an automatic outbound transfer with no per-address/per-hour value ceiling, no manual-approval threshold, and no circuit breaker. Combined with S-4 (anyone can register a wallet) and S-3 (the client API names the destination), there is no independent control limiting automated fund movement.
*Fix:* velocity limits and a value threshold above which a sweep requires human approval.

---

### Money accuracy

**M-1 · Critical · The whole pipeline uses JavaScript `number` for balances.**
Amounts are converted to float at detection and stay float through split and send: [ethMonitor.service.ts:109](src/infrastructure/blockchain/eth/ethMonitor.service.ts:109) `Number(ethers.formatEther(tx.value))` (18-decimal wei → float), [:128](src/infrastructure/blockchain/eth/ethMonitor.service.ts:128) USDT, [tronMonitor.service.ts:114](src/infrastructure/blockchain/tron/tronMonitor.service.ts:114) `Number(amount)/1e6`, [:157](src/infrastructure/blockchain/tron/tronMonitor.service.ts:157) `Number(amountBigInt)/1e6` (**BigInt→Number, lossy above 2^53**), [btcMonitor.service.ts:124](src/infrastructure/blockchain/btc/btcMonitor.service.ts:124) `+output.value/1e8`. The split at [calculate.util.ts:10-13](src/common/utils/calculate.util.ts:10) is float multiplication. On the way out, [ethTransaction.service.ts:69](src/infrastructure/blockchain/eth/ethTransaction.service.ts:69) `+Number(amount).toFixed(18)` and [:134](src/infrastructure/blockchain/eth/ethTransaction.service.ts:134) `toFixed(decimals)` re-quantise the already-lossy float. Wei-precision ETH amounts cannot round-trip through a double.
*Fix:* carry `bigint` (or a decimal type) in smallest units end to end; convert to display units only for logs and the client API payload. Split with integer arithmetic.

**M-2 · Critical · Split remainders are unallocated and totals can drift.**
[calculate.util.ts:10-13](src/common/utils/calculate.util.ts:10) computes both halves independently from the float total, so `mainAmount + additionalAmount !== totalAmount` in general. There is no dust/remainder policy — no side receives the rounding residue deterministically. Worse, the split is applied to the **deposit amount**, not the wallet's actual balance, while every send path independently clamps to the real balance (M-3), so the two legs are calculated from a figure that the second send may no longer be able to satisfy.
*Fix:* integer split — compute one leg, assign `remainder = total − leg` to the other; document which side absorbs dust; derive the sweep amount from the on-chain balance at send time.

**M-3 · Critical · Sends silently substitute a different amount and report success.**
Three independent instances:
- [ethTransaction.service.ts:88](src/infrastructure/blockchain/eth/ethTransaction.service.ts:88) — `if (balance < amountWei + totalGasWithBuffer) amountWei = balance - totalGasWithBuffer`. Goes **negative** when `balance < totalGasWithBuffer`. Either way the caller receives a tx hash and `withdrawAccount` reports success ([splitWithdraw.usecase.ts:133](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:133)).
- [btcTransaction.service.ts:82-90](src/infrastructure/blockchain/btc/btcTransaction.service.ts:82) — "not enough for requested amount, sending max possible", logged at `warn`, returns a hash.
- [tronTransaction.service.ts:49-53](src/infrastructure/blockchain/tron/tronTransaction.service.ts:49) — `sendTRX` **unconditionally subtracts 0.5 TRX** from the requested amount. A customer TRX withdrawal is therefore short by 0.5 TRX; with `minTrxDeposit = 1` TRX and any `pie`, the smaller leg goes negative and fails outright.
*Fix:* fail loudly on insufficient funds rather than substituting; return the actual sent amount to the caller and report *that*; move TRON's fee deduction out of the generic send path into the fee-top-up caller, which already adds `+0.5` at [splitWithdraw.usecase.ts:223](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:223).

**M-4 · Critical · TRC20 withdrawals report success on broadcast, never checking the receipt.**
[tronTransaction.service.ts:100-107](src/infrastructure/blockchain/tron/tronTransaction.service.ts:100) returns the txid straight from `.send()`. A TRC20 transfer that reverts — most likely out-of-energy, exactly the failure this pipeline is built around — is indistinguishable from success, so `withdrawAccount` logs "Withdraw completed" and the top-up-and-retry path never runs. `TronInfoService.waitForTronTxConfirmation` exists but is only used in the energy-rental branch ([splitWithdraw.usecase.ts:189](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:189)), not for the actual withdrawal — contradicting the "on-chain confirmation wait before success" row in `ARCHITECTURE.md`.
*Fix:* poll `getTransactionInfo` and require `receipt.result === 'SUCCESS'` before returning a hash. Also note [tronInfo.service.ts:73](src/infrastructure/blockchain/tron/tronInfo.service.ts:73) treats any `blockNumber` as confirmation without checking `receipt.result` — same flaw in the helper.

**M-5 · High · `pie` from the client API is never validated.**
[splitWithdraw.usecase.ts:77](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:77) passes `pie` straight into the split. `undefined` → both legs `NaN` → both `if (amount)` guards are falsy → **funds silently never move, with no report sent**. `pie > 100` → `mainAmount` negative → negative is truthy → a send is attempted with a negative amount. `pie < 0` mirrors this.
*Fix:* validate `Number.isFinite(pie) && pie >= 0 && pie <= 100` on receipt; report and abort otherwise.

**M-6 · Medium · Gas estimate is taken from the wrong wallet.**
[splitWithdraw.usecase.ts:247-252](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:247) estimates via [ethInfo.service.ts:77](src/infrastructure/blockchain/eth/ethInfo.service.ts:77)/[:110](src/infrastructure/blockchain/eth/ethInfo.service.ts:110), which construct the signer from `mainPrivateKey` and estimate a transfer *to* the source address — the opposite direction from the withdrawal that actually needs the gas. ERC-20 gas differs materially by direction (zero→nonzero balance SSTORE ≈ 20k vs ≈ 5k), so the top-up can under-fund and the single retry then fails. The `?? 0.0007` fallback is a hardcoded ETH-mainnet-shaped constant applied to all 8 EVM chains, whose native token is not ETH on BSC/Polygon/Avalanche/Fantom.
*Fix:* estimate from the source wallet for the exact outbound call; make the fallback per-chain, or fail instead of guessing.

**M-7 · Medium · TRC20 `transferFrom` is decoded with wrong offsets.**
[tronMonitor.service.ts:144](src/infrastructure/blockchain/tron/tronMonitor.service.ts:144) uses `data.slice(76,116)` for the recipient and [:149](src/infrastructure/blockchain/tron/tronMonitor.service.ts:149) reuses `data.slice(72,136)` for the amount. For `transferFrom(address,address,uint256)` the correct ABI offsets are `slice(96,136)` and `slice(136,200)` — the code currently reads a misaligned recipient and parses the *recipient word* as the amount. In practice the bad address fails the allow-list check, so **`transferFrom`-delivered USDT deposits are silently missed**. The `data.length < 136` guard at [:151](src/infrastructure/blockchain/tron/tronMonitor.service.ts:151) is also too short for `transferFrom` (needs ≥200) and is evaluated after the slices.
*Fix:* decode with a real ABI decoder; branch offsets per selector; validate length before slicing.

**M-8 · Low · `generateUniqueAmount` adds random dust and contains dead arithmetic.**
[generate.util.ts:14](src/common/utils/generate.util.ts:14) — `Date.now() % 1` is **always 0** (`Date.now()` is an integer), so only `Math.random()*0.01` contributes. Used at [splitWithdraw.usecase.ts:223](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:223), it overspends up to 0.01 TRX per fee transfer. It is correctly *not* applied to customer amounts.
*Fix:* fix or remove the `Date.now()` term; document why uniqueness is needed at all.

---

### Atomicity

**A-1 · Critical · There is no atomic unit — and no record of money movement.**
"Credit deposit + record + trigger split" does not exist as a transaction because the *record* step does not exist: `deposit.entity.ts`, `depositRepository.ts` and `deposit.controller.ts` are all 0 bytes (verified). The sequence at [ethMonitor.usecase.ts:67-72](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:67) is a fire-and-forget HTTP POST followed by an awaited sweep. A crash at any point leaves **no local evidence** the deposit was seen — recovery depends entirely on the external client API's state plus manual chain inspection.
*Fix:* add a `Deposit` table with a unique constraint on `(chain, txHash, address, vout/logIndex)` and a state machine (`detected → confirmed → sweeping → swept/failed`). Write the row **before** any outbound transfer; drive the queue from that table.

**A-2 · High · The two-leg split has no partial-failure handling.**
[splitWithdraw.usecase.ts:87-110](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:87) awaits the additional leg, then the main leg. The return value of `withdrawAccount` is **discarded** — leg 1 failing does not stop leg 2, and leg 2 failing after leg 1 succeeded leaves the wallet in a half-swept state with no compensating action or retry record. On BTC this is worse than a no-op: leg 1 spends **all** UTXOs ([btcTransaction.service.ts:59-71](src/infrastructure/blockchain/btc/btcTransaction.service.ts:59)) and leg 2 immediately re-queries `getUTXOs`, which will either return nothing (change still unconfirmed → leg 2 fails) or return the same now-spent UTXOs (→ a conflicting double-spend transaction).
*Fix:* persist per-leg state; check leg 1's result before attempting leg 2; for BTC build a **single** transaction with both outputs.

**A-3 · High · Wallet creation is fire-and-forget, so Redis and Postgres can diverge.**
[store-wallet.usecase.ts:40-45](src/application/usecases/manageWallets/store-wallet.usecase.ts:40) issues `void redisService.addAddress(...)` and `void walletRepository.createEntity(...)` without awaiting either; the method is synchronous and the controller returns `201` immediately ([wallet.controller.ts:51-61](src/presentation/controllers/wallet.controller.ts:51)). A failed DB write still leaves the address in Redis → the monitor detects deposits to an address whose key is unknown → funds are stranded. The inverse (DB ok, Redis fails) means deposits are never detected.
*Fix:* `await` both inside a transaction-like sequence, write Postgres first, return the real outcome to the caller.

**A-4 · Medium · Silent abort when the source wallet is missing.**
[splitWithdraw.usecase.ts:81-84](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:81) logs and returns **without calling `sendReport`** — the only failure branch in the file that does not notify the client API. The catch-all at [:111-114](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:111) has the same gap. Reachable in normal operation: `Wallet` has a `deleted_at` soft-delete column ([wallet.entity.ts:38](src/domain/entities/wallet.entity.ts:38)) and TypeORM's `findOne` excludes soft-deleted rows, but nothing removes the address from Redis on deletion — so a soft-deleted wallet keeps detecting deposits that can never be swept, invisibly.
*Fix:* report on both branches; remove addresses from Redis on wallet deletion.

---

### Race conditions & concurrency

**R-1 · Critical · WebSocket error handling registers two reconnects, duplicating listeners on every error.**
[ethMonitor.service.ts:58-65](src/infrastructure/blockchain/eth/ethMonitor.service.ts:58) attaches **both** `provider.on('error')` and `provider.websocket.onerror`, and each calls `reconnect()` → `start()`. A single socket failure spawns **two** new `WebSocketProvider`s, each with its own `block` listener and its own USDT contract subscription; only one is reachable via closure, so the others are never cleaned up. Every subsequent block is then scanned 2×, 4×, 8×… and each scan calls `depositCallback` independently. With no idempotency downstream (R-2), that is a duplicated withdrawal per duplicate listener. There is also no backoff or attempt cap, so a persistently failing endpoint becomes a reconnect storm.
*Fix:* single idempotent reconnect guarded by a flag, exponential backoff with jitter and a cap, and assert only one active provider per network.

**R-2 · Critical · No idempotency key anywhere in the pipeline.**
`txHash` is carried through detection and into the client-API notification ([ethMonitor.usecase.ts:70](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:70)) but is **never** used to deduplicate: it is not stored, not checked before sweeping, and not passed to `SplitWithdrawUseCase.execute` at all ([splitWithdraw.usecase.ts:51](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:51) takes only `currency/address/amount/chain`). Any re-delivery — duplicate listener (R-1), BTC overlapping polls (R-3), process restart mid-flight, or a second instance (R-5) — results in a second withdrawal.
*Fix:* a unique deposit key persisted before the sweep, checked-and-claimed atomically (unique constraint or `SET NX`).

**R-3 · High · BTC polling has no re-entrancy guard, enabling double-processing.**
[btcMonitor.service.ts:34](src/infrastructure/blockchain/btc/btcMonitor.service.ts:34) starts a 60 s `setInterval` with **no `isPolling` flag** (TRON has one at [tronMonitor.service.ts:70](src/infrastructure/blockchain/tron/tronMonitor.service.ts:70); BTC does not) and the handle is never stored or cleared. A catch-up pass over many blocks easily exceeds 60 s, so runs overlap. [:40](src/infrastructure/blockchain/btc/btcMonitor.service.ts:40) then fires `void checkPendingDeposits()` concurrently with the previous one; both can read the same txid from the pending set before either calls `removeBtcPendingTransaction` at [:108](src/infrastructure/blockchain/btc/btcMonitor.service.ts:108) → **the deposit callback fires twice for one txid**. Additionally [:118-131](src/infrastructure/blockchain/btc/btcMonitor.service.ts:118) fires once per matching *output*, so a transaction with two outputs to the same monitored address triggers two sweeps.
*Fix:* add the `isPolling` guard, store/clear the interval, claim each txid atomically (`SREM`-before-process, or a processing set), and aggregate outputs per (txid, address) before invoking the callback.

**R-4 · High · TRON has no serialisation at all.**
[tronMonitor.service.ts:122](src/infrastructure/blockchain/tron/tronMonitor.service.ts:122) and [:171](src/infrastructure/blockchain/tron/tronMonitor.service.ts:171) call `void this.depositCallback(...)` — fire-and-forget, despite the callback being typed `Promise<void>` at [:10](src/infrastructure/blockchain/tron/tronMonitor.service.ts:10) and `TronMonitorUseCase` correctly `await`ing internally ([tronMonitor.usecase.ts:42](src/application/usecases/monitor-blockchain/tronMonitor.usecase.ts:42)). Every deposit in a block starts concurrently; `lastCheckedBlock` advances at [:177](src/infrastructure/blockchain/tron/tronMonitor.service.ts:177) regardless. BTC is the same ([btcMonitor.usecase.ts:41](src/application/usecases/monitor-blockchain/btcMonitor.usecase.ts:41)). Concurrent sweeps from the shared `mainPrivateKey` fee wallet race on that wallet's nonce/balance.
*Fix:* give BTC and TRON the same serial queue as ETH, or better, a shared durable queue keyed by deposit id.

**R-5 · High · Multi-instance deployment would duplicate every sweep.**
`ecosystem.config.js` uses `exec_mode: 'cluster'` with `instances: 1`. Each instance runs its own `onModuleInit` monitors and its own in-memory queue; there is no distributed lock, leader election, or shared queue anywhere in the codebase. Raising `instances` — the natural response to load at 3M wallets — makes every instance detect and sweep the same deposit.
*Fix:* leader election or a shared broker before scaling out; document `instances: 1` as load-bearing in the meantime.

**R-6 · Medium · The `nonce` parameter is plumbed through four layers and never set.**
Threaded from [splitWithdraw.usecase.ts:25](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:25) → [:130](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:130) → [transaction.service.ts:36](src/infrastructure/blockchain/transaction/transaction.service.ts:36) → [ethTransaction.service.ts:100](src/infrastructure/blockchain/eth/ethTransaction.service.ts:100)/[:159](src/infrastructure/blockchain/eth/ethTransaction.service.ts:159), but a grep shows **no caller ever supplies it** — always `undefined`, so ethers fetches the nonce per send. Two concurrent sends from the shared fee wallet therefore read the same pending nonce and one silently replaces the other. Dead scaffolding that reads as if nonce management exists.
*Fix:* either implement a per-hot-wallet nonce allocator (serialised, with pending-tx tracking) or delete the parameter so the gap is visible.

**R-7 · Medium · Check-then-act on balance with no locking.**
[ethTransaction.service.ts:85-88](src/infrastructure/blockchain/eth/ethTransaction.service.ts:85) reads the balance then sends; [btcTransaction.service.ts:48](src/infrastructure/blockchain/btc/btcTransaction.service.ts:48) reads UTXOs then spends. No row locks, optimistic versioning, or `SELECT … FOR UPDATE` exist anywhere in the codebase (`WalletRepository` has no locking helpers). Safe today only because a single process happens to serialise ETH; not safe for BTC/TRON (R-4) or multi-instance (R-5).

---

### Fault tolerance

**F-1 · Critical · ETH/EVM has no confirmation gate; no chain has reorg handling.**
[ethMonitor.service.ts:113](src/infrastructure/blockchain/eth/ethMonitor.service.ts:113) fires the deposit callback the moment a tx appears in a block — depth 0. TRON's check at [tronMonitor.service.ts:102-103](src/infrastructure/blockchain/tron/tronMonitor.service.ts:102) is `confirmations = currentBlockNumber - blockNum + 1` against `confirmationThreshold = 1`, which is **always true** for any polled block — dead code, effectively also depth 0. Only BTC gates meaningfully (2 confirmations, itself low for value). Nothing anywhere tracks block hashes or detects a reorg, so a reorged-out deposit stays "credited" — and since the sweep is immediate and irreversible, the service will already have paid out against a deposit that no longer exists.
*Fix:* per-chain confirmation depth (e.g. ETH 12+, TRON 19/20 for irreversibility, BTC 2–6 by value), store block hash per deposit, and re-validate before sweeping.

**F-2 · Critical · No crash recovery: ETH and TRON permanently lose deposits across a restart.**
[tronMonitor.service.ts:50](src/infrastructure/blockchain/tron/tronMonitor.service.ts:50) resets `lastCheckedBlock` to the **current** block on every boot — every deposit during downtime is skipped forever. ETH has no checkpoint at all: it subscribes to new blocks only, so downtime is an unrecoverable gap. Only BTC persists progress (`last-processed-block-btc`, [btcMonitor.service.ts:33](src/infrastructure/blockchain/btc/btcMonitor.service.ts:33),[:56](src/infrastructure/blockchain/btc/btcMonitor.service.ts:56)) — and that key lives in the LRU-evictable Redis (P-1), where losing it silently resets the scanner to the tip with the same effect.
*Fix:* persist a per-chain checkpoint in Postgres, resume from it on boot, and reconcile the gap.

**F-3 · Critical · No graceful shutdown.**
`main.ts` never calls `app.enableShutdownHooks()` (grep-verified: no `enableShutdownHooks`, `SIGTERM`, `SIGINT`, or `onApplicationShutdown` anywhere in `src/`). NestJS destroy hooks — including `RedisRepository.onModuleDestroy` ([redis.repository.ts:8](src/infrastructure/redis/repository/redis.repository.ts:8)) — therefore never fire, and PM2's `kill_timeout: 4000` escalates to SIGKILL after 4 s. Every deploy drops the in-memory deposit queue and can kill a withdrawal **after broadcast but before the success path**, leaving money moved on-chain with no record anywhere (A-1).
*Fix:* `enableShutdownHooks()`, stop accepting new queue work on SIGTERM, drain in-flight tasks within the kill timeout, and raise `kill_timeout`.

**F-4 · High · Unhandled promise rejections can crash the process.**
Several `void promise` calls have no `.catch()` and no internal try/catch, so a rejection is unhandled — fatal under Node's default `--unhandled-rejections=throw`:
- [splitWithdraw.usecase.ts:73](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:73) — `getAccountResourceEnergy` has no try/catch ([tronEnergy.service.ts:261-269](src/infrastructure/blockchain/tron/tronEnergy.service.ts:261)) and the `.then()` has no `.catch()`. This is a **debug log line** that can take down the service.
- [store-wallet.usecase.ts:42,44](src/application/usecases/manageWallets/store-wallet.usecase.ts:42) — `addAddress` and `createEntity` are unguarded; a Redis or Postgres blip crashes the process.
- [btcMonitor.service.ts:40](src/infrastructure/blockchain/btc/btcMonitor.service.ts:40) — `checkPendingDeposits` has no internal try/catch.
- The `*MonitorUseCase.onModuleInit` seeding calls (`void this.redisService.addAddress(...)`) share the problem.
(`sendReport` and `notifyNewDeposit` are safe — they catch internally.)
*Fix:* `.catch()` on every fire-and-forget, plus a process-level `unhandledRejection` handler that logs rather than exits.

**F-5 · High · No RPC failover, and single-provider trust.**
One `rpcUrl`/`wssUrl` per chain in [configuration.ts:43-100](src/infrastructure/config/configuration.ts:43); a new `JsonRpcProvider` is constructed per call ([ethTransaction.service.ts:49](src/infrastructure/blockchain/eth/ethTransaction.service.ts:49), [ethInfo.service.ts:20](src/infrastructure/blockchain/eth/ethInfo.service.ts:20)) with no pooling, no timeout, no fallback and no cross-checking. BTC depends entirely on one Blockbook-style host. A malicious or compromised RPC can feed fabricated blocks/balances, and the service acts on them irreversibly.
*Fix:* `FallbackProvider` with quorum across independent providers, explicit timeouts, and reuse of provider instances.

**F-6 · Medium · `withRetry` busy-spins and misclassifies falsy results.**
[retry.util.ts:19-27](src/common/utils/retry.util.ts:19) sleeps **only in the `catch` branch** — an operation that *returns* `null` without throwing retries immediately with no delay (3 tight iterations). Any falsy-but-valid result (`0`, `false`, empty) is treated as failure. Backoff is fixed at 1 s with no jitter, and it sleeps once more after the final attempt before returning `null`.
*Fix:* delay between all attempts, exponential backoff with jitter, and distinguish "threw" from "returned falsy".

**F-7 · Medium · Poisoned entries accumulate with no dead-letter path.**
If `getTxByHash` returns `null`, [btcMonitor.service.ts:100-101](src/infrastructure/blockchain/btc/btcMonitor.service.ts:100) `continue`s and the txid stays in `btc:pending:txs` forever — unbounded growth, re-fetched every 60 s, with no attempt counter or dead-letter. Failed sweeps elsewhere are reported once and dropped entirely: no retry queue exists.
*Fix:* attempt counters with a dead-letter set and operator alerting.

**F-8 · Medium · A 20-minute blocking wait sits inside the deposit path.**
[tronInfo.service.ts:69-79](src/infrastructure/blockchain/tron/tronInfo.service.ts:69) polls up to 1200 × 1 s. Reached from `rentEnergy` ([splitWithdraw.usecase.ts:189](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:189)). `getTransactionInfo` has no try/catch inside the loop, so a transient RPC error aborts the wait entirely.
*Fix:* bound to a realistic window (TRON blocks are ~3 s), tolerate transient errors, and keep long waits off the critical path.

**F-9 · Medium · Unbounded energy spend triggered by attacker-controlled dust.**
[splitWithdraw.usecase.ts:64-74](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:64) rents 160,000 energy for **every** TRON/USDT deposit, before checking that the source wallet even exists ([:80](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:80)) and with no cost ceiling — `buyResourceUsingApiKey` ignores `estimateTrx` entirely ([tronEnergy.service.ts:238-254](src/infrastructure/blockchain/tron/tronEnergy.service.ts:238)). With `minUsdtDeposit = 0.5`, repeated 0.5 USDT deposits drain the shared Tronsave balance for far more than they are worth.
*Fix:* validate the wallet first, cap `estimateTrx` per order and per hour, and require the deposit value to exceed the rental cost.

---

### Performance & scale (3M wallets)

**P-1 · Critical · Redis LRU eviction will silently delete the address allow-list.**
`docker-compose.yaml` starts Redis with `--maxmemory 3gb --maxmemory-policy allkeys-lru`. The monitored-address sets (`{chain}:address`) are the **only** copy consulted at detection time. Compounding it, [store-wallet.usecase.ts:31-38](src/application/usecases/manageWallets/store-wallet.usecase.ts:31) duplicates every ETH wallet across all 8 `EVM_CHAINS`, so 3M ETH wallets become ~24M Redis set members (plus BTC and TRON) — comfortably past 3 GB. Once eviction starts, `addresses.includes(to)` simply returns `false`: **deposits stop being detected, silently, with no error and no alert**. `allkeys-lru` will equally evict `btc:pending:txs` (losing unconfirmed deposits) and `last-processed-block-btc` (resetting the scanner to the tip, F-2).
*Fix:* `--maxmemory-policy noeviction` for this dataset, or move the allow-list out of an evictable store; size memory to the real working set; alert on set cardinality vs. the Postgres count.

**P-2 · Critical · `SMEMBERS` of the entire address set on every block and every USDT event.**
[redis.service.ts:11-13](src/infrastructure/redis/redis.service.ts:11) → [redis.repository.ts:24-26](src/infrastructure/redis/repository/redis.repository.ts:24) is `SMEMBERS`, an O(N) command that blocks Redis's single thread. Called at [ethMonitor.service.ts:94](src/infrastructure/blockchain/eth/ethMonitor.service.ts:94) once per block, at [:125](src/infrastructure/blockchain/eth/ethMonitor.service.ts:125) **once per USDT `Transfer` event** (thousands per block on mainnet), and at [btcMonitor.service.ts:74](src/infrastructure/blockchain/btc/btcMonitor.service.ts:74),[:113](src/infrastructure/blockchain/btc/btcMonitor.service.ts:113) and [tronMonitor.service.ts:81](src/infrastructure/blockchain/tron/tronMonitor.service.ts:81). At 3M addresses each call transfers >100 MB and allocates a 3M-element array — per event. This alone makes the stated scale unreachable.
*Fix:* `SISMEMBER` (O(1)) per candidate address — the membership test is the only thing actually needed. `getAddresses()` should not exist in the hot path.

**P-3 · High · O(n) array scan per transaction on top of P-2.**
[ethMonitor.service.ts:107](src/infrastructure/blockchain/eth/ethMonitor.service.ts:107) `addresses.includes(to)` and [tronMonitor.service.ts:116](src/infrastructure/blockchain/tron/tronMonitor.service.ts:116),[:165](src/infrastructure/blockchain/tron/tronMonitor.service.ts:165) are linear scans of a 3M-element array, executed for every transaction in every block. (BTC at least builds a `Set` — [btcMonitor.service.ts:77](src/infrastructure/blockchain/btc/btcMonitor.service.ts:77) — though it rebuilds it per block.) The EVM native-ETH path is inherently per-transaction; there is no bloom/log-filter strategy for it.
*Fix:* fold into P-2 (`SISMEMBER`); for EVM, prefer `eth_getLogs` filters for token transfers and reserve full block scans for native transfers.

**P-4 · High · Boot-time full table scan, and N+1 writes on wallet creation.**
[walletRepository.ts:18-21](src/domain/repositories/walletRepository.ts:18) `getWalletsByChain` loads **every** address for a chain into memory at boot ([ethMonitor.usecase.ts:44](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:44) and the BTC/TRON equivalents). `chain` is the *second* column of the only index (`@Unique(['address','chain'])`, [wallet.entity.ts:6](src/domain/entities/wallet.entity.ts:6)), so this cannot use it — a sequential scan of ~24M rows on every boot, materialised into one array. On the write side, [store-wallet.usecase.ts:40-45](src/application/usecases/manageWallets/store-wallet.usecase.ts:40) calls `save()` once per wallet in a loop (and `save()` issues a SELECT before each INSERT), 8× amplified by EVM duplication — while `createEntities` ([walletRepository.ts:14](src/domain/repositories/walletRepository.ts:14)) exists unused for exactly this.
*Fix:* index on `chain`; stream/paginate the seed (or drop it in favour of `SISMEMBER` against a durable store); use `createEntities` / `insert` in batches.

**P-5 · Medium · Unbounded in-memory queue and per-call provider construction.**
[ethMonitor.usecase.ts:14](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:14) `depositQueue` has no size cap or backpressure — a burst or a stalled client API (S-3, no timeout) grows it without limit until OOM, and everything in it is lost on restart (F-3). Separately, a fresh `JsonRpcProvider` is constructed on **every** call ([ethTransaction.service.ts:49](src/infrastructure/blockchain/eth/ethTransaction.service.ts:49), [ethInfo.service.ts:20](src/infrastructure/blockchain/eth/ethInfo.service.ts:20)) and a fresh `TronWeb` per transaction ([tronTransaction.service.ts:25-27](src/infrastructure/blockchain/tron/tronTransaction.service.ts:25)) — no connection reuse. Postgres pool size is never configured.
*Fix:* bounded durable queue, singleton providers, explicit pool sizing.

**P-6 · Medium · BTC sweep is O(all UTXOs) with no coin selection.**
[btcTransaction.service.ts:59-71](src/infrastructure/blockchain/btc/btcTransaction.service.ts:59) adds every UTXO as an input and fetches the full raw transaction for each (`getRawTx`, one HTTP call per UTXO — N+1). Combined with the flat 1000-satoshi fee (see below) this produces oversized transactions that are underpaid.
*Fix:* coin selection targeting the required amount; batch/cache raw-tx lookups.

**P-7 · High · Hardcoded BTC fee of 1000 satoshi.**
[btcTransaction.service.ts:74](src/infrastructure/blockchain/btc/btcTransaction.service.ts:74) — a flat `fee = 1000` regardless of transaction size or network conditions. With multiple inputs (P-6) this falls below the relay minimum, so transactions are rejected or stick in the mempool indefinitely; there is no RBF/CPFP path.
*Fix:* estimate `feeRate × vsize` from a fee API with a sane floor/ceiling.

---

### Consistency & reconciliation

**C-1 · High · No reconciliation of any kind.**
There is no job, endpoint or query comparing on-chain balances against expected state — no drift detection, no sweep-completeness check, no alerting on stuck funds. `EthInfoService.getETHBalance` / `getERC20Balance` are commented out ([ethInfo.service.ts:23-57](src/infrastructure/blockchain/eth/ethInfo.service.ts:23)), and `BtcInfoService.getBTCBalance` / `TronInfoService.getTRXBalance` are defined but never called. With no deposit ledger (A-1), reconciliation is not currently possible even manually.
*Fix:* once the ledger exists, add a periodic job comparing ledger state to on-chain balances per address, alerting on drift and on wallets holding a balance with no successful sweep.

**C-2 · High · Duplicate-event handling is absent end to end.** See R-2. Every stage — detection, notification, split, send — is at-least-once with no dedup, and the notification at [ethMonitor.usecase.ts:70](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:70) is fire-and-forget, so the client API's view can silently diverge from what actually happened on-chain.

**C-3 · Low · `getWalletByAddress` can return a row from the wrong chain.**
[walletRepository.ts:23-25](src/domain/repositories/walletRepository.ts:23) queries by `address` alone. Because ETH wallets are duplicated across 8 chains ([store-wallet.usecase.ts:31-38](src/application/usecases/manageWallets/store-wallet.usecase.ts:31)), 8 rows share an address and an arbitrary one is returned. Benign today (the duplicates carry the same key) but incorrect, and it breaks as soon as per-chain key material diverges.
*Fix:* query by `(address, chain)`.

---

### Dead code, TODOs on money paths, tests, swallowed errors

**D-1 · High · Zero test coverage on the transfer/split logic.** No `*.spec.ts` files exist in the repository (verified). The untested surface includes `splitAmountByPercentage`, every `send*` implementation, the TRC20 calldata decoder, and the entire top-up-and-retry path. Given M-1 through M-8, this is where regressions become losses.
*Fix:* unit tests first for `splitAmountByPercentage` (remainder/dust invariants: legs must sum to the total), the TRC20 decoder (both selectors), and the amount-clamping branches; then integration tests against testnets/forks.

**D-2 · Medium · Dead and misleading scaffolding on money paths.** Three 0-byte files (`deposit.entity.ts`, `depositRepository.ts`, `deposit.controller.ts`) imply persistence that does not exist. The unused `nonce` parameter (R-6) implies nonce management that does not exist. `AESCipherService` is injected but unused (S-1), implying encryption that does not exist. ~120 lines of commented-out `sendAllETH`/`sendAllUSDT`/balance helpers ([ethTransaction.service.ts:171-286](src/infrastructure/blockchain/eth/ethTransaction.service.ts:171), [ethInfo.service.ts:23-67](src/infrastructure/blockchain/eth/ethInfo.service.ts:23)). Seven commented-out `start()` calls ([ethMonitor.usecase.ts:50-56](src/application/usecases/monitor-blockchain/ethMonitor.usecase.ts:50)). `ThrottlerModuleOptions` config with no `ThrottlerModule` (S-4). `buyResourceUsingPrivateKey` is unreachable. `RedisRepository.retrievalCount`/`deleteRetrievalCount`/`setWithExpiry` are unused.
*Fix:* delete or implement. Each of these currently reads as a safety control that is in fact absent.

**D-3 · Medium · Errors swallowed silently across the money path.** Every `send*` returns `null` on failure with only a log ([ethTransaction.service.ts:108](src/infrastructure/blockchain/eth/ethTransaction.service.ts:108), [:165](src/infrastructure/blockchain/eth/ethTransaction.service.ts:165), [tronTransaction.service.ts:70](src/infrastructure/blockchain/tron/tronTransaction.service.ts:70), [:108](src/infrastructure/blockchain/tron/tronTransaction.service.ts:108), [btcTransaction.service.ts:118](src/infrastructure/blockchain/btc/btcTransaction.service.ts:118)), so `withdrawAccount` cannot distinguish "insufficient gas" (retryable) from "invalid address" (never retryable) and applies the same top-up-and-retry to both. `withdrawAccount`'s bare `catch {}` at [splitWithdraw.usecase.ts:157](src/application/usecases/autoWithdraw/splitWithdraw.usecase.ts:157) discards the error object entirely. `getLatestBlockHeight` returns `0` on failure ([btcInfo.service.ts:34](src/infrastructure/blockchain/btc/btcInfo.service.ts:34)), which the caller cannot distinguish from a real height. Return values of `withdrawAccount` are discarded by the caller (A-2).
*Fix:* typed error results distinguishing retryable from terminal; never encode failure as a valid-looking value.

**D-4 · Low · Secrets risk in error logging.** `this.logger.error(msg, error)` with the full axios error ([withdraw.service.ts:39](src/infrastructure/clientApi/withdraw.service.ts:39), [deposit.service.ts:35](src/infrastructure/clientApi/deposit.service.ts:35), [report.service.ts:33](src/infrastructure/clientApi/report.service.ts:33)) serialises `error.config` — including request headers/params — and the response body, into the 30-day combined log (S-2). The `withdraw_wallets` response body is exactly where `mainSecret` lives.
*Fix:* log `error.message` and status only; add a redacting winston format.

**D-5 · Low · `synchronize: true` in production with no migrations.** [configuration.ts:20](src/infrastructure/config/configuration.ts:20) — schema auto-syncs from entities on boot against a database holding custodial key material, with no migration history or rollback. An entity rename can drop a column.
*Fix:* `synchronize: false` + TypeORM migrations.

**D-6 · Low · `swagger.json` rewritten to the working directory at boot.** [main.ts:51](src/main.ts:51) `fs.writeFileSync('./swagger.json', ...)` runs on every start; the file is also tracked in git. Fails on a read-only container filesystem, taking down boot.
*Fix:* generate at build time, or gate behind a non-production flag.

---

## Needs human verification

Items I could not settle from the code alone:

1. **Actual Redis memory footprint vs. the 3 GB cap.** P-1's severity assumes ~24M set members from EVM duplication. Confirm current `INFO memory`, `SCARD` per chain key, and whether `evicted_keys` is already non-zero in production — if it is, deposits are being missed *now*.
2. **Whether `CLIENT_API_URL` is https and network-isolated.** S-3's severity depends on it. Also unverified: whether that API authenticates *this* service, and whether `mainSecret` is a genuine hot-wallet key or a per-deposit derived key.
3. **Whether production actually runs `logging: true`.** `configuration.ts` has no env override, so it appears unconditional — but confirm the deployed config and inspect existing `logs/*.log` for plaintext keys (S-2). If present, those wallets need rotation.
4. **Whether any wallet rows are already plaintext.** S-1 says all of them, but confirm by inspecting a `privateKey` value's format (a `hex:hex` shape would indicate some rows were encrypted by an earlier version).
5. **BTC address types in use.** [btcTransaction.service.ts:40](src/infrastructure/blockchain/btc/btcTransaction.service.ts:40) derives a **p2wpkh** (`bc1…`) address from the private key, but `detectBlockchainNetwork` accepts legacy `1…` and p2sh `3…` too. If any stored BTC wallet is a non-bech32 address, the derived `fromAddress` will not match the monitored address, `getUTXOs` returns nothing, and **those deposits can never be swept**. Query the distinct address prefixes in `wallet` to confirm.
6. **Blockbook/Ankr API semantics** — whether `getUTXOs` includes unconfirmed change (bears directly on the BTC two-leg double-spend in A-2), and the provider's rate limits vs. the per-UTXO `getRawTx` fan-out (P-6).
7. **Node's unhandled-rejection mode in production.** F-4 assumes the default `throw` (crash). If PM2 or a flag overrides it to `warn`, those become silent-failure rather than crash findings.
8. **`express-basic-auth` behaviour when `SWAGGER_PASS` is unset.** [main.ts:44](src/main.ts:44) passes `users: { admin: undefined }`; there is no env validation anywhere (no Joi/class-validator schema on config). Confirm this fails closed rather than open, and whether `/swagger` is exposed publicly at all.
9. **Dependency CVE status.** I reviewed usage, not advisories — `npm audit` was not run. Worth checking `tronweb@6`, `bitcoinjs-lib@6`, `ecpair@3`, `tiny-secp256k1@2`. Note `"crypto": "^1.0.1"` in `package.json` is a **deprecated placeholder package**, not Node's built-in `crypto`; the built-in shadows it at runtime, so this is a supply-chain footgun rather than an active break — it should be removed.

---

## Suggested remediation order

1. **Stop the bleeding (hours):** Redis `noeviction` (P-1); TypeORM `logging` off + purge logs (S-2); re-enable guards + register `ThrottlerModule` (S-4); `.catch()` on the fire-and-forget calls (F-4); `enableShutdownHooks` (F-3).
2. **Close the loss paths (days):** deposit ledger with a unique key, written before any transfer (A-1, R-2, C-1); TRC20 receipt verification (M-4); remove silent amount substitution (M-3); fix the WS double-reconnect (R-1); `SISMEMBER` in the hot path (P-2/P-3).
3. **Correctness (weeks):** integer/`bigint` money end to end with a defined dust rule (M-1, M-2); real confirmation depths + reorg handling (F-1); per-chain checkpoints (F-2); encrypt keys with GCM + KMS and rotate everything (S-1, S-7); move the hot-wallet key off the HTTP path (S-3).
4. **Then scale:** durable shared queue, leader election, RPC failover, and the indexing/batching work (R-5, F-5, P-4).

Tests around `splitAmountByPercentage`, the TRC20 decoder, and the clamping branches should land alongside step 2, not after step 4.
