# Mainnet Migration Playbook

This is the checklist for moving Conduit from testnet to mainnet across all
8 chains. Nothing here is optional-and-skippable except where explicitly
marked — this document exists because "just point the same contracts at
mainnet RPCs" is not actually how this migration works: **every address,
every liquidity assumption, and every trust boundary has to be
re-verified from zero**, the same on-chain-before-trusting-docs discipline
that shaped every chain in `DEPLOYMENTS.md`. Testnet passing proves the
*mechanism* works. It proves nothing about mainnet's specific addresses,
liquidity, or fees.

**Do not skip the audit.** Nothing below matters if the contracts have a
bug that drains real user funds. That's item one, not a footnote.

---

## 0. Security audit — before anything else

- [ ] Engage an audit firm for `SwapAndBurn.sol`, `ReceiveAndSwap.sol`,
      `SwapAndBurnUniV2.sol`, `ReceiveAndSwapUniV2.sol`, and
      `swap_and_deliver` (Soroban/Rust — confirm the firm has real Soroban
      experience, not just EVM).
- [ ] Fix every finding before deploying a single mainnet contract.
- [ ] Re-audit (or get sign-off) on any code changed in response to
      findings — don't ship the pre-audit version by accident.

**Known gaps to flag for the auditors specifically**, since they're not
hypothetical — they were live design decisions made under testnet
conditions and need real scrutiny before mainnet capital is at risk:

- **No pause/circuit-breaker mechanism.** If a bug or an external
  dependency (a DEX router, CCTP itself) misbehaves, there's currently no
  way to halt new swaps without redeploying. Worth adding before mainnet.
- **Ownership is a single EOA**, not a multisig. `withdrawFees`,
  `rescueToken`, `rescueNative` are all owner-gated. A single compromised
  key currently means a compromised treasury-sweep and rescue path. Move
  to a multisig (Safe or equivalent) *before* deploying, not after.
- **The relayer wallet's private key currently lives in a plain `.env`
  file.** Fine for testnet. Not fine once it's paying real gas and the
  swap flow depends on its liveness. See §5.

---

## 1. What does NOT carry over from testnet

Every one of these is a fresh lookup, not a copy-paste, for every chain:

- Contract addresses (obviously — mainnet deployments are new contracts,
  new addresses).
- CCTP `TokenMessenger`/`MessageTransmitter` addresses. Testnet reused one
  pair of addresses (`0x8FE6...`, `0xE737...`) across every EVM testnet —
  **do not assume mainnet does the same**; verify per chain via
  `depositForBurnWithHook`/`receiveMessage` selector checks the way every
  testnet chain in this project was verified before use.
- USDC contract addresses (mainnet USDC per chain — Circle's official
  list, but verify against the CCTP contracts' own `link_token_pair`-style
  registry the way Arc and Stellar's USDC were confirmed via
  `TokenMessengerMinter.get_local_token`, not just trusted from docs).
- Uniswap V3 (or Pangolin/Soroswap) pool addresses and liquidity. **A
  mainnet pool existing does not mean it's liquid enough for real swap
  volume** — check real reserves and realistic price impact for the
  amounts Conduit will actually route, the same way Avalanche's testnet
  liquidity was checked before committing to a venue.
- Circle's Iris attestation API endpoint: mainnet is
  `https://iris-api.circle.com`, **not** `https://iris-api-sandbox.circle.com`.
  Same API shape, different base URL, different (real) fee schedule.
- Circle's minimum/fast-transfer fees are real economics on mainnet, not
  testnet's frequent `0`. Budget for them in the fee-quoting UI and in
  `maxFee` sizing (see the Base→Stellar incident in `DEPLOYMENTS.md` #15's
  history — an under-margined `maxFee` silently fell back to slow
  finality; on mainnet that's real user-facing latency, not just a test
  annoyance).

---

## 2. Per-chain verification checklist

Repeat this exact process for every chain before deploying anything —
this is the actual migration work, not a formality:

1. Confirm CCTP `TokenMessenger`/`MessageTransmitter` (or the Stellar/
   Soroban equivalents) are deployed and match the expected interface —
   call a real view function, don't just check the address has code.
2. Confirm the mainnet USDC address via the CCTP contracts' own registry,
   not a copy-pasted address from a block explorer or a doc page.
