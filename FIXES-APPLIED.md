# Fixes Applied

Remediation of the findings in [read-claude-md-and-architecture-md-snoopy-naur.md](read-claude-md-and-architecture-md-snoopy-naur.md).

**Branch:** `fix/code-review-automation` · **Base:** `refactoring` (`b81933f`) · **51 commits**

**Validation:** after every commit — `npm run lint` (clean), `npx tsc --noEmit` (clean, including `test/`), `npx jest`. Test count went from **0** to **210** across 14 suites. `npm run build` passes.

**What was NOT verified:** nothing was run against a live Postgres, Redis, or any chain RPC. Correctness here is established by types, unit tests and review — not by executing the pipeline. The items that most need real-environment verification are listed under [Remaining macro risks](#remaining-macro-risks).

---

## Findings

| # | Finding | Severity | Files modified | Commit | Status |
|---|---|---|---|---|---|
| S-1 | Private keys never encrypted (`AESCipherService` had zero call sites) | Critical | `aes.service.ts`, `store-wallet.usecase.ts`, `splitWithdraw.usecase.ts`, `wallet.module.ts`, `configuration.ts` | `674becd` | **Fixed** |
| S-2 | Private keys written to 30-day disk logs (TypeORM `logging: true` + winston) | Critical | `redacting-typeorm.logger.ts`, `redact.util.ts`, `logger.config.ts`, `configuration.ts` | `b9387e0` | **Fixed** (see assumption A3) |
| S-3 | Hot-wallet key + destinations over unauthenticated HTTP, no timeout/validation | Critical | `clientApi.http.ts`, `withdraw.service.ts`, `deposit.service.ts`, `report.service.ts`, `validateAddress.util.ts` | `8f3e93d` | **Partially Fixed** — transport hardened; the key still crosses the network (risk R3) |
| M-1 | JS `number` for balances end to end | Critical | `money.util.ts`, all 3 monitors, all 3 tx services, `transaction.service.ts`, `ethInfo.service.ts`, `splitWithdraw.usecase.ts`, `configuration.ts` | `345fe74` | **Fixed** |
| M-2 | Split remainders unallocated; totals drift | Critical | `calculate.util.ts`, `splitWithdraw.usecase.ts` (+ spec) | `12bf239` | **Fixed** — sweep-from-balance deliberately not changed (assumption A1) |
| M-3 | Sends silently substitute a different amount and report success | Critical | `ethTransaction.service.ts`, `btcTransaction.service.ts`, `tronTransaction.service.ts`, `splitWithdraw.usecase.ts` | `e2458ce` | **Fixed** |
| M-4 | TRC20 reports success on broadcast, never checks the receipt | Critical | `tronTransaction.service.ts`, `tronInfo.service.ts`, `splitWithdraw.usecase.ts` | `10987c8` | **Fixed** |
| A-1 | No atomic unit and no record of money movement | Critical | `deposit.entity.ts`, `depositRepository.ts`, `processDeposit.usecase.ts` (+ spec), `ledger.module.ts`, 3 monitor use cases, `configuration.ts` | `ef66ae8` | **Fixed** |
| R-1 | WebSocket error registers two reconnects, duplicating listeners | Critical | `ethMonitor.service.ts` | `2fbd4a0` | **Fixed** |
| R-2 | No idempotency key anywhere | Critical | `splitWithdraw.usecase.ts`, `processDeposit.usecase.ts` | `6248bc8` (+ `ef66ae8`) | **Fixed** |
| F-1 | No confirmation gate (ETH depth 0; TRON's check was dead code) | Critical | `configuration.ts`, `ethMonitor.service.ts`, `tronMonitor.service.ts`, `btcMonitor.service.ts` | `cc94914` | **Partially Fixed** — depth enforced; no reorg re-validation before sweep (risk R2) |
| F-2 | No crash recovery; ETH/TRON lose deposits across restart | Critical | `chainCheckpoint.entity.ts`, `chainCheckpointRepository.ts`, all 3 monitors, `ledger.module.ts` | `08aed11` | **Fixed** |
| F-3 | No graceful shutdown | Critical | `main.ts`, 3 monitor use cases, `btcMonitor.service.ts`, `ecosystem.config.js` | `2deb70e` | **Fixed** |
| P-1 | Redis `allkeys-lru` silently evicts the address allow-list | Critical | `docker-compose.yaml`, `redis.service.ts`, `redis.repository.ts`, 3 monitor use cases | `82c6b25` | **Fixed** (see risk R5 on sizing) |
| P-2 | `SMEMBERS` of the whole address set per block and per event | Critical | `redis.service.ts`, `redis.repository.ts`, all 3 monitors | `a483b5f` | **Fixed** |
| P-3 | O(n) array scan per transaction | High | same as P-2 | `a483b5f` | **Fixed** |
| S-4 | Wallet endpoint unauthenticated, unthrottled, arbitrary key material | High | `wallet.controller.ts`, `app.module.ts`, `deriveAddress.util.ts` (+ spec) | `a83b6e3` | **Fixed** |
| S-5 | Loose regex validation; chain spoofable | High | `detectBlockchainNetwork.util.ts`, `validateAddress.util.ts`, `store-wallet.usecase.ts` (+ specs) | `a83b6e3`, `bb4bf58` | **Fixed** (+ extra defect E1) |
| A-2 | Two-leg split has no partial-failure handling | High | `splitWithdraw.usecase.ts`, `btcTransaction.service.ts`, `splitWithdraw.module.ts` | `5a6dfbc` | **Fixed** |
| A-3 | Wallet creation fire-and-forget; Redis/Postgres diverge | High | `store-wallet.usecase.ts`, `wallet.controller.ts` | `768d4f2` | **Fixed** |
| R-3 | BTC polling re-entrancy; per-output double-fire | High | `btcMonitor.service.ts` | `00bb4b8` | **Fixed** |
| R-4 | TRON/BTC have no serialisation | High | `serialQueue.ts` (+ spec), 3 monitor use cases | `1885adf` | **Fixed** |
| R-5 | Multi-instance duplicates every sweep | High | `leaderElection.service.ts`, `redise.module.ts`, `redis.repository.ts`, 3 monitor use cases | `91e060b` | **Fixed** (opt-in; risk R1) |
| M-5 | `pie` never validated | High | `splitWithdraw.usecase.ts` (+ `8f3e93d`, `12bf239`) | `829ac41` | **Fixed** |
| F-4 | Unhandled promise rejections can crash the process | High | `fireAndForget.util.ts`, `splitWithdraw.usecase.ts`, `tronEnergy.service.ts`, `ethMonitor.service.ts/usecase.ts`, `main.ts` | `2ccc756` | **Fixed** |
| F-5 | No RPC failover; single-provider trust | High | `evmProvider.factory.ts`, `ethInfo.service.ts`, `ethTransaction.service.ts`, modules | `c10ffc7` | **Fixed** (quorum requires configuring multiple endpoints) |
| P-4 | Boot-time full table scan; N+1 writes | High | `wallet.entity.ts`, `walletRepository.ts`, 3 monitor use cases | `89b0b17` (+ `768d4f2`) | **Fixed** |
| P-5 | Unbounded queue; per-call provider construction | Medium | `serialQueue.ts`, `evmProvider.factory.ts` | `1885adf`, `c10ffc7` | **Fixed** |
| P-7 | Hardcoded BTC fee of 1000 satoshi | High | `btcInfo.service.ts`, `btcTransaction.service.ts`, `btcFee.util.ts` (+ spec) | `565d662` | **Fixed** |
| C-1 | No reconciliation of any kind | High | `reconcileDeposits.usecase.ts`, `reconciliation.module.ts`, `ethInfo/tronInfo/btcInfo.service.ts` | `fde33e9` | **Fixed** |
| C-2 | Duplicate-event handling absent end to end | High | `deposit.entity.ts`, `depositRepository.ts`, `processDeposit.usecase.ts`, `reconcileDeposits.usecase.ts` | `4289ef0` (+ `ef66ae8`) | **Fixed** |
| D-1 | Zero test coverage on transfer/split logic | High | 14 spec files, `package.json`, `test/jest-e2e.json`, `test/app.e2e-spec.ts` | `9be3a2f` + throughout | **Partially Fixed** — 210 unit tests; no e2e (risk R6) |
| S-6 | `ApiKeyGuard`: non-constant-time compare, one-sided window, replayable | Medium | `apiKey.guard.ts`, `redis.service.ts` | `ec9f5b6` | **Fixed** |
| S-7 | Weak AES construction (hardcoded salt, unauthenticated CBC) | Medium | `aes.service.ts` (+ spec) | `03ae879` | **Fixed** — rotation still required (risk R4) |
| S-8 | Raw signed BTC transaction in a URL path | Medium | `btcTransaction.service.ts` | `a877e53` | **Fixed** |
| S-9 | No hot/cold separation, no bound on automated outflow | Low | `deposit.entity.ts`, `depositRepository.ts`, `processDeposit.usecase.ts` (+ spec), `configuration.ts` | `7ffae10` | **Partially Fixed** — limits added; no hot/cold separation (risk R3) |
| M-6 | Gas estimated from the wrong wallet, wrong direction | Medium | `ethInfo.service.ts`, `splitWithdraw.usecase.ts`, `configuration.ts` | `7e9f54c` | **Fixed** |
| M-7 | TRC20 `transferFrom` decoded with wrong offsets | Medium | `trc20.util.ts` (+ spec), `tronMonitor.service.ts` | `f88da47` | **Fixed** |
| M-8 | `generateUniqueAmount` dead arithmetic (`Date.now() % 1`) | Low | `generate.util.ts` | `345fe74` | **Fixed** (in M-1 — see assumption A2) |
| A-4 | Silent abort when the source wallet is missing | Medium | `splitWithdraw.usecase.ts`, `redis.service.ts` | `ca64022` | **Fixed** |
| R-6 | `nonce` plumbed through four layers, never set | Medium | `splitWithdraw.usecase.ts`, `transaction.service.ts`, `ethTransaction.service.ts` | `dfc89c7` | **Fixed** (deleted, per the review's preferred option) |
| R-7 | Check-then-act on balance with no locking | Medium | — | `1885adf`, `91e060b`, `ef66ae8` | **Fixed by construction** — see note below |
| F-6 | `withRetry` busy-spins; misclassifies falsy results | Medium | `retry.util.ts` (+ spec) | `fcb156c` | **Fixed** |
| F-7 | Poisoned entries accumulate; no dead-letter | Medium | `redis.service.ts`, `redis.repository.ts`, `btcMonitor.service.ts` | `e166c13` | **Fixed** |
| F-8 | 20-minute blocking wait in the deposit path | Medium | `tronInfo.service.ts` | `1939eb3` (+ `10987c8`) | **Fixed** |
| F-9 | Unbounded energy spend from attacker-controlled dust | Medium | `tronEnergy.service.ts`, `splitWithdraw.usecase.ts` | `9f19017` | **Fixed** |
| P-6 | BTC sweep is O(all UTXOs); no coin selection | Medium | `btcFee.util.ts` (+ spec), `btcTransaction.service.ts` | `7d57b34` | **Fixed** |
| D-2 | Dead/misleading scaffolding on money paths | Medium | `ethTransaction.service.ts`, `ethMonitor.usecase.ts`, `tronEnergy.service.ts`, `redis.repository.ts`, `btcInfo.service.ts`, `walletRepository.ts`, deleted `deposit.controller.ts` | `aeca00e` | **Fixed** |
| D-3 | Errors swallowed silently across the money path | Medium | `sendOutcome.util.ts` (+ spec), all 3 tx services, `transaction.service.ts`, `splitWithdraw.usecase.ts`, `btcInfo.service.ts` | `ad71b2f` | **Fixed** |
| C-3 | `getWalletByAddress` can return a row from the wrong chain | Low | `walletRepository.ts`, `splitWithdraw.usecase.ts` | `6da97ba` | **Fixed** |
| D-4 | Secrets risk in error logging | Low | `btcInfo.service.ts`, `tronMonitor.service.ts`, `splitWithdraw.usecase.ts` (+ `8f3e93d`, `a877e53`) | `d1a6300` | **Fixed** |
| D-5 | `synchronize: true` in production, no migrations | Low | `configuration.ts`, `migrations/1750000000000-InitialSchema.ts` | `3316e26` | **Partially Fixed** — migration unverified against a real DB (risk R7) |
| D-6 | `swagger.json` written to the working directory at boot | Low | `main.ts` | `adfc795` | **Fixed** |

**R-7 note.** No lock was added, because the conditions that made check-then-act unsafe were removed: `SerialQueue` gives one in-flight sweep per chain per process (R-4), the ledger's `DETECTED -> SWEEPING` compare-and-swap admits exactly one worker per deposit (A-1), and the monitor lease stops a second instance scanning (R-5). If sends are ever parallelised, row-level locking becomes necessary again.

---

## Additional defects found during remediation

Not in the review; found while doing the work.

**E1 — BTC addresses were corrupted on registration.** `StoreWalletUseCase` lowercased BTC addresses alongside EVM ones. Bitcoin base58check addresses (`1…`, `3…`) are **case-sensitive**, so lowercasing produced a different, invalid address — it could never match an incoming deposit's output address, nor the address derived from its own key at sweep time. Every legacy or P2SH BTC wallet registered this way was silently unmonitorable *and* unsweepable. Fixed in `bb4bf58`. This is the mechanism behind the review's open question #5. **Existing BTC wallet rows must be audited for lowercased base58 addresses.**

**E2 — USDT decimals were hardcoded to 6 for every EVM chain.** BSC-USD (`0x55d398…`) has **18** decimals. Sending 1 USDT on BSC with `decimals: 6` would have transferred 1e-12 of a token. Latent only because BSC monitoring was disabled. Decimals are now per-network config. Fixed in `345fe74`.

**E3 — `BlockchainTransactionService.sendFunds` fell off the end** returning `undefined` for an unsupported currency/chain pair, which the caller read as a failed send with no explanation. Now an explicit typed failure. Fixed in `ad71b2f`.

**E4 — A bare `src/…` import** in `redis.service.ts` (against the repo's `@/` convention) broke module resolution under jest. Fixed in `ef66ae8`.

---

## False positives

None of the review's findings were false. Two were **already correct in a way the review understated**, and one was **resolved differently than proposed** — recorded here for transparency rather than as disagreement:

- **M-1, TRON TRX amounts.** The review notes `Number(amount)/1e6` is lossy above 2^53, which is right — but the loss happens *upstream*: `tronweb` parses the block JSON and hands over an already-narrowed JS number, so converting to `bigint` at our boundary cannot recover precision that was destroyed before we saw it. The conversion is still worth doing (it stops the loss compounding through the split and the send) and the limitation is now documented at the call site. Fully fixing it requires parsing the raw block JSON with a bigint-aware parser.
- **R-6, the `nonce` parameter.** The review offered two options: implement a nonce allocator, or delete the parameter. Deleted — serialisation is the real mechanism now, and it should be the visible one. Reintroducing an unused parameter would not be a nonce allocator.
- **F-4, `sendReport`/`notifyNewDeposit`.** Confirmed safe as the review states; they catch internally. No change was needed to those two, only to the genuinely unguarded calls.

---

## Conservative assumptions on ambiguous money logic

Each of these was a judgement call where the review did not fully determine the answer. All were resolved by the stated hierarchy: **zero fund loss > explicit hard errors > ACID/idempotency > micro-optimisation.**

**A1 — The sweep amount stays the deposit amount, not the on-chain balance.** M-2 suggests deriving the sweep from the on-chain balance at send time. Doing so would change what is swept — and therefore the accounting already reported to the client API — from "the deposit that arrived" to "everything in the wallet". That is a product decision, not a bug fix. Instead the underlying hazard was removed: sends now fail loudly on an insufficient balance (M-3) rather than silently substituting, and reconciliation reports a source address still holding funds (C-1). A wallet with a residual balance is now *visible* rather than silently swept or silently ignored.

**A2 — `generateUniqueAmount` kept its dust, minus the dead term.** `Date.now() % 1` is provably 0, so only `Math.random() * 0.01` ever contributed. The function could not survive the bigint conversion unchanged, so M-8 was resolved early as part of M-1. The dust itself was **kept** (now explicit base-unit bounds) because its purpose — making repeated fee transfers distinguishable on-chain — is plausible and removing it is a behavioural change with no finding calling for it.

**A3 — Legacy plaintext private keys fail closed by default.** `ALLOW_LEGACY_PLAINTEXT_KEYS` defaults to **false**, so a plaintext row is refused rather than silently used. This *stalls* sweeps for un-migrated wallets — but stalling is not fund loss (the keys still exist, deposits are still detected and recorded), whereas silently operating on unencrypted keys forever is an unbounded security failure. Explicit hard error chosen over silent continuation.

**A4 — Client API wire format is additive, not breaking.** Amounts could not be represented exactly as JSON numbers, but changing the field type would break the integration. `amount` keeps its existing (lossy) numeric form and exact `amountExact` / `amountBaseUnits` / `decimals` fields are sent alongside. **The client API should migrate to the exact fields**; until it does, its view remains as lossy as before — no worse, but no better.

**A5 — Deposit notification became at-least-once.** Re-sending an unacknowledged notification can produce a duplicate at the client API. The payload carries `txHash`, so a duplicate is identifiable downstream; a lost notification is not recoverable at all. Chose the recoverable failure mode.

**A6 — Automated-outflow limits ship disabled.** Enabling them with invented thresholds would hold legitimate deposits on day one. They are opt-in with documented env vars, and a malformed value disables that control rather than halting the pipeline — a typo in an env var must not stop the money moving.

**A7 — TRON block-amount precision.** See the M-1 note above: `BigInt(Math.trunc(Number(amount)))` is the honest ceiling on what is recoverable at that boundary.

**A8 — BTC dust change is folded into the fee.** Change below 546 satoshi costs more to spend later than it holds, so it is paid to miners rather than created as an output. This is a real (tiny) value transfer away from the wallet owner, chosen because the alternative creates permanently uneconomic UTXOs.

---

## Remaining macro risks

These need a human product or infrastructure decision before deployment. **None of them is resolved by this branch.**

**R1 — Migration and rotation of existing key material.** Every private key currently in the database was stored in plaintext (S-1) and, if TypeORM query logging ever ran, was also written to `logs/*.log` with 30-day retention (S-2). Those keys must be treated as **compromised**: re-encrypting them is not sufficient — funds must be moved to freshly generated wallets. Required, in order:
1. Purge existing `logs/*.log`.
2. Deploy with `ALLOW_LEGACY_PLAINTEXT_KEYS=true`, re-encrypt every row (v1 rows are identifiable via `needsReEncryption()`).
3. Rotate: generate new wallets, sweep balances across, retire the old addresses.
4. Unset `ALLOW_LEGACY_PLAINTEXT_KEYS` so it fails closed.
   Skipping step 3 leaves keys that were once plaintext in active custodial use.

**R2 — Reorg handling is depth-only.** Confirmation depth (F-1) makes a reorg unlikely; it does not make it detectable. `blockHash`/`blockNumber` are stored so a reorg can be found after the fact, but nothing re-validates them before the irreversible sweep, and nothing reverses a sweep paid against a deposit that was later reorganised out. Whether that residual risk is acceptable at your deposit sizes is a business decision — the lever is the per-chain confirmation depth.

**R3 — The destination hot-wallet private key still crosses the network.** `GET /api/withdraw_wallets` returns `mainSecret` per deposit. The transport is now TLS-enforced, authenticated (when `CLIENT_API_KEY` is set), timed out and schema-validated (S-3), and outflow is now bounded (S-9) — but whoever controls that endpoint still controls a hot wallet key and the destination addresses. The architectural fix is to stop shipping the key: sign locally, or use a signing service. **This is the single largest remaining structural risk.**

**R4 — Key custody has no KMS/HSM.** `PRIVATE_KEY_SECRET` is an environment variable. AES-256-GCM with a per-record salt (S-7) protects against a Postgres-only compromise; it does nothing against a host compromise, because the master secret is in the same process. A KMS-managed master key is the next step.

**R5 — Redis capacity must be sized before enabling `noeviction`.** The policy change (P-1) converts silent data loss into loud write failures — strictly better, but a Redis instance that fills will now reject writes. `SISMEMBER`/`SMISMEMBER` (P-2) removed the bandwidth problem, not the memory footprint: `StoreWalletUseCase` still duplicates every ETH wallet across all 8 EVM chains, so 3M ETH wallets are still ~24M set members. **Measure the real working set and size `REDIS_MAXMEMORY` before deploying.** Reducing the EVM duplication is worth considering separately — it is the actual cause.

**R6 — No end-to-end verification.** 210 unit tests cover the money-path logic, but nothing in this branch has been run against a live Postgres, Redis or chain RPC. In particular: the Nest DI graph is only compile-checked (a missing provider is a runtime failure — one such gap was caught and fixed by inspection in A-2), and no send path has executed against a testnet. **Deploy to a testnet environment and drive a real deposit through all three chains before production.**

**R7 — The baseline migration is unverified.** `synchronize` now defaults off outside development (D-5), so the hand-written migration is what creates the schema. It has not been executed against a real Postgres. Run it against a staging database, and diff the result against what `synchronize: true` produces, before deploying with `TYPEORM_SYNCHRONIZE` unset.

**R8 — Guards fail closed and will lock out an unconfigured deployment.** `ApiKeyGuard` and `IpWhitelistGuard` are now enabled on `/wallets` (S-4). With `IP_WHITELIST` unset, the guard rejects every request. This is deliberate, but it means **`API_KEY_SECRET` and `IP_WHITELIST` must be configured before deploy** or wallet registration stops working entirely.

**R9 — Deposits can now be HELD, and nothing releases them.** S-9 adds a `HELD` state for deposits over the configured ceilings, and reconciliation reports them — but there is **no release mechanism**: no endpoint, no CLI, no runbook. If you enable the limits, build the release path first, or held deposits accumulate with no way to action them.

**R10 — `getUTXOs` semantics are still unconfirmed.** The review flagged (open question #6) whether the Blockbook provider includes unconfirmed change in `getUTXOs`. The single-transaction BTC split (A-2) removes the double-spend scenario that made this acute, and coin selection (P-6) reduces the exposure, but building a transaction from unconfirmed change can still produce an unrelayable chain. Worth confirming against the provider.

---

## Secrets

No secrets were committed. No hardcoded credentials, private keys or seeds were found in source during this pass. Test vectors in specs are well-known throwaway keys holding no funds, marked as such.

Two pre-existing exposures were addressed, both of which leaked secrets rather than embedding them: TypeORM parameter logging (S-2) and serialised axios errors carrying `mainSecret` (S-3, D-4). New configuration is parameterised through `configuration.ts` and documented in `.env.example` — no values, only names and consequences.
