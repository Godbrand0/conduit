# Conduit 🌊

> Native-to-native cross-chain swaps, powered entirely by Circle's CCTP V2.
> Native ETH in, native ETH out. USDC as the invisible settlement layer.
> No wrapped tokens. One signature.

![Status](https://img.shields.io/badge/status-live%20on%20testnet-green)
![Protocol](https://img.shields.io/badge/protocol-CCTP%20V2-blue)
![Chains](https://img.shields.io/badge/chains-7-purple)
![License](https://img.shields.io/badge/license-MIT-orange)

**Live app:** https://conduit-sandy.vercel.app
**SDK:** [`@cctp-sdk/core`](https://www.npmjs.com/package/@cctp-sdk/core) on npm · [source](https://github.com/Godbrand0/cctp_sdk)

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [How It Works](#how-it-works)
- [Live Chains & Deployed Contracts](#live-chains--deployed-contracts)
- [The SDK](#the-sdk)
- [The Product](#the-product)
- [On-Chain Proofs](#on-chain-proofs)
- [Fee Structure](#fee-structure)
- [Security Model](#security-model)
- [Repo Layout](#repo-layout)
- [Getting Started](#getting-started)
- [Next Steps](#next-steps)

---

## Overview

Conduit lets a user hold native ETH on one chain and receive native ETH
(or native USDC, on Arc) on another — in a single wallet signature. No
wrapped tokens, no manual "swap, bridge, swap again, claim" dance, no
liquidity-pool bridge risk.

```
User sees:          ETH (Base)  ──────────────────→  ETH (Arbitrum)
What happens:       ETH → USDC → [CCTP V2 burn] → [CCTP V2 mint] → USDC → ETH
Bridge mechanism:    Circle burn-and-mint only
Trust model:         Circle's attestation service (Iris) — nothing else
Output:               Native ETH, not wrapped
```

Two contracts make this possible: `SwapAndBurn` on the source chain
(swap-then-burn in one transaction) and `ReceiveAndSwap` on the
destination chain (a permissionless hook executor that mints and swaps
back atomically). See [How It Works](#how-it-works).

---

## The Problem

CCTP V2 is the safest way to move USDC between chains — no wrapped
tokens, no vault to drain, just burn-and-mint under Circle's attestation.
But CCTP only moves USDC. Most users don't hold USDC — they hold ETH (or
whatever the native gas token is), and getting native-asset-in,
native-asset-out today means multiple manual swaps around a bridge,
each with its own transaction and slippage.

Conduit closes that gap without reintroducing the trust assumptions CCTP
was built to remove: no wrapped assets, no third-party liquidity pool,
one additional trust dependency beyond "the user already trusts Circle
by holding USDC" — which is none.

---

## How It Works

```
STEP 1 — Source chain, one signature
──────────────────────────────────────────────────────
User's native ETH
    ↓  SwapAndBurn.swapAndBurnNative()
Uniswap V3: ETH → USDC (0.05% Conduit fee skimmed here)
    ↓
CCTP V2 depositForBurnWithHook — burns USDC, embeds the
destination swap instructions in the attested message

STEP 2 — Circle attestation (Iris)
──────────────────────────────────────────────────────
~15-20 seconds on Fast Transfer

STEP 3 — Destination chain, no signature needed
──────────────────────────────────────────────────────
ReceiveAndSwap.relayAndExecute() — callable by anyone
    ↓
CCTP mints USDC, hook fires atomically
    ↓
Uniswap V3: USDC → native ETH, delivered to the user
```

`ReceiveAndSwap` is trustless by construction: the swap instructions
(recipient, pool, minimum output) are cryptographically bound inside
Circle's attestation. Conduit's relayer submits the transaction and pays
gas — it has no ability to redirect funds, because it never controls
what the hook does. Anyone could run the relayer.

**Arc Testnet is the exception, and it's simpler, not harder.** Arc's
native gas token *is* USDC — confirmed on-chain, its "USDC" address is
an ERC20-view precompile that mirrors the native balance. That means:
- **Arc as source:** no swap step at all — the standard CCTP
  `TokenMessenger` burns straight from the wallet.
- **Arc as destination:** the existing `SwapAndBurn` on the source chain
  works unchanged, just with `mintRecipient` set to the user's own
  address — minted USDC lands directly as native balance, nothing left
  to swap.

Zero new contracts were needed to add Arc as a 5th chain.

---

## Live Chains & Deployed Contracts

All addresses below are live on public testnets, with on-chain proof
of a real swap on every route — see [DEPLOYMENTS.md](./DEPLOYMENTS.md)
for every transaction hash.

| Chain | SwapAndBurn (source) | ReceiveAndSwap (destination) |
|---|---|---|
| Base Sepolia | [`0xc3Deb7F7Ad5075618e1055EC2aaf27659740F022`](https://sepolia.basescan.org/address/0xc3Deb7F7Ad5075618e1055EC2aaf27659740F022) | [`0x86986974E1B45Dd370AD90Fe8747e86C355b0866`](https://sepolia.basescan.org/address/0x86986974E1B45Dd370AD90Fe8747e86C355b0866) |
| Arbitrum Sepolia | [`0xcEE2b537Ee71c0B4399761537357c1c2B5A5F6Ec`](https://sepolia.arbiscan.io/address/0xcEE2b537Ee71c0B4399761537357c1c2B5A5F6Ec) | [`0x9B6aaDaEeD2cAF2B3b26C62aA5dEaCcB8052F40B`](https://sepolia.arbiscan.io/address/0x9B6aaDaEeD2cAF2B3b26C62aA5dEaCcB8052F40B) |
| Ethereum Sepolia | [`0x9A732afcA3Fbc0FB9a0dDF677dC1c35549499766`](https://sepolia.etherscan.io/address/0x9A732afcA3Fbc0FB9a0dDF677dC1c35549499766) | [`0x226EC562076549FdD16ecaaF437CD77E49D102c5`](https://sepolia.etherscan.io/address/0x226EC562076549FdD16ecaaF437CD77E49D102c5) |
| OP Sepolia | [`0x84B1634Ec67d309AEB9DC422F001350e467DCBc8`](https://sepolia-optimism.etherscan.io/address/0x84B1634Ec67d309AEB9DC422F001350e467DCBc8) | [`0xAead88469c8DBdA0efd12c6993eDCb2F171D8203`](https://sepolia-optimism.etherscan.io/address/0xAead88469c8DBdA0efd12c6993eDCb2F171D8203) |
| Unichain Sepolia | [`0xcc5b18B89C7709EeB840c2cA4875c39e17d57c21`](https://sepolia.uniscan.xyz/address/0xcc5b18B89C7709EeB840c2cA4875c39e17d57c21) | [`0x60D6EDA1573f13268f5a925CB8ECabe00ABB2C6f`](https://sepolia.uniscan.xyz/address/0x60D6EDA1573f13268f5a925CB8ECabe00ABB2C6f) |
| Avalanche Fuji | [`0x9AcD57857367494eb6CB02Bd2241Cc78FdCdDe8b`](https://testnet.snowtrace.io/address/0x9AcD57857367494eb6CB02Bd2241Cc78FdCdDe8b) † | [`0x064B35CA8f0886A10eD7C43E29D558E66b0dea36`](https://testnet.snowtrace.io/address/0x064B35CA8f0886A10eD7C43E29D558E66b0dea36) † |
| Arc Testnet | *none — direct CCTP `TokenMessenger`* | *none — direct CCTP `MessageTransmitter`* |

† Avalanche's contracts are a distinct variant — `SwapAndBurnUniV2`/
`ReceiveAndSwapUniV2` — since Uniswap V3 isn't deployed on Fuji. They swap
through Pangolin's Uniswap-V2-style router instead of V3's
`exactInputSingle`; same fee/hook/refund logic otherwise. See
[DEPLOYMENTS.md](./DEPLOYMENTS.md) for why (Trader Joe's more-liquid V1
router reverts on every real swap; Pangolin's thinner pool actually works).

Every `SwapAndBurn` charges a 0.05% Conduit fee (`FEE_BPS = 5`), skimmed
before the CCTP burn. All four V3 deployments are fee-enabled v2
deployments; the `ReceiveAndSwap` executors are also v2 (in-swap USDC refunds on
partial-fill, `amountIn = 0` meaning "swap everything just minted").

---

## The SDK

The CCTP integration logic — attestation polling, hook encoding,
per-chain config, fast-transfer fee quoting — is published as a
standalone, reusable package, not buried in the app:

```bash
npm install @cctp-sdk/core
```

```typescript
import { CctpClient } from "@cctp-sdk/core";

const client = new CctpClient({
  env: "testnet",
  rpcs: { base: BASE_RPC, arbitrum: ARBITRUM_RPC },
});

const transfer = await client.transfer(
  { from: "base", to: "arbitrum", amount: parseUnits("10", 6), fast: true },
  sourceWallet,
  destWallet
);

transfer.on("stateChange", (s) => console.log(s.state));
const result = await transfer.wait();
```

- **npm:** https://www.npmjs.com/package/@cctp-sdk/core (currently `0.2.1`)
- **Source:** https://github.com/Godbrand0/cctp_sdk

Building Conduit surfaced and fixed a real bug in the SDK: Arc's USDC
`decimals()` was documented as 18, but the live contract reports 6 —
caught by testing against the actual chain instead of trusting the spec.

---

## The Product

Beyond the contracts and SDK, Conduit ships as a working app, not a demo:

- **Swap UI** (Next.js + wagmi) — live pool-price quoting on both sides,
  one-click balance fill, per-chain routing with real chain logos.
- **Built-in relayer** — finishes the transfer server-side after the
  user signs once, so they can close the tab. Self-heals from RPC
  flakiness (persists the relay tx hash immediately on broadcast, checks
  for an already-broadcast tx before retrying, generous retry/backoff on
  testnet RPCs that rate-limit).
- **Swap history** with per-transaction detail views (route, fee
  breakdown, both explorer links).
- **Public stats page** — platform volume decoded directly from
  attested CCTP messages, not self-reported.
- **Deployed and live** on Vercel, Postgres-backed in production.

---

## On-Chain Proofs

Every route above has a real, verifiable transaction — burn hash, relay
hash, and delivered amount — recorded in
**[DEPLOYMENTS.md](./DEPLOYMENTS.md)**. Highlights:

- Full bidirectional native-to-native swaps across all 5 Uniswap-V3-based
  chains, including the fee-enabled flow (0.05% Conduit fee visibly
  skimmed on-chain).
- Arc Testnet proven in both directions — Arc → Base in ~13 seconds
  with zero Conduit contracts involved on the Arc side.
- Unichain Sepolia proven in both directions, with its real
  (non-canonical) SwapRouter02 address found by tracing a live pool's
  swap events rather than trusting a documented address.
- Avalanche Fuji proven in both directions through a distinct
  Uniswap-V2-style contract variant, after finding that the
  higher-liquidity DEX (Trader Joe's legacy router) reverts on every
  real swap despite quoting correctly — Pangolin's thinner pool turned
  out to be the one that actually works.
- The live frontend's relayer verified against a running production
  server, not just standalone scripts.

---

## Fee Structure

```
COMPONENT          AMOUNT       NOTE
─────────────────────────────────────────────────────────
Source DEX swap     ~0.05–0.3%   Uniswap V3 pool fee
Conduit fee          0.05%        skimmed pre-burn, in SwapAndBurn
Circle fast fee      variable     quoted live, shown before signing
Destination DEX      ~0.05–0.3%   Uniswap V3 pool fee
```

All fees are shown in the swap details panel before the user signs — no
surprises after the fact. Arc-sourced swaps currently skip the Conduit
fee entirely, since they bypass `SwapAndBurn` (nothing to swap).

---

## Security Model

- **Single trust dependency:** Circle's attestation service. Using
  native USDC on any chain already implies trusting Circle — Conduit
  adds no additional party.
- **No custody at rest:** `ReceiveAndSwap` only ever holds USDC for the
  duration of one transaction (the atomic mint-then-swap).
- **Trustless relaying:** the destination swap's parameters are bound
  inside Circle's cryptographic attestation. The relayer wallet can pay
  gas; it cannot redirect funds. Anyone can run it.
- **Slippage floors** enforced on-chain on both the source and
  destination swap.

Contracts are intentionally simple — two contracts, no proxy/upgrade
pattern, no token custody beyond a single atomic transaction — to keep
the eventual audit surface small.

---

## Repo Layout

```
conduit/
├── contracts/          Foundry project — SwapAndBurn.sol, ReceiveAndSwap.sol,
│                        deploy scripts, tests
├── scripts/             Standalone proof scripts (e2e-native.ts, arc-to-base.ts,
│                        base-to-arc.ts) — used to generate DEPLOYMENTS.md's proofs
├── frontend/             Next.js app: swap UI, relayer API routes, stats page
├── DEPLOYMENTS.md        Every deployed address + every proof transaction
└── README.md             This file
```

---

## Getting Started

```bash
# Contracts
cd contracts
forge install
forge test

# Frontend
cd frontend
pnpm install
pnpm dev              # http://localhost:3000
```

The frontend needs `RELAYER_PRIVATE_KEY` (pays destination-side relay
gas) and, for production, `DATABASE_URL` (Postgres — SQLite is the local
dev default). See `frontend/.env.local` for the full list.

---

## Next Steps

**Avalanche is live** — `SwapAndBurnUniV2`/`ReceiveAndSwapUniV2`, routing
through Pangolin's Uniswap-V2-style router since Uniswap V3 isn't deployed
on Fuji. Getting there took real investigation: Trader Joe's more-liquid
legacy router reverts on every real swap despite quoting fine, so the
working venue ended up being a thinner but genuinely functional Pangolin
pool. Full story and proofs in [DEPLOYMENTS.md](./DEPLOYMENTS.md). Not yet
wired into the frontend UI — it needs its own quote math (constant-product
reserve pricing, not Uniswap V3's `sqrtPriceX96`) and hook encoding (no
fee-tier parameter), distinct from every other chain's V3-based flow.

**Stellar (XLM)** is next — the other half of the original target corridor
(a non-custodial AVAX → XLM route doesn't exist anywhere today, and Stellar
is the settlement rail behind MoneyGram's 475,000-location cash network).
It's the largest remaining lift: non-EVM, so it needs Soroban contracts
(Rust) rather than Solidity, integrates through Circle's `CctpForwarder`
rather than a standard EVM hook, and swaps USDC → XLM via Stellar's native
SDEX path-payment primitive instead of a Uniswap-style pool. Genuinely new
infrastructure, not a config addition — but Arc and Avalanche both proved
the pattern of "adapt the model to the chain's real primitives, verified
on-chain before writing contract code" works.

Other chains under evaluation follow the same bar every chain here met:
real CCTP V2 support *and* a verified, liquid swap venue, checked
on-chain before writing a line of contract code — not assumed from
documentation.

---

## License

MIT © Godbrand (Thompson Eregha)