3. Confirm the swap venue (Uniswap V3 pool / Pangolin pair / Soroswap
   pair) exists **and has real reserves** relative to expected swap sizes.
   For any non-Uniswap-V3 chain, confirm the router/pair actually
   *executes* a real swap, not just quotes one — Avalanche testnet's
   Trader Joe router looked fine on paper and reverted on every real
   swap; don't assume mainnet routers are exempt from this class of bug.
4. Get the real Circle fast-transfer fee for every mainnet route pair via
   `GET https://iris-api.circle.com/v2/burn/USDC/fees/{src}/{dst}` and
   confirm it's sane before wiring `maxFee` defaults into the frontend.
5. Only after 1–4 pass: deploy.

### Per-chain status

| Chain | Uniswap V3 mainnet? | Notes |
|---|---|---|
| Base | Yes, deep liquidity | Straightforward — same pattern as testnet, new addresses |
| Arbitrum | Yes, deep liquidity | Same |
| Ethereum | Yes, deep liquidity | **Highest gas costs of any chain here** — factor into fee UX and whether `SwapAndBurn`'s per-tx gas is acceptable for the amounts users will actually send |
| OP Mainnet | Yes, deep liquidity | Same pattern |
| Unichain | Yes (it's Uniswap's own chain) | Likely the easiest re-verification — official, not a discovered non-canonical router like testnet was |
| Avalanche C-Chain | **Not officially** — same situation as testnet | Repeat the full "which DEX actually executes a swap" investigation from `DEPLOYMENTS.md` #12/13 on mainnet. Trader Joe and Pangolin both exist on mainnet with real liquidity, but re-verify execution, don't assume the testnet finding (Pangolin works, Trader Joe doesn't) transfers to mainnet — it may not; these are different deployments. |
| Arc | **Confirm mainnet launch status first** | Arc's mainnet timeline should be confirmed directly with Circle before assuming the testnet architecture (native-USDC-as-gas, direct `TokenMessenger` burns) applies unchanged. If Arc mainnet isn't live yet, this chain is blocked, not degraded. |
| Stellar | N/A (Soroban, not Uniswap) | Confirm mainnet Soroswap (or whichever AMM has real mainnet USDC/XLM liquidity — don't assume it's still Soroswap) has real reserves; re-verify `CctpForwarder`/`MessageTransmitter` mainnet addresses via Circle's docs *and* on-chain, the same two-step verification used for testnet. |

---

## 3. Contract deployment

- [ ] Deploy `SwapAndBurn`/`ReceiveAndSwap` (V3 variant) to Base, Arbitrum,
      Ethereum, OP, Unichain mainnet.
- [ ] Deploy `SwapAndBurnUniV2`/`ReceiveAndSwapUniV2` to Avalanche C-Chain,
      pointed at whichever DEX mainnet verification (§2) confirms actually
      works.
- [ ] Deploy `swap_and_deliver` to Stellar mainnet, initialized with
      mainnet `MessageTransmitter`/USDC/XLM/pair addresses.
- [ ] Arc: confirm whether any contract is even needed (testnet needed
      none, by design — native-USDC-as-gas). Re-verify this holds on Arc
      mainnet before assuming it.
- [ ] Record every deployment exactly like `DEPLOYMENTS.md` does — address,
      deploy tx, and (critically) **a real, small-value proof transaction
      per route** before considering any chain "live." Same discipline,
      real stakes.
- [ ] Update contract `owner` to the multisig from §0, not the deployer
      EOA, at deploy time — don't deploy-then-transfer if avoidable (fewer
      windows where a single key controls treasury/rescue functions).

---

## 4. Frontend & relayer changes

- [ ] New `Leg` entries in `frontend/lib/legs.ts` for every mainnet chain
      (new `chain` objects — `base`, `arbitrum`, `mainnet` etc. from
      `viem/chains`, not the Sepolia/testnet variants), new contract
      addresses, new pool/pair addresses.
- [ ] `frontend/lib/wagmi.ts`: swap every testnet chain for its mainnet
      counterpart.
- [ ] **Real, paid RPC providers** for every chain — public free RPCs
      (used throughout testnet development) will rate-limit or degrade
      under real user load in a way that's a UX bug on testnet and a
      stuck-funds incident on mainnet. Use Alchemy/Infura/QuickNode/etc.
      with actual SLAs.
