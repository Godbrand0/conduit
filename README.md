# Conduit 🌊

> A CCTP-native cross-chain swap router. Native assets in. Native assets out.
> USDC as the invisible settlement layer. No wrapped tokens. No bridge risk.

![Status](https://img.shields.io/badge/status-active%20development-green)
![Protocol](https://img.shields.io/badge/protocol-CCTP%20V2-blue)
![Chains](https://img.shields.io/badge/chains-15%2B-purple)
![License](https://img.shields.io/badge/license-MIT-orange)

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [How Conduit Works](#how-conduit-works)
- [What Makes This Different](#what-makes-this-different)
- [Supported Chains](#supported-chains)
- [V1 — AVAX → XLM (Foundation Pair)](#v1--avax--xlm-foundation-pair)
- [V2 — All CCTP EVM Pairs](#v2--all-cctp-evm-pairs)
- [V3 — Full Router](#v3--full-router)
- [User Flow](#user-flow)
- [Technical Architecture](#technical-architecture)
- [CCTP V2 Integration](#cctp-v2-integration)
- [Stellar Integration](#stellar-integration)
- [Smart Contracts](#smart-contracts)
- [Fee Structure](#fee-structure)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Security Model](#security-model)
- [Grant Strategy](#grant-strategy)
- [Roadmap](#roadmap)
- [Ecosystem Resources](#ecosystem-resources)

---

## Overview

Conduit is a cross-chain swap router powered entirely by Circle's
Cross-Chain Transfer Protocol (CCTP V2). It lets users swap any
native asset on any CCTP-supported chain to any native asset on
any other CCTP-supported chain — in one transaction, with no
wrapped tokens, no liquidity pools, and no third-party bridge
custodian.

The user interface shows a simple source → destination swap.
Everything underneath — the DEX swap on the source chain,
the CCTP V2 burn-and-mint, and the DEX swap on the destination
chain — runs automatically. The user signs once and receives
native tokens.

```
User sees:          AVAX  ──────────────────→  XLM
What happens:       AVAX → USDC → [CCTP] → USDC → XLM
Bridge mechanism:   Circle burn-and-mint only
Trust model:        Circle attestation service (Iris)
Output:             Native tokens, not wrapped
```

CCTP has processed over $110 billion in cumulative volume across
more than 5.3 million transfers. The burn-and-mint model eliminates
the vault-based honeypot that caused Wormhole ($325M) and Ronin
($625M) to be exploited. Conduit builds exclusively on this model.

---

## The Problem

### What Exists Today

Three categories of cross-chain swap products exist:

**1. Multi-protocol aggregators (Li.Fi, Jumper, Squid)**
Route through any available bridge — CCTP, LayerZero, Wormhole,
Across, Stargate — depending on the pair and available liquidity.
CCTP is one option among many, not the exclusive mechanism.
Security model varies by bridge selected. May produce wrapped
tokens on some routes.

**2. Centralized swap services (SwapSpace, GhostSwap)**
Custodial. They take your tokens and send you different tokens.
You trust them with your funds during the transfer. Not
self-custodial, not on-chain.

**3. Direct CCTP interfaces (CCTP.Money)**
Move USDC only. No DEX integration. The user starts with USDC
and ends with USDC. No conversion from or to native assets.

### The Gap

No product exists today that:
- Uses CCTP exclusively as the bridge mechanism
- Integrates DEX swaps on both source and destination chains
- Presents a native-to-native UI (AVAX in, XLM out)
- Runs entirely on-chain and non-custodially
- Covers the AVAX → Stellar route specifically

The Avalanche → Stellar corridor is particularly unserved.
Stellar is the world's largest cash-to-crypto offramp —
MoneyGram's network spans 475,000 locations across 200+
countries and runs natively on Stellar. CCTP went live on
Stellar in May 2026. Nobody has built the non-custodial
AVAX → XLM route yet.

---

## How Conduit Works

Every swap follows the same three-step pattern regardless of
chains involved:

```
STEP 1 — Source Chain Swap
──────────────────────────────────────────────────────
User's native token (e.g. AVAX)
    ↓
DEX aggregator swap on source chain
    ↓
USDC on source chain
(native Circle-issued USDC, not wrapped)

STEP 2 — CCTP V2 Transfer
──────────────────────────────────────────────────────
USDC burned on source chain via TokenMessenger
    ↓
Circle Iris attestation service signs the burn
(8–20 seconds on Fast Transfer)
    ↓
Fresh native USDC minted on destination chain
(1:1, no intermediary, no liquidity pool)

STEP 3 — Destination Chain Swap
──────────────────────────────────────────────────────
Native USDC on destination chain
    ↓
DEX/SDEX swap on destination chain
    ↓
User's target native token (e.g. XLM)
```

CCTP V2 Hooks make Steps 2 and 3 atomic on EVM chains —
the swap executes the moment USDC is minted, in the same
transaction. On Stellar, a Soroban contract handles the
USDC → XLM path payment immediately after the CctpForwarder
delivers USDC.

---

## What Makes This Different

| Feature | Conduit | Li.Fi/Jumper | CCTP.Money | CEX Swaps |
|---|---|---|---|---|
| CCTP-only bridge | ✅ | ❌ (multi-protocol) | ✅ | ❌ |
| Native DEX swap on both ends | ✅ | ✅ | ❌ | ❌ |
| Native-to-native UI | ✅ | ✅ | ❌ | ✅ |
| Non-custodial | ✅ | ✅ | ✅ | ❌ |
| No wrapped tokens ever | ✅ | ❌ (depends on route) | ✅ | N/A |
| Stellar/XLM support | ✅ | ❌ | ❌ | Partial |
| Single trust assumption | ✅ (Circle only) | ❌ (per bridge) | ✅ | ❌ |
| Open source | ✅ | Partial | ❌ | ❌ |

The single trust assumption is the core differentiator.
Every route through Conduit has exactly one trust dependency:
Circle's attestation service. Using USDC on any chain already
implies trusting Circle. Conduit adds no additional trust parties.

---

## Supported Chains

### CCTP V2 Supported (Full Feature Set — Fast Transfer + Hooks)

| Chain | Domain | Fast Transfer | Hooks | DEX for Swaps |
|---|---|---|---|---|
| Ethereum | 0 | ✅ | ✅ | 1inch, Paraswap, CowSwap |
| Avalanche C-Chain | 1 | ✅ | ✅ | Trader Joe/LFJ, 1inch |
| OP Mainnet | 2 | ✅ | ✅ | Velodrome, 1inch |
| Arbitrum | 3 | ✅ | ✅ | GMX, Camelot, 1inch |
| Base | 6 | ✅ | ✅ | Aerodrome, 1inch |
| Polygon PoS | 7 | ✅ | ✅ | QuickSwap, 1inch |
| Solana | 5 | ✅ | ✅ | Jupiter |
| Unichain | — | ✅ | ✅ | Uniswap V4 |
| Linea | — | ✅ | ✅ | Nile, 1inch |
| World Chain | — | ✅ | ✅ | 1inch |
| Sonic | — | ✅ | ✅ | Shadow DEX |
| **Stellar** | **27** | **✅** | **✅** | **SDEX path payments / Soroswap** |

### CCTP V1 Legacy (Standard Transfer Only — Phase-out July 31, 2026)

| Chain | Domain | Notes |
|---|---|---|
| Noble (Cosmos) | 4 | USDC issuance hub for Cosmos ecosystem |
| Sui | 8 | V2 migration expected 2026 |
| Aptos | 9 | V2 migration expected 2026 |

> **Note:** CCTP V1 (Legacy) phase-out commences July 31, 2026.
> Conduit builds exclusively on CCTP V2. V1-only chains will be
> added as they migrate to V2.

---

## V1 — AVAX → XLM (Foundation Pair)

### Why This Pair First

The Avalanche → Stellar corridor is the most underserved, most
recently unblocked, and most aligned with real-world payment
use cases.

- CCTP on Stellar went live May 2026 — two months ago
- No non-custodial AVAX → XLM route exists anywhere today
- Stellar powers MoneyGram's 475,000-location cash network
  across 200+ countries
- XLM is used for remittances in Nigeria, Philippines, Mexico,
  Colombia — the exact markets Avalanche is targeting for adoption
- Building the hardest pair first proves the architecture works
  for every other pair (all EVM → EVM pairs are simpler)

### V1 Architecture

```
[Avalanche C-Chain]
  User wallet (AVAX)
       ↓
  LFJ/1inch DEX aggregator
  AVAX → USDC swap
       ↓
  CCTP V2 TokenMessenger
  DepositForBurnWithHook()
  mintRecipient: CctpForwarder (Stellar)
  destinationCaller: CctpForwarder (Stellar)
  hookData: encoded Stellar recipient + swap params
       ↓
  Circle Iris attestation (8–20 seconds)
       ↓

[Stellar Network]
  CctpForwarder receives attestation
  Calls mint_and_forward()
       ↓
  Conduit Soroban swap contract
  Receives USDC
  Executes SDEX path payment: USDC → XLM
       ↓
  Native XLM delivered to user's Stellar address
```

### V1 Scope

The V1 deliverable is this exact flow and nothing else:

- Source: Avalanche C-Chain only
- Source tokens: AVAX, WAVAX, USDC.e (any token with USDC
  liquidity on Avalanche DEXes)
- Destination: Stellar only
- Destination token: XLM
- UI: single-page swap interface, wallet connect, quote display

### V1 Timeline

```
Week 1–2   Soroban environment setup
           Stellar testnet wallet + USDC trustline
           CCTP V2 testnet on Fuji (Avalanche testnet)
           CctpForwarder integration study

Week 3–4   Avalanche-side: AVAX→USDC aggregator integration
           LFJ/1inch quote API
           CCTP V2 DepositForBurnWithHook() implementation

Week 5–6   Stellar-side: Soroban swap contract
           USDC→XLM via SDEX path payment
           CctpForwarder hook data encoding

Week 7–8   End-to-end testnet flow
           Fuji → Stellar testnet → XLM received
           Edge case handling (slippage, partial fills)

Week 9     Frontend: swap UI, wallet connect (Core + WalletConnect)
           Quote engine: DEX quote + CCTP fee + Stellar estimate
           Status tracker: attestation polling + delivery confirmation

Week 10    Security review, testnet stress test
           Decimal precision handling (7 vs 6 decimal USDC)
           Dust handling on source side

Week 11–12 Mainnet deployment, UI polish, documentation
```

---

## V2 — All CCTP EVM Pairs

### What V2 Adds

Every EVM ↔ EVM pair using CCTP V2. The Stellar integration
(the hardest part) is already done by V2. EVM ↔ EVM pairs
are significantly simpler because:

- No CctpForwarder complexity (EVM hooks handle the swap natively)
- Same DEX aggregator pattern on both ends
- No decimal precision mismatch
- No trustline requirement
- CCTP V2 Hooks let the destination swap happen atomically on mint

### V2 Architecture (EVM ↔ EVM)

```
[Source EVM Chain]
  User token (e.g. ETH on Arbitrum)
       ↓
  DEX aggregator: ETH → USDC
       ↓
  CCTP V2 DepositForBurnWithHook()
  hookData: encoded swap call on destination
       ↓

[Destination EVM Chain]
  USDC minted + Hook fires atomically
  Hook calls destination DEX: USDC → target token
       ↓
  Native token delivered to user
```

The key difference from V1: on EVM-to-EVM routes, the USDC mint
and the destination swap happen in a single transaction on the
destination chain. The user never holds USDC at any point.

### V2 Route Matrix (Examples)

| Source | Destination | DEX Source | DEX Destination |
|---|---|---|---|
| AVAX → | SOL | LFJ | Jupiter |
| ETH → | AVAX | 1inch | LFJ |
| ARB → | BASE | Camelot | Aerodrome |
| MATIC → | ETH | QuickSwap | 1inch |
| OP → | ARB | Velodrome | Camelot |
| SOL → | AVAX | Jupiter | LFJ |
| BASE → | XLM | Aerodrome | Soroswap/SDEX |

### V2 Scope

- All CCTP V2 EVM chains supported as source and destination
- Stellar remains the one non-EVM destination (carried from V1)
- 1inch/Paraswap API integration for EVM DEX quotes
- Jupiter API integration for Solana
- Multi-route quote comparison — user sees best rate
- Slippage controls and price impact warnings
- Gas estimation across both chains in one quote

### V2 Timeline

```
Week 13–14  1inch/Paraswap API integration for all EVM chains
            CCTP V2 Hook contract template for EVM→EVM
            Deploy SwapAndBurn.sol: source-side contract

Week 15–16  ReceiveAndSwap.sol: destination hook contract
            Handles: USDC received → DEX swap → user token
            Deploy on all CCTP V2 EVM destinations

Week 17–18  Jupiter API integration (Solana source/destination)
            Solana-specific CCTP V2 program interaction
            (Solana V2 uses programs, not EVM contracts)

Week 19–20  Route aggregation: show user best quote across
            all available DEX options per chain
            Gas abstraction: estimate all-in cost in source token

Week 21–22  Multi-chain testing, UI updates, docs
```

---

## V3 — Full Router

### What V3 Adds

V3 makes Conduit the canonical CCTP-native routing layer:

**Full coverage:** All CCTP V2 chains plus V1-legacy chains
as they migrate (Noble/Cosmos, Sui, Aptos once on V2).

**Programmatic API:** REST API and TypeScript SDK so other
apps can route through Conduit without building their own
CCTP integration.

**Reverse routes:** Every V1 and V2 pair now works both
directions. XLM → AVAX, SOL → XLM, etc.

**Multi-hop routes:** For chains with thin direct USDC
liquidity, route source token → USDC → CCTP → USDC →
intermediate liquid token → final destination token via
a second same-chain swap.

**Aggregator integration:** Submit Conduit as a route
provider to Li.Fi and Squid so their users get Conduit
routes when CCTP is the best option.

### V3 SDK (TypeScript)

```typescript
import { Conduit } from '@conduit-swap/sdk'

const conduit = new Conduit({ apiKey: 'YOUR_KEY' })

// Get a quote
const quote = await conduit.quote({
  sourceChain: 'avalanche',
  sourceToken: 'AVAX',
  destinationChain: 'stellar',
  destinationToken: 'XLM',
  amount: '100', // in source token
})
// Returns: expectedOutput, fees, estimatedTime, route

// Execute a swap
const tx = await conduit.swap({
  quote,
  userAddress: '0xYourEvmAddress',
  stellarAddress: 'GYourStellarAddress',
  slippage: 0.5, // 0.5%
})
```

### V3 REST API

```
GET  /v1/quote?from=avalanche:AVAX&to=stellar:XLM&amount=100
GET  /v1/chains                    → list all supported chains + tokens
GET  /v1/routes?from=avax&to=xlm  → available routes with details
POST /v1/swap                      → initiate swap, returns tx data
GET  /v1/status/:txHash            → track transfer status
GET  /v1/pairs                     → all supported trading pairs
```

### V3 Timeline

```
Week 23–26  Noble/Cosmos integration (once V2 live)
            Sui integration (once V2 live)
            Aptos integration (once V2 live)
            Reverse routes for all V1/V2 pairs

Week 27–30  TypeScript SDK development
            REST API with rate limiting + API keys
            OpenAPI spec + documentation site

Week 31–34  Li.Fi plugin submission
            Squid route provider registration
            Dune analytics dashboard for volume tracking
            Revenue dashboard (fee accumulation)
```

---

## User Flow

### V1 Flow (AVAX → XLM)

```
1. CONNECT
   ─────────────────────────────────────────
   User opens Conduit
   Connects Avalanche wallet (Core / MetaMask)
   Pastes Stellar address (or connects Freighter)

2. QUOTE
   ─────────────────────────────────────────
   Enters: 100 AVAX
   Conduit shows:
   ┌─────────────────────────────────────┐
   │  You send:    100 AVAX              │
   │  You receive: ~3,847 XLM            │
   │                                     │
   │  Rate:        1 AVAX = 38.47 XLM   │
   │  Bridge fee:  0 (CCTP charges none) │
   │  Source gas:  ~0.02 AVAX            │
   │  Dest gas:    ~0.00001 XLM          │
   │  Slippage:    0.5%                  │
   │  ETA:         30–60 seconds         │
   │                                     │
   │  Route: AVAX → USDC (LFJ)           │
   │         → CCTP V2 burn/mint         │
   │         → XLM (SDEX path payment)   │
   └─────────────────────────────────────┘

3. CONFIRM & SIGN
   ─────────────────────────────────────────
   User reviews quote
   Clicks "Swap"
   Signs ONE transaction on Avalanche:
     - Approves USDC spend
     - Calls SwapAndBurn.sol with:
       sourceAmount: 100 AVAX
       minUsdcOut: (calculated with slippage)
       destinationDomain: 27 (Stellar)
       stellarRecipient: user's G... address
       minXlmOut: 3,847 * 0.995 (slippage floor)

4. AUTOMATED EXECUTION
   ─────────────────────────────────────────
   Conduit backend:
   a. Watches DepositForBurn event on Avalanche
   b. Polls Circle Iris attestation API
   c. On attestation received (~15 seconds):
      Submits mint_and_forward to CctpForwarder on Stellar
      CctpForwarder mints USDC + triggers Soroban swap
      Soroban swap executes USDC → XLM path payment
      XLM lands in user's Stellar address

5. CONFIRMATION
   ─────────────────────────────────────────
   UI shows:
   ✅ Swap complete
   3,851 XLM received
   (Stellar transaction hash: ABC123...)
   (Avalanche transaction hash: DEF456...)
```

### Status Tracker

Conduit provides a real-time status page per swap:

```
◉ Avalanche → USDC swap      ✅ confirmed (block 49,841,003)
◉ CCTP burn submitted         ✅ confirmed (tx 0xabc...)
◉ Circle Iris attestation     🔄 waiting (est. 10 seconds)
◉ Stellar USDC mint           ⏳ pending
◉ XLM path payment            ⏳ pending
◉ XLM delivered               ⏳ pending
```

---

## Technical Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                          CONDUIT                               │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                   FRONTEND (Next.js)                     │  │
│  │  Swap UI | Quote display | Status tracker | History     │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              ↕                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                   QUOTE ENGINE (Rust)                    │  │
│  │  DEX APIs → USDC rate | CCTP fee | Destination DEX rate │  │
│  │  Slippage calculation | Gas estimation | Route selection │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              ↕                                 │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │  SOURCE CHAIN    │  │  DESTINATION CHAIN               │  │
│  │  ─────────────── │  │  ────────────────────────────── │  │
│  │  SwapAndBurn.sol │  │  ReceiveAndSwap.sol (EVM)        │  │
│  │  DEX aggregator  │  │  Soroban contract (Stellar)      │  │
│  │  TokenMessenger  │  │  CctpForwarder (Stellar)         │  │
│  └──────────────────┘  └──────────────────────────────────┘  │
│                              ↕                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │              RELAYER SERVICE (Rust backend)              │  │
│  │  Watches burn events | Polls Circle Iris API            │  │
│  │  Submits mint tx on destination | Tracks status         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                              ↕                                 │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                    CIRCLE IRIS API                       │  │
│  │  Attestation: POST /v1/attestations/{hash}              │  │
│  │  Polls until status: "complete"                         │  │
│  │  Returns signed attestation bytes                       │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## CCTP V2 Integration

### Key Contracts (Avalanche C-Chain Mainnet)

```
# Always verify against Circle's canonical docs:
# https://developers.circle.com/cctp/contracts

TokenMessenger (Avalanche C-Chain):
  Reference: developers.circle.com/cctp/contracts

MessageTransmitter (Avalanche C-Chain):
  Reference: developers.circle.com/cctp/contracts

USDC (Avalanche C-Chain native):
  Reference: developers.circle.com/stablecoins/usdc-on-testing-networks

TokenMessenger (Stellar Domain 27):
  Deployed as Soroban contract
  Reference: developers.circle.com/cctp/references/stellar
```

> All contract addresses must be verified against Circle's
> official documentation before use. Addresses are deterministic
> per chain (same code, same deployer) — verify the source before
> building.

### CCTP V2 Domain IDs

```
Domain 0:  Ethereum
Domain 1:  Avalanche C-Chain
Domain 2:  OP Mainnet
Domain 3:  Arbitrum
Domain 4:  Noble (Cosmos) — V1 only
Domain 5:  Solana
Domain 6:  Base
Domain 7:  Polygon PoS
Domain 8:  Sui — V1 only
Domain 9:  Aptos — V1 only
Domain 27: Stellar
```

### The Three Transfer Modes

```
FAST TRANSFER (use this by default)
────────────────────────────────────────────────────
Finality:  8–20 seconds
Fee:       Small Fast fee to Circle (passed to user)
How:       Circle fronts liquidity on destination,
           settles burn async
Best for:  All user-facing swaps

STANDARD TRANSFER
────────────────────────────────────────────────────
Finality:  Minutes (matches source chain finality)
Fee:       Gas only — Circle charges nothing
How:       Wait for source chain finality, then mint
Best for:  Large transfers, fee-sensitive routes

HOOKS (V2 only, used on EVM destinations)
────────────────────────────────────────────────────
What:      Post-mint action executes atomically
How:       hookData encodes the call: swap USDC →
           target token on destination DEX
Result:    User never holds intermediate USDC
Note:      CctpForwarder is Stellar's equivalent
```

### Burn Function (EVM Source)

```solidity
// SwapAndBurn.sol — called by user on source chain
function swapAndBurn(
    address sourceToken,
    uint256 sourceAmount,
    uint256 minUsdcOut,
    uint32  destinationDomain,
    bytes32 mintRecipient,        // hook contract on destination
    bytes   calldata hookData     // encoded swap on destination
) external payable {
    // 1. Swap sourceToken → USDC via aggregator
    uint256 usdcOut = _swapToUsdc(
        sourceToken,
        sourceAmount,
        minUsdcOut
    );

    // 2. Approve TokenMessenger
    USDC.approve(TOKEN_MESSENGER, usdcOut);

    // 3. CCTP V2 burn with hook
    ITokenMessengerV2(TOKEN_MESSENGER).depositForBurnWithHook(
        usdcOut,
        destinationDomain,
        mintRecipient,   // ReceiveAndSwap.sol or CctpForwarder
        address(USDC),
        bytes32(0),      // no specific caller restriction
        MAX_FEE,
        MIN_FINALITY,
        hookData
    );

    emit SwapInitiated(
        msg.sender,
        sourceToken,
        sourceAmount,
        usdcOut,
        destinationDomain
    );
}
```

### Receive and Swap (EVM Destination)

```solidity
// ReceiveAndSwap.sol — called by Circle on destination chain
// Implements IHookReceiver
function handleReceiveMessage(
    uint32  sourceDomain,
    bytes32 sender,
    bytes   calldata hookData
) external override onlyMessageTransmitter returns (bool) {
    // Decode hook data: target token + min output + recipient
    (address targetToken, uint256 minOut, address recipient) =
        abi.decode(hookData, (address, uint256, address));

    // Swap USDC → target token via destination DEX
    uint256 received = _swapFromUsdc(
        targetToken,
        USDC.balanceOf(address(this)),
        minOut
    );

    // Transfer to recipient
    IERC20(targetToken).transfer(recipient, received);

    emit SwapCompleted(recipient, targetToken, received);
    return true;
}
```

### Circle Iris Attestation API

```typescript
// Poll until attestation is available
async function waitForAttestation(
  txHash: string,
  sourceChain: string
): Promise<string> {
  const url = `https://iris-api.circle.com/v1/attestations/${txHash}`

  while (true) {
    const res = await fetch(url)
    const data = await res.json()

    if (data.status === 'complete') {
      return data.attestation // signed bytes
    }

    // Fast Transfer: check every 2 seconds
    await sleep(2000)
  }
}
```

---

## Stellar Integration

### Why Stellar Is Different

Stellar is not EVM-compatible. The CCTP integration uses different
primitives: Soroban (Stellar's Rust-based smart contract environment),
the SDEX (Stellar's native built-in DEX), and the CctpForwarder
(a publicly-callable Soroban contract Circle deployed to handle
CCTP mints to Stellar addresses).

### The CctpForwarder Requirement

This is the most critical piece of the Stellar integration.
Standard CCTP mints assume the mintRecipient is an EVM address.
On Stellar, addresses use a different encoding (strkey format:
G... for accounts, C... for contracts). The CctpForwarder
bridges this gap.

```
RULE: When sending USDC to Stellar via CCTP, BOTH
      mintRecipient AND destinationCaller MUST be set
      to the CctpForwarder contract address.

If either is wrong → funds permanently stuck, unrecoverable.
This is not a soft error. Test exhaustively on testnet first.
```

Hook data encoding for Stellar:

```
hookData format:
[magic bytes (28 bytes)] [version (1 byte)] [payload length (4 bytes)]
[forwardRecipient strkey] [optional trailing bytes]

Where forwardRecipient is:
- G... address (user's Stellar account) → receives USDC
- C... address (your Soroban swap contract) → receives USDC and swaps to XLM
```

For AVAX → XLM, the forwardRecipient is your Soroban swap
contract, which immediately converts USDC to XLM and forwards
XLM to the user.

### Soroban Swap Contract (Rust)

```rust
// conduit_swap/src/lib.rs
#![no_std]
use soroban_sdk::{contract, contractimpl, Address, Env, token};

#[contract]
pub struct ConduitSwap;

#[contractimpl]
impl ConduitSwap {
    // Called by CctpForwarder when USDC arrives
    pub fn receive_and_swap(
        env: Env,
        usdc_amount: i128,
        min_xlm_out: i128,
        recipient: Address,
    ) -> i128 {
        let usdc_client = token::Client::new(&env, &get_usdc_address(&env));
        let xlm_client  = token::Client::new(&env, &get_xlm_address(&env));

        // Execute SDEX path payment: USDC → XLM
        // Uses Stellar's built-in atomic path payment operation
        let xlm_received = env.invoke_contract(
            &get_sdex_address(&env),
            &Symbol::new(&env, "path_payment_strict_send"),
            vec![
                &env,
                usdc_amount.into_val(&env),
                min_xlm_out.into_val(&env),
                recipient.into_val(&env),
            ],
        );

        assert!(xlm_received >= min_xlm_out, "slippage exceeded");
        xlm_received
    }
}
```

### Decimal Precision Handling

```
CCTP messages use 6 decimal precision for USDC amounts.
Stellar USDC uses 7 decimal precision.

Effect: Small remainders stay on the source chain.
        These are dust amounts (< $0.000001) and are acceptable.

In the UI, display:
"You may retain up to 0.0001 USDC on Avalanche
 due to decimal precision differences. This is normal."

In the contract: calculate minimum USDC out accounting for
                 the precision floor before initiating burn.
```

### Stellar Testnet Resources

```
Stellar Testnet RPC:  https://soroban-testnet.stellar.org
Stellar Mainnet RPC:  https://mainnet.stellar.validationcloud.io/v1/YOUR_KEY
Horizon testnet:      https://horizon-testnet.stellar.org
Horizon mainnet:      https://horizon.stellar.org
Friendbot (testnet funding): https://friendbot.stellar.org

CCTP testnet docs:    https://developers.circle.com/cctp/references/stellar
Soroban CLI:          cargo install --locked soroban-cli
Soroban SDK (Rust):   soroban-sdk = "22.0.0"

Stellar Lab (UI):     https://lab.stellar.org
Stellar Community:    https://discord.gg/stellardev
```

---

## Smart Contracts

### Contract Overview

```
contracts/
├── evm/
│   ├── SwapAndBurn.sol          ← Source chain: swap + CCTP burn
│   ├── ReceiveAndSwap.sol       ← Destination EVM: mint hook + swap
│   └── interfaces/
│       ├── ITokenMessengerV2.sol
│       └── IHookReceiver.sol
└── stellar/
    └── conduit_swap/
        ├── src/lib.rs           ← Soroban: receive USDC + swap to XLM
        └── Cargo.toml
```

### SwapAndBurn.sol — Key Parameters

```solidity
contract SwapAndBurn {
    address public constant TOKEN_MESSENGER_V2 =
        0x... ; // from Circle docs: developers.circle.com/cctp/contracts

    address public constant USDC =
        0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6; // USDC on Avalanche mainnet

    // 1inch aggregation router on Avalanche
    address public constant AGGREGATION_ROUTER =
        0x111111125421cA6dc452d289314280a0f8842A65;

    // Supported destination domains
    uint32 public constant DOMAIN_STELLAR = 27;
    uint32 public constant DOMAIN_SOLANA  = 5;
    uint32 public constant DOMAIN_BASE    = 6;
    // ... etc

    // Fast Transfer: minimum finality blocks
    uint32 public constant MIN_FINALITY = 1;
    // Max fee: acceptable Circle fee for Fast Transfer
    uint256 public constant MAX_FEE = 1e6; // 1 USDC max fee
}
```

---

## Fee Structure

CCTP itself is free at the protocol level. Conduit's fee
stack has three components:

```
COMPONENT         AMOUNT           PAID TO
───────────────────────────────────────────────────────────
Source DEX swap   0.05–0.3%        DEX protocol + LPs
CCTP Fast fee     ~0.001 USDC      Circle (Fast Transfer only)
Conduit fee       0.05%            Conduit treasury
Destination DEX   0.05–0.3%        DEX protocol + LPs
Source gas        ~$0.01–$0.05     Source chain validators
Destination gas   ~$0.0001–$0.01   Destination chain validators
───────────────────────────────────────────────────────────
Total (typical)   0.1–0.7%         All-in for a swap
```

All fees are shown upfront in the quote before the user signs.
No hidden fees. The quote shows the exact output including
all costs.

### Revenue Model

Conduit takes 5 basis points (0.05%) on every swap volume.
At $10M monthly volume → $5,000/month. At $100M monthly →
$50,000/month. This is entirely self-sustaining at scale
and funds ongoing development.

A portion of the Conduit fee accumulates in a treasury
contract and can be used to sponsor gas on the destination
chain (paying the user's Stellar or destination gas from
Conduit's treasury, improving UX for non-native users).

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind | Swap UI, quote display, status tracker |
| Wallet | wagmi + viem, Freighter SDK | EVM + Stellar wallet connections |
| EVM Contracts | Solidity 0.8.20, Foundry | SwapAndBurn, ReceiveAndSwap |
| Stellar Contracts | Rust, Soroban SDK 22.0 | USDC→XLM swap contract |
| Backend/Relayer | Rust, Tokio, axum | Attestation polling, Stellar mint submission |
| DEX Aggregation | 1inch API, Jupiter API | Source/destination swap quotes |
| CCTP | Circle Bridge Kit, Iris API | Burn, attestation, mint |
| Database | PostgreSQL, Supabase | Swap history, status tracking |
| Monitoring | Prometheus, Grafana | Volume, latency, error tracking |
| Testing | Foundry (Solidity), cargo test (Rust) | Contract and integration tests |

---

## Getting Started

### Prerequisites

```bash
# EVM development
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Rust + Soroban
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --locked soroban-cli

# Node.js >= 18
node --version
```

### Install

```bash
git clone https://github.com/yourhandle/conduit
cd conduit
npm install               # Frontend
cd contracts && npm install
```

### Deploy V1 Contracts (Fuji Testnet First)

```bash
# Deploy SwapAndBurn.sol to Fuji
forge create \
  --rpc-url https://api.avax-test.network/ext/bc/C/rpc \
  --private-key $PRIVATE_KEY \
  contracts/evm/SwapAndBurn.sol:SwapAndBurn

# Build and deploy Soroban swap contract to Stellar testnet
cd contracts/stellar/conduit_swap
soroban contract build
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/conduit_swap.wasm \
  --source $STELLAR_SECRET_KEY \
  --network testnet
```

### Run Frontend

```bash
npm run dev
# Open http://localhost:3000
```

---

## Environment Variables

```env
# ─── Chain RPC ──────────────────────────────────────────────
NEXT_PUBLIC_AVAX_RPC=https://api.avax.network/ext/bc/C/rpc
NEXT_PUBLIC_ETH_RPC=https://mainnet.infura.io/v3/YOUR_KEY
NEXT_PUBLIC_STELLAR_RPC=https://mainnet.stellar.validationcloud.io/v1/YOUR_KEY
NEXT_PUBLIC_STELLAR_HORIZON=https://horizon.stellar.org

# ─── Contracts ──────────────────────────────────────────────
NEXT_PUBLIC_SWAP_AND_BURN_AVAX=0x...       # deployed SwapAndBurn on Avalanche
NEXT_PUBLIC_RECEIVE_AND_SWAP_BASE=0x...    # deployed ReceiveAndSwap on Base
NEXT_PUBLIC_SOROBAN_SWAP_CONTRACT=C...     # deployed Soroban contract on Stellar

# ─── Circle ─────────────────────────────────────────────────
CIRCLE_IRIS_API=https://iris-api.circle.com  # mainnet attestations
CIRCLE_IRIS_TESTNET=https://iris-api-sandbox.circle.com

# ─── DEX APIs ───────────────────────────────────────────────
INCH_API_KEY=your_1inch_api_key
JUPITER_API=https://quote-api.jup.ag/v6
STELLAR_HORIZON=https://horizon.stellar.org

# ─── Backend ────────────────────────────────────────────────
DATABASE_URL=postgresql://conduit:password@localhost:5432/conduit
RELAYER_PRIVATE_KEY=0x...    # relayer wallet for submitting Stellar mints
RELAYER_STELLAR_SECRET=S...  # Stellar secret key for relayer

# ─── WalletConnect ──────────────────────────────────────────
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id
```

---

## Security Model

### Trust Assumptions

Conduit's security model has exactly one trust dependency:
Circle's attestation service (Iris). This is the same trust
assumption as holding USDC on any chain. If you use native
USDC, you already trust Circle. Conduit adds nothing on top.

Compare to multi-protocol aggregators: Li.Fi routes through
Wormhole, LayerZero, Stargate, Across, etc. Each adds its
own trust assumption. A Conduit swap has fewer trust
dependencies than most DeFi transactions users already do.

### Smart Contract Risk Mitigations

```
1. No token custody:
   SwapAndBurn.sol holds no tokens at rest.
   ReceiveAndSwap.sol holds USDC for one transaction only.
   If a call reverts, USDC stays in the contract temporarily
   but an emergency withdrawal function (owner-only) recovers it.

2. Slippage protection:
   minUsdcOut on the source swap
   minTokenOut on the destination swap
   Both enforced on-chain — no outcome worse than stated

3. CctpForwarder safety:
   Never set mintRecipient to a user's Stellar address directly.
   Always use CctpForwarder as both mintRecipient and destinationCaller.
   This is enforced in SwapAndBurn.sol for Stellar destinations.

4. Pausable contracts:
   Owner can pause in case of emergency.
   Pausing prevents new swaps but does not affect in-flight transfers.

5. Decimal guard:
   Source-side USDC amount is floored to 6 decimal precision
   before burn, preventing precision-mismatch revert on Stellar.
```

### Audit Plan

Before mainnet launch, the following contracts require audit:
- `SwapAndBurn.sol` — handles user funds
- `ReceiveAndSwap.sol` — handles minted USDC
- `conduit_swap` (Soroban) — handles USDC→XLM conversion

Audit firms with Soroban experience: OtterSec, Certik (Stellar
track record), or dedicated Stellar community auditors.

---

## Grant Strategy

Conduit is uniquely positioned to target four simultaneous
grant programs, each funding a different component of the
same product.

### 1. Circle Developer Grants — Up to $100K USDC

Circle's 2026 grant program explicitly prioritizes cross-chain
payment infrastructure and CCTP integrations. Eight of nineteen
cohort-1 2026 grantees are Africa-founded. A Lagos-based builder
creating the first non-custodial AVAX→XLM route using CCTP V2 —
connecting Avalanche DeFi to Stellar's remittance infrastructure
in African and emerging markets — is a near-perfect match for
what Circle says it wants to fund.

Application: circle.com/grant
Emphasize: CCTP V2 native, emerging markets remittance use case,
           Africa-based builder, Stellar + USDC utility expansion

### 2. Arc Builders Fund — Circle Ventures

Circle Ventures' Arc Builders Fund funds early-stage teams
building on Arc (Circle's L1, which uses USDC as native gas).
Conduit routes through USDC as its core primitive. The Arc
connection: if Arc becomes a CCTP-supported chain, it's
automatically a Conduit source/destination. Applying to Arc
Builders Fund positions Conduit as a native Arc ecosystem product.

Application: circle.com/blog/introducing-the-arc-builders-fund
Emphasize: USDC as the settlement layer, Arc as future chain target

### 3. Avalanche Team1 Mini Grant — Up to $10K AVAX

The Avalanche component of Conduit — SwapAndBurn.sol,
LFJ/1inch integration, Core wallet support — is a standalone
Avalanche DeFi product. V1 launches AVAX as the primary
source asset. Apply for the Avalanche Mini Grant citing:
- Avalanche as V1 source chain
- Core wallet integration
- First AVAX → Stellar non-custodial route

Application: grants.team1.network
Emphasize: Avalanche as source, DeFi infrastructure category

### 4. Stellar Community Fund — SCF

The Stellar-side components — Soroban swap contract,
CctpForwarder integration, SDEX path payment — are pure
Stellar ecosystem contributions. The Stellar Community Fund
has an active RFP for trustline automation, which Conduit's
architecture sidesteps entirely (users receive XLM directly,
never needing a USDC trustline). This is a working solution
to an open Stellar ecosystem problem.

Application: https://stellar.gitbook.io/scf-handbook
Emphasize: Soroban contract, SDEX integration, trustline
           abstraction, USDC utility on Stellar

### Grant Application Sequence

```
Week 1:   Apply Circle Developer Grants (open now)
Week 2:   Apply Avalanche Team1 Mini Grant (open now)
Week 3:   Apply SCF (quarterly — check current window)
Week 4+:  Apply Arc Builders Fund (rolling)
```

---

## Roadmap

### V1 — AVAX → XLM (Weeks 1–12)

- [ ] Soroban development environment + testnet setup
- [ ] CctpForwarder integration study + testnet tests
- [ ] AVAX → USDC aggregator (LFJ) integration
- [ ] CCTP V2 DepositForBurnWithHook() implementation
- [ ] Soroban swap contract: USDC → XLM via SDEX path payment
- [ ] Circle Iris attestation polling relayer (Rust)
- [ ] End-to-end Fuji → Stellar testnet flow
- [ ] Decimal precision handling (7 vs 6 decimal)
- [ ] Swap UI with live quote, status tracker, history
- [ ] Core wallet + WalletConnect + Freighter integration
- [ ] Security review + testnet stress test
- [ ] Mainnet launch: AVAX → XLM live

### V2 — All CCTP EVM Pairs (Weeks 13–22)

- [ ] 1inch/Paraswap API integration for all EVM chains
- [ ] SwapAndBurn.sol deployed on all CCTP V2 EVM sources
- [ ] ReceiveAndSwap.sol deployed on all CCTP V2 EVM destinations
- [ ] Jupiter API integration (Solana)
- [ ] Solana-specific CCTP V2 program interaction
- [ ] Multi-route quote comparison UI
- [ ] Reverse routes: XLM → AVAX, SOL → AVAX, etc.
- [ ] Full V2 chain matrix: all 15+ CCTP V2 chains

### V3 — Full Router + SDK (Weeks 23–34)

- [ ] Noble/Cosmos integration (when V2 live)
- [ ] Sui integration (when V2 live)
- [ ] Aptos integration (when V2 live)
- [ ] TypeScript SDK: `@conduit-swap/sdk`
- [ ] REST API with rate limiting + API keys
- [ ] OpenAPI spec + documentation site
- [ ] Li.Fi plugin submission
- [ ] Squid route provider registration
- [ ] Dune analytics dashboard
- [ ] Volume and revenue dashboard

### Post-V3

- [ ] Every new CCTP chain automatically supported on launch
- [ ] USDT routes (if USDT adds CCTP support)
- [ ] Mobile app (React Native)
- [ ] Arc (Circle's L1) as source/destination

---

## Ecosystem Resources

### Circle / CCTP

| Resource | URL |
|---|---|
| CCTP V2 overview | https://developers.circle.com/cctp |
| Supported chains + domains | https://developers.circle.com/cctp/concepts/supported-chains-and-domains |
| CCTP on Stellar | https://developers.circle.com/cctp/references/stellar |
| Circle Bridge Kit | https://developers.circle.com/cctp/bridge-kit |
| Circle Iris API | https://iris-api.circle.com |
| Circle Developer Grants | https://www.circle.com/grant |
| Arc Builders Fund | https://www.circle.com/blog/introducing-the-arc-builders-fund |
| CCTP Dune Dashboard | https://dune.com/circle/cctp |

### Avalanche

| Resource | URL |
|---|---|
| Builder Hub | https://build.avax.network |
| CCTP on Avalanche | https://build.avax.network/integrations |
| LFJ DEX | https://lfj.gg |
| 1inch on Avalanche | https://1inch.io |
| Snowtrace Explorer | https://snowtrace.io |
| Team1 Grants | https://grants.team1.network |
| AVAX Faucet (Fuji) | https://faucet.avax.network |

### Stellar

| Resource | URL |
|---|---|
| Stellar Docs | https://developers.stellar.org |
| Soroban SDK | https://docs.rs/soroban-sdk |
| CCTP cross-chain transfers | https://developers.stellar.org/docs/tokens/cross-chain-transfers |
| SDEX path payments | https://developers.stellar.org/docs/build/guides/transactions/path-payments |
| Soroswap DEX | https://soroswap.finance |
| Aquarius DEX | https://aqua.network |
| Horizon API | https://horizon.stellar.org |
| Stellar Community Fund | https://stellar.gitbook.io/scf-handbook |
| Stellar testnet funding | https://friendbot.stellar.org |
| Freighter wallet | https://freighter.app |

---

## Contributing

```bash
# Branch naming
feat/v2-solana-integration
fix/stellar-decimal-precision
chore/update-cctp-v2-contracts

# Before submitting
forge test           # all EVM tests pass
cargo test           # all Rust tests pass
npm run type-check   # TypeScript clean
```

---

## License

MIT © Godbrand (Thompson Eregha)

Conduit is open source. The protocol is permissionless.
Circle's CCTP is open source under Apache 2.0.

---

> *Native assets in. Native assets out. USDC in the middle.
> Circle's burn-and-mint is the only bridge Conduit will ever use.*
