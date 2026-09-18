# Conduit — Internal Security Audit

**Audited:** 2026-09-17 · **Remediated:** 2026-09-18
**Audited at commit:** `659edbb` (branch `main`)
**Scope:** `contracts/src/*.sol` (4 contracts), `stellar/swap_and_deliver` (Soroban), `frontend/` (Next.js app, API routes, relayer), secret handling, dependencies
**Method:** Manual line-by-line review of all first-party code, git history scan for secrets, dependency advisory audit.

| Severity | Found | Fixed | Needs your action |
|---|---|---|---|
| Critical | 4 | 4 | — |
| High | 4 | 4 | — |
| Medium | 8 | 7 | 1 (M-4) |
| Low | 9 | 8 | 1 (L-8, partial) |

**Verification after remediation:** 34/34 Solidity tests pass (`forge test`), 8/8 Soroban tests pass (`cargo test`), the Soroban release wasm builds, the Next.js production build and TypeScript check are clean, and `pnpm audit` reports **0 critical** (was 3).

> ⚠️ **The contract fixes are in source only.** All four Solidity contracts and the Soroban contract must be redeployed for any of it to take effect on-chain, and the Soroban contract's `init` signature has changed — see **Deployment actions** at the end.

---

## Summary

The EVM contracts were the strongest part of the system: parsing the hook out of the attested CCTP message is the right design, and it genuinely prevented a relayer from redirecting funds. The serious problems were concentrated in three places — the Soroban contract (no access control, and it did not verify what it was told), the slippage parameters (hardcoded placeholders, not real floors), and the hosting surface (an RCE-vulnerable Next.js version sharing a process with the relayer's private key).

Two findings turned out to be worse than they first looked, and one piece of good news emerged during remediation:

- **H-2** meant anyone could permanently brick every relay on a chain for one µUSDC.
- **The Soroban test suite had never run.** `mod test;` was never declared in `lib.rs`, so the file was dead code, and `cargo test` could not compile anyway because of an upstream dependency conflict. Both are now fixed, so the contract carrying the most security-critical logic has a working suite for the first time.

---

## Critical

### C-1 — Soroban `init()` was unauthenticated and re-callable — **FIXED**

`stellar/.../src/lib.rs`

`init` had no `require_auth`, no admin and no already-initialized guard. Anyone could call it at any time and repoint `MessageTransmitter`, `Usdc`, `Xlm` and `Pair` at contracts they controlled — a complete takeover for the price of one transaction. An attacker supplies a fake transmitter whose `is_nonce_used` always returns true, plus their own pair, and every check in the contract is then answered by their own code.

**Fix:** `init` now takes an `admin`, requires its authorization, and returns `AlreadyInitialized` if called twice. Reconfiguration moved to an admin-only `set_config`, with `set_admin` for handover. A zero or unsatisfiable signature threshold is rejected (`InvalidConfig`).
**Tests:** `test_init_cannot_be_called_twice`, `test_invalid_threshold_rejected`.

### C-2 — Soroban delivery never bound the message to its attestation — **FIXED**

The contract did not verify Circle's attestation. It read a `nonce` out of the caller-supplied buffer and checked `is_nonce_used(nonce)`. That proved *some* nonce had been consumed and nothing whatsoever about the `amount` and `recipient` read from those same unverified bytes.

An attacker could take any nonce already consumed on Stellar — any CCTP transfer by anyone, since the `Delivered` map only blocked nonces *this contract* had processed — fabricate a message carrying that nonce with `amount` set to the contract's full balance and their own address as recipient, and be paid. The design is inherently two-transaction (`mint_and_forward`, then `swap_and_deliver`), so there is always a window with real user USDC sitting in the contract; the attacker simply front-runs the relayer's second step.

**Fix:** the contract now verifies the attestation itself, over the exact bytes it is handed — threshold ECDSA over `keccak256(message)`, each signature recovered to an Ethereum-style address via `secp256k1_recover`, checked against a configured attester set, and required to be strictly increasing so one attester cannot be counted twice. Nothing in the message is believed until that passes. The nonce check remains as a liveness check (confirming the mint really landed) rather than as a substitute for authenticity. The relayer and the e2e script now pass the attestation through.
**Tests:** `test_forged_message_with_used_nonce_is_rejected`, `test_threshold_and_duplicate_signatures_rejected`.

### C-3 — Slippage floors were hardcoded placeholders on every route — **FIXED**

| Location | Parameter | Was |
|---|---|---|
| `useSwap.ts` (V3 source) | `minUsdcOut` | `parseUnits("2", 6)` — a flat 2 USDC |
| `useSwap.ts` (V2 source) | `minUsdcOut` | `1n` |
| `useSwap.ts` (destination hook) | `minOut` | `1n` |
| `relayer.ts` (Stellar) | `min_out` | `1n` |

The V3 source floor was the worst: a constant, unrelated to the amount. A user swapping 1 ETH signed a transaction that accepted 2 USDC as a valid outcome. The destination floors of `1` accepted any non-zero output. Both swaps are sandwichable by any mempool observer, and the destination swap especially so — relaying is permissionless and the hook carrying `minOut` is public in the attested message well before the swap executes.

**Fix:** a single `SLIPPAGE_BPS` (1%) and `applySlippage()` in `useSwap.ts`, applied to all four sites, derived from the live quote. `swap()` now refuses to sign while a quote is still loading rather than falling back to a placeholder. The quoting machinery already existed and was already used correctly on the Stellar-source path — it simply wasn't wired into the others.

### C-4 — Next.js RCE in the process holding the relayer keys — **FIXED**

`next` was pinned to `16.2.12`; the "Unauthenticated Remote Code Execution" advisories cover `>=16.0.0 <16.3.3`. `RELAYER_PRIVATE_KEY`, `STELLAR_RELAYER_SECRET` and `DATABASE_URL` are all read from `process.env` in that same runtime, so an RCE was a direct compromise of both relayer wallets and the database.

**Fix:** upgraded to `next@16.3.5`. See also M-4, which is the structural half of this problem.

---

## High

### H-1 — `relayAndExecute` was an arbitrary-call primitive — **FIXED**

`ReceiveAndSwap.sol` / `ReceiveAndSwapUniV2.sol` called `target.call(data)` with both values taken from the attested message. Attestation stops a *relayer* substituting instructions — that part worked — but anyone can originate their own CCTP burn naming this contract as `mintRecipient` with any hookData they like, for the cost of a minimal burn. The contract would then call any address with any calldata, as itself.

**Fix:** `_isPermittedHook` requires `target == address(this)` and the selector to be one of the contract's own swap entry points. Anything else is refunded rather than executed, and emits `HookRejected`.
**Tests:** `test_foreignHookTarget_isRejectedAndRefunded` (both executors) — attempts to make the executor call `USDC.transfer(attacker, …)` and asserts the attacker receives nothing.

### H-2 — One µUSDC donation permanently bricked every relay — **FIXED**

`remaining = usdc.balanceOf(address(this)) - balanceBefore` ran after the hook. Every production hook uses `amountIn = 0` ("swap my entire balance"), which included anything already resting in the contract. So with `balanceBefore > 0` the swap consumed `minted + balanceBefore`, the subtraction underflowed, and Solidity 0.8 reverted the whole transaction — for everyone, permanently, at a cost to the attacker of one micro-dollar. The owner could unstick it with `rescueToken`; the attacker could immediately redo it.

`test_amountInZero_swapsFullMintedBalance` passed only because the test contract started with a zero balance.

**Fix:** all amounts are now tracked explicitly in a `_pendingAmount` budget, decremented by `_claim()` as the hook spends, and clamped so a hook can never reach the contract's resting balance. No relay path reads `balanceOf` deltas any more.
**Tests:** `test_donatedUsdc_doesNotBlockRelay` (both executors) — donates 1 µUSDC, asserts the relay still delivers the full swap and the donation is left untouched.

> A regression I introduced while fixing this, and caught in review: tracking only the hook's budget meant a partial `forwardAmount` no longer swept the remainder of the minted USDC. The sweep now returns `minted - spent`, restoring the original semantics with exact accounting. `test_partialForwardAmount_sweepsRemainder` covers it.

### H-3 — `POST /api/swaps` made the relayer spend gas on demand — **FIXED**

The route validated only the *shape* of the hash. Anyone could post any CCTP burn hash — including burns unrelated to Conduit — and the server would poll Circle for up to 180 seconds, then submit and pay for a relay transaction. The relayer's gas could be drained relaying arbitrary third parties' transfers, the swaps table grew from junk inserts, and each request pinned a function for up to 60s. No route had rate limiting.

**Fix:** new `lib/verifyBurn.ts` confirms the transaction exists on the claimed source chain, succeeded, and went through a Conduit entry point (`SwapAndBurn` or the canonical `TokenMessenger`) before any relay work is scheduled. New `lib/ratelimit.ts` meters every route. Relaying stays permissionless in the sense that matters — anyone may trigger a relay of a genuine Conduit burn, and the hook still decides where funds go.

### H-4 — Stellar slippage floor was chosen by the relayer — **FIXED**

`min_out` was a *caller* argument, so the user's tolerance never reached the swap at all. Even a correct contract could not have enforced their intent.

**Fix:** the floor now travels inside the attested message. `hookData` gained a trailing 16-byte big-endian minimum-output field (built in `useSwap.ts`, mirrored in the e2e scripts), the contract reads it from the now-verified message, and takes the **stricter** of that and the caller's value — a relayer may ask for more protection, never less. The floor is also checked against what the recipient actually receives, so the deliberate 0.5% K-invariant safety margin (L-3) is no longer quietly excluded from it.
**Test:** `test_attested_min_out_is_enforced_over_caller_value`.

---

## Medium

- **M-1 — Refunds went to a source-chain address on the destination chain. FIXED.** `refundTo` was the burn's `messageSender`, which for a `SwapAndBurn`-originated transfer is a *contract address on the source chain*; the same address on the destination chain is usually nobody, so USDC sent there was permanently lost. Refunds now use the recipient named in the hook calldata (the last ABI word of both swap entry points), falling back to `messageSender` only on the no-hook path, where nothing else exists.
- **M-2 — `swapAndBurnToken` took an arbitrary token with no reentrancy guard. FIXED.** `nonReentrant` on both entry points, safe-call wrappers on every token call, and `amountIn` measured as a real balance delta so fee-on-transfer tokens cannot desynchronise the accounting.
- **M-3 — `/api/stellar-source/prepare` built arbitrary transactions from unvalidated input. FIXED.** The body was an `as Body` cast, never parsed. It now validates the public key as a real strkey, amounts as bounded i128s, hex fields by length, and checks `spender`, `mintRecipient` and `destinationDomain` against allowlists of Conduit's own contracts. Unvalidated, this turned the app's trusted origin into a builder of arbitrary USDC approvals and CCTP burns.
- **M-4 — Relayer private keys live in the web application's environment. NOT FIXED — needs infrastructure.** Still plain env vars in the Next.js runtime, with no KMS, signing service or separation between the request handler and the key. C-4 closed the immediate path; the structural problem remains. **Move relaying to a separate worker with its own credentials, and use a KMS or remote signer, before mainnet.**
- **M-5 — Database TLS certificate verification was disabled. FIXED — needs one config step from you.** `ssl: { rejectUnauthorized: false }` accepted any certificate, leaving the connection encrypted but unauthenticated. Verification is now on by default, with `DATABASE_CA_CERT` for providers whose chain isn't in Node's trust store and a visible `DATABASE_SSL_NO_VERIFY` escape hatch for local development. Your `DATABASE_URL` points at Supabase's pooler, whose chain is self-signed, so **the build now correctly fails until you supply the CA** — see Deployment actions.
- **M-6 — `/api/swaps/history` exposed every user's activity unauthenticated. FIXED.** Still a global feed (the app has no accounts, and the data is public on-chain), but now rate-limited, capped at 100 rows, and stripped of internal error strings.
- **M-7 — Unchecked ERC20 return values throughout. FIXED.** Safe-call wrappers in all four contracts, tolerating reverting, `false`-returning and silent ERC20s. Matters most for `rescueToken`'s arbitrary `token` argument.
- **M-8 — `withdrawFees` could withdraw the entire USDC balance. FIXED in code; multisig is a deployment decision.** Fees are now tracked in `accruedFees` and withdrawals capped to it, so USDC mid-swap or sent by mistake is out of reach. `owner` is still a single immutable EOA with no timelock — use a multisig for mainnet.

---

## Low

- **L-1 — `bytes_to_i128` truncated and could go negative. FIXED.** Took the low 16 bytes and cast `u128 as i128`, so a value with the high bit set became negative. Now rejects any high-16-byte content and uses a checked conversion; the AMM arithmetic uses `checked_mul`/`checked_add` throughout.
- **L-2 — `bytes_to_string` panicked on a long recipient. FIXED.** Copied into a fixed 56-byte buffer using a length validated only against the message size. Now requires exactly 56 bytes, as does Circle's own recipient field.
- **L-3 — 0.5% silently donated to the pool. FIXED.** The safety margin is still applied, but the slippage floor is now checked against the post-markdown amount, so it is inside what the user's tolerance covers rather than excluded from it.
- **L-4 — `updateSwap` interpolated column names into SQL. FIXED.** Values were parameterized correctly, but column names came from `Object.keys(fields)`. Both the Postgres and SQLite stores now check them against an allowlist. Not exploitable as written — a sink waiting for a future caller.
- **L-5 — Raw error strings returned to clients. FIXED.** New `lib/publicSwap.ts` maps relayer errors to a short category; the full string is still stored for operators. RPC errors in the Stellar and fee routes are logged server-side instead of echoed.
- **L-6 — Testnet was hardcoded. FIXED.** New `lib/stellarNetwork.ts` centralises the passphrase, RPC URL and USDC issuer behind `STELLAR_NETWORK`. A mainnet deploy would previously have kept building testnet transactions with no visible sign of it.
- **L-7 — `block.timestamp` as a swap deadline. ACCEPTED, documented.** Always satisfied, so it is not a deadline. It fills the router's signature; `minOut` is the real protection and is now a genuine number (C-3). The source-side swap+burn is atomic within one transaction anyway.
- **L-8 — Dependency advisories. PARTIALLY FIXED.** Was 36 (3 critical, 13 high); now 27 (**0 critical**, 9 high). The Next.js RCE is gone via C-4; `protobufjs` (arbitrary code execution) and `sharp`/libheif are pinned via pnpm overrides. The rest arrive transitively through `@creit.tech/stellar-wallets-kit → @trezor/connect` and have no fixed version published upstream yet — they need watching, not a code change here.
- **L-9 — `/api/stellar-source/submit` was an open transaction relay. FIXED.** Still accepts only already-signed transactions (so it cannot move anyone's funds), but is now rate-limited, size-bounded, and parses against our own network passphrase, which rejects transactions built for a different network.

---

## Also fixed along the way

**The Soroban test suite had never executed.** `lib.rs` never declared `mod test;`, so `test.rs` was dead code; and `cargo test` could not compile regardless, because `soroban-env-host` declares `ed25519-dalek = ">=2.0.0"` and cargo therefore resolved 3.0.0, whose trait bounds its own testutils don't satisfy. The workspace `Cargo.toml` documented this as unfixable.

It was fixable: capping the dependency in the contract's dev-dependencies and pinning the lockfile to 2.2.0 narrows that open-ended requirement to a version that works. With `#[cfg(test)] mod test;` declared and `extern crate std` added for the `no_std` crate, the suite compiles and runs — 8 tests, including the five that pin down the C-1/C-2/H-4 fixes. The stale comment in `Cargo.toml` has been corrected.

---

## What was already right

Worth recording, because it is why the EVM side scored as well as it did:

- **No secrets in git.** `.env`, `contracts/.env` and `frontend/.env.local` are all correctly ignored; a scan of the full history across all refs found no secret file ever committed.
- **The hook is parsed from the attested message, not from relayer input** — the central security property of the EVM design, and it holds.
- **Swap failure refunds rather than reverts,** so a slippage failure never strands funds.
- **The Soroban contract sets `Delivered` before any external call** — correct checks-effects-interactions ordering, and a working replay guard.
- **All SQL values are parameterized.**

---

## Deployment actions

Code changes alone do not fix a deployed system. Before this is live, and certainly before mainnet:

1. **Redeploy all four Solidity contracts.** The executors' hook handling and the burn contracts' fee accounting both changed. Update the addresses in `frontend/lib/legs.ts` and `DEPLOYMENTS.md`.
2. **Redeploy `swap_and_deliver` and call the new `init`.** Its signature is now `init(admin, message_transmitter, usdc, xlm, pair, attesters, signature_threshold)`. **You need Circle's real attester address set and threshold for the network you are on** — obtain them from Circle (they are what the EVM `MessageTransmitter` stores as its enabled attesters) rather than guessing. An incorrect set means every delivery fails closed with `InvalidAttestation`, which is the safe direction, but it will not work until they are right.
3. **Supply the Supabase CA certificate** as `DATABASE_CA_CERT` (download it from the Supabase dashboard → Database settings), or set `DATABASE_SSL_NO_VERIFY=true` for local development only. The build fails until one is set — that is the fix working, not a regression.
4. **Move the relayer off the web process** and onto a KMS or remote signer (M-4).
5. **Use a multisig for contract ownership** on mainnet (M-8).
6. **Rotate `RELAYER_PRIVATE_KEY` and `STELLAR_RELAYER_SECRET`** if there is any chance the RCE-vulnerable build (C-4) was ever publicly reachable.
7. **Replace the in-process rate limiter** with a shared one (Redis, or the platform's edge limiter) once this runs on more than one instance.