- [ ] `lib/relayer.ts`: same logic, but review the gas-override and
      retry/backoff constants (§ tuned for specific testnet RPC quirks —
      e.g. Fuji's and Arc's flaky public RPCs) against real mainnet RPC
      behavior; they may need different tuning or may not be needed at all
      with a paid provider.
- [ ] `/api/fee`: confirm it points at the real Iris endpoint, not sandbox.
- [ ] Update `DATABASE_URL` to a production Postgres instance (separate
      from any testnet database — don't mix real and test swap history).
- [ ] Add a clear, unmissable **mainnet vs. testnet indicator** in the UI
      if both are ever live simultaneously (e.g. during a staged rollout)
      — a user should never be confused about which network their funds
      are moving on.

---

## 5. Relayer key management (real money changes this)

The testnet relayer is a single private key in `.env`, paying gas on
whichever chain needs relaying. That's acceptable when the key controls
testnet funds and a compromise costs nothing. On mainnet:

- [ ] Move the relayer key to a proper secrets manager (AWS KMS, GCP KMS,
      HashiCorp Vault, or a dedicated signing service) — not a `.env` file
      on a server, even one only Vercel can read.
- [ ] Consider whether the relayer truly needs to be a single hot wallet
      per chain, or whether a smaller hot-wallet balance + automated
      top-up from a colder reserve reduces exposure.
- [ ] Set up balance monitoring/alerting per chain — a relayer that runs
      out of gas mid-route on testnet is an annoyance; on mainnet it's
      stuck user funds until someone notices and refills manually.
- [ ] Since `ReceiveAndSwap.relayAndExecute` (and `swap_and_deliver`) are
      permissionless by design, consider whether running a *second*,
      independent relayer (even a simple redundant process) improves
      liveness — the trust model already supports it; testnet just never
      needed the redundancy.

---

## 6. Treasury & fee sweeping

- [ ] Decide a cadence for sweeping the 0.05% Conduit fee out of each
      `SwapAndBurn` contract's accumulated balance (`withdrawFees`) into
      the multisig — don't let fees sit in a single-owner-controlled
      contract indefinitely across 7 EVM chains.
- [ ] Decide where swept fees go (operating treasury, buffer for gas
      top-ups, etc.) and document it — this becomes a real financial
      process now, not a testnet formality.

---

## 7. Compliance (not legal advice — a checklist to take to a lawyer)

Operating a service that moves real user funds across chains may carry
money-transmission or other regulatory implications depending on
jurisdiction. Before going live with real value:

- [ ] Consult counsel on money-transmission licensing requirements in
      relevant jurisdictions.
- [ ] Consider terms of service / user disclosures given the trust model
      (non-custodial, but the relayer is a required liveness dependency).
- [ ] Consider sanctions/OFAC screening requirements, if applicable to
      your operating jurisdiction.

---

## 8. Rollout plan

Don't flip all 8 chains live simultaneously with real funds on day one.

- [ ] **Stage 1**: deploy and verify 1–2 chains (suggest Base + Arbitrum —
      deepest liquidity, most battle-tested pattern) with a hard cap on
      swap size while monitoring closely.
- [ ] **Stage 2**: expand to the remaining V3 EVM chains once Stage 1 runs
      cleanly for a real observation window.
- [ ] **Stage 3**: Avalanche, Arc, Stellar — the chains with non-standard
      mechanisms — go last, after the standard-pattern chains have proven
      stable in production.
- [ ] Keep the testnet deployment running in parallel indefinitely (for
      continued development/testing) — don't retire it.
- [ ] Have a documented incident-response plan: who gets paged if the
      relayer stalls, what the rollback/pause procedure is (once §0's
      pause mechanism exists), and how a stuck user's funds actually get
      recovered.

---

## 9. What's genuinely low-risk to reuse as-is

To be clear about what *doesn't* need re-litigating:

- The overall architecture (`SwapAndBurn`/`ReceiveAndSwap`, the Stellar
  `swap_and_deliver` design) is sound *pending audit* — it's been proven
  correct in mechanism across 8 chains, including real edge cases
  (partial fills, hook failures, double-relay races, non-EVM chains).
- The relayer's self-healing logic (persisting the relay hash before
  confirmation, checking for an already-broadcast tx before retrying, the
  nonce-reuse-means-success handling) is real production hardening, not
  testnet-only scaffolding — keep it.
- The frontend's quote/fee-breakdown logic is correct; only the
  underlying addresses and RPC endpoints change.
