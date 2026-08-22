# Conduit Deployments & On-Chain Proofs

All transactions below are verifiable on public testnet explorers.
Deployer/relayer: `0x6dC4F7e7dC254777B8301eF3f89dD7757740c5f7`

## Contracts — v2 (current)

v2 executors add in-swap USDC refunds (to the recipient in the attested
hookData, so refunds survive contract-initiated burns) and `amountIn = 0` =
"swap all minted USDC". SwapAndBurn is the source-side half: native ETH (or
any ERC20) → USDC → CCTP burn with hook, in one transaction.

| Contract | Chain | Address | Deploy tx |
|---|---|---|---|
| ReceiveAndSwap v2 | Arbitrum Sepolia | [`0x9B6aaDaEeD2cAF2B3b26C62aA5dEaCcB8052F40B`](https://sepolia.arbiscan.io/address/0x9B6aaDaEeD2cAF2B3b26C62aA5dEaCcB8052F40B) | [`0x7b09b402…cd2f7d`](https://sepolia.arbiscan.io/tx/0x7b09b402d73aea6b0e21bb0f8daa683b616fbb10b3ff157214df707252cd2f7d) |
| ReceiveAndSwap v2 | Base Sepolia | [`0x86986974E1B45Dd370AD90Fe8747e86C355b0866`](https://sepolia.basescan.org/address/0x86986974E1B45Dd370AD90Fe8747e86C355b0866) | [`0x1903b5f4…4e6f17`](https://sepolia.basescan.org/tx/0x1903b5f49c75e0ca92ec83f3939259aaf7b0d09093e84f9d87ed0d6e1d4e6f17) |
| ReceiveAndSwap v2 | Ethereum Sepolia | [`0x226EC562076549FdD16ecaaF437CD77E49D102c5`](https://sepolia.etherscan.io/address/0x226EC562076549FdD16ecaaF437CD77E49D102c5) | [`0x60d8e9ae…2e2a26`](https://sepolia.etherscan.io/tx/0x60d8e9ae71a35059f6db999ac65065946e4ebc791d9b7aa0eb341054ed2e2a26) |
| ReceiveAndSwap v2 | OP Sepolia | [`0xAead88469c8DBdA0efd12c6993eDCb2F171D8203`](https://sepolia-optimism.etherscan.io/address/0xAead88469c8DBdA0efd12c6993eDCb2F171D8203) | [`0x66cd3411…58f75d`](https://sepolia-optimism.etherscan.io/tx/0x66cd341153d017bae4cee703263f3c0e6196ffeb286aa3f5c1f47beadd58f75d) |
| SwapAndBurn (fee-enabled, `FEE_BPS = 5`) | Base Sepolia | [`0xc3Deb7F7Ad5075618e1055EC2aaf27659740F022`](https://sepolia.basescan.org/address/0xc3Deb7F7Ad5075618e1055EC2aaf27659740F022) | — |
| SwapAndBurn (fee-enabled) | Arbitrum Sepolia | [`0xcEE2b537Ee71c0B4399761537357c1c2B5A5F6Ec`](https://sepolia.arbiscan.io/address/0xcEE2b537Ee71c0B4399761537357c1c2B5A5F6Ec) | — |
| SwapAndBurn (fee-enabled) | Ethereum Sepolia | [`0x9A732afcA3Fbc0FB9a0dDF677dC1c35549499766`](https://sepolia.etherscan.io/address/0x9A732afcA3Fbc0FB9a0dDF677dC1c35549499766) | — |
| SwapAndBurn (fee-enabled) | OP Sepolia | [`0x84B1634Ec67d309AEB9DC422F001350e467DCBc8`](https://sepolia-optimism.etherscan.io/address/0x84B1634Ec67d309AEB9DC422F001350e467DCBc8) | — |
| SwapAndBurn v1 (no fee, superseded) | Base Sepolia | `0x9bF592B913BB735d1e4fed5c5B5a6073B9b4E62E` | [`0x3063fdfe…9bf589`](https://sepolia.basescan.org/tx/0x3063fdfe2c0ab645783d30aed00b319b09a6b7a2fe5f1bef78663868a69bf589) |
| ReceiveAndSwap v2 | Unichain Sepolia | [`0x60D6EDA1573f13268f5a925CB8ECabe00ABB2C6f`](https://sepolia.uniscan.xyz/address/0x60D6EDA1573f13268f5a925CB8ECabe00ABB2C6f) | — |
| SwapAndBurn (fee-enabled) | Unichain Sepolia | [`0xcc5b18B89C7709EeB840c2cA4875c39e17d57c21`](https://sepolia.uniscan.xyz/address/0xcc5b18B89C7709EeB840c2cA4875c39e17d57c21) | — |

## Contracts — v1 (historical, superseded by v2)

### ReceiveAndSwap — Arbitrum Sepolia

| | |
|---|---|
| Address | [`0x093E9DC7D8da487fA3A59f63E81d1F1F5D3D97eB`](https://sepolia.arbiscan.io/address/0x093E9DC7D8da487fA3A59f63E81d1F1F5D3D97eB) |
| Deploy tx | [`0xec6fb172a6d4152c283b13ff93d9173d6e61c5399ffed11d1cbf3f810d357063`](https://sepolia.arbiscan.io/tx/0xec6fb172a6d4152c283b13ff93d9173d6e61c5399ffed11d1cbf3f810d357063) |
| Block | 291984149 |
| Constructor | MessageTransmitter `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, USDC `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`, SwapRouter02 `0x101F443B4d1b059569D643917553c771E1b9663E`, WETH9 `0x980B62Da83eFf3D4576C647993b0c1D7faf17c73` |

### ReceiveAndSwap — Base Sepolia

| | |
|---|---|
| Address | [`0x360044f016978d4ca4380bd8577df2CD16abE307`](https://sepolia.basescan.org/address/0x360044f016978d4ca4380bd8577df2CD16abE307) |
| Deploy tx | [`0x8046d376b761341ac9f89af94c57a64f987a3834bee5faa2e70791fe12457938`](https://sepolia.basescan.org/tx/0x8046d376b761341ac9f89af94c57a64f987a3834bee5faa2e70791fe12457938) |
| Block | 44706830 |
| Constructor | MessageTransmitter `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, SwapRouter02 `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`, WETH9 `0x4200000000000000000000000000000000000006` |

### ReceiveAndSwap — Ethereum Sepolia

| | |
|---|---|
| Address | [`0xEfC684378828f4B2f9Cd7816037eBa255d50eB1E`](https://sepolia.etherscan.io/address/0xEfC684378828f4B2f9Cd7816037eBa255d50eB1E) |
| Deploy tx | [`0xcc9ad751748b75667c06f2bf638c944a25e5ab65fa09b6cc4b26d1315625d4d2`](https://sepolia.etherscan.io/tx/0xcc9ad751748b75667c06f2bf638c944a25e5ab65fa09b6cc4b26d1315625d4d2) |
| Block | 11363912 |
| Constructor | MessageTransmitter `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`, SwapRouter02 `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`, WETH9 `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |

### ReceiveAndSwap — OP Sepolia

| | |
|---|---|
| Address | [`0x88a9BcCE07180c85689D3278Ffd7090305C29896`](https://sepolia-optimism.etherscan.io/address/0x88a9BcCE07180c85689D3278Ffd7090305C29896) |
| Deploy tx | [`0xf65f59cf5542f0cc9c32f81433c5974fa2fc933d5faa078ee26d801567ca0177`](https://sepolia-optimism.etherscan.io/tx/0xf65f59cf5542f0cc9c32f81433c5974fa2fc933d5faa078ee26d801567ca0177) |
| Block | 46690621 |
| Constructor | MessageTransmitter `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`, USDC `0x5fd84259d66Cd46123540766Be93DFE6D43130D7`, SwapRouter02 `0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`, WETH9 `0x4200000000000000000000000000000000000006` |

## End-to-End Swap Proofs

### #1 — Base Sepolia → Arbitrum Sepolia (2026-07-27)

USDC on Base Sepolia → CCTP V2 fast transfer → native ETH on Arbitrum Sepolia,
swapped atomically in the relay transaction via `relayAndExecute`.
Driven by published [`@cctp-sdk/core@0.2.0`](https://www.npmjs.com/package/@cctp-sdk/core).

| Step | Chain | Tx |
|---|---|---|
| Burn (`depositForBurnWithHook`, 2.9 USDC, max fee 1.3) | Base Sepolia | [`0x18c02370a86dd2090fbe37592765e9851b985b129647141c510669eb62e57875`](https://sepolia.basescan.org/tx/0x18c02370a86dd2090fbe37592765e9851b985b129647141c510669eb62e57875) |
| Relay + mint + Uniswap V3 swap + ETH delivery | Arbitrum Sepolia | [`0x1aacf096b55cb98aedf2be0c3755b3c9ed4463d0664e4c1e60446d4af92a565e`](https://sepolia.arbiscan.io/tx/0x1aacf096b55cb98aedf2be0c3755b3c9ed4463d0664e4c1e60446d4af92a565e) |

Result: **0.025418869312447023 native ETH** delivered to the recipient.
Attestation time ≈ 14s; end-to-end ≈ 19s. Executor USDC balance after: 0.

### #2 — Arbitrum Sepolia → Base Sepolia (2026-07-27, reverse route)

Same flow in the opposite direction, run with `FROM=arbitrum TO=base pnpm e2e`.

| Step | Chain | Tx |
|---|---|---|
| Burn (`depositForBurnWithHook`, 2.9 USDC, max fee 1.3) | Arbitrum Sepolia | [`0x1285c3e0c5185c7da3e69067e69287cbecc2d5e48edc7d14becec53db39c855d`](https://sepolia.arbiscan.io/tx/0x1285c3e0c5185c7da3e69067e69287cbecc2d5e48edc7d14becec53db39c855d) |
| Relay + mint + Uniswap V3 swap + ETH delivery | Base Sepolia | [`0x856b0e7fda60dd4b5887116007e2d7de16ea0c08716eeb6d67aaeef6ab0627c5`](https://sepolia.basescan.org/tx/0x856b0e7fda60dd4b5887116007e2d7de16ea0c08716eeb6d67aaeef6ab0627c5) |

Result: **0.000904235001660061 native ETH** delivered to the recipient.
End-to-end ≈ 16s. Executor USDC balance after: 0.
(Output differs from proof #1 only because the two testnet pools carry
arbitrary, unrelated prices.)

### #3 — Arbitrum Sepolia → Ethereum Sepolia (2026-07-27)

| Step | Chain | Tx |
|---|---|---|
| Burn (2.9 USDC) | Arbitrum Sepolia | [`0xcdb63c9153cf90c1ab0fd4fe055a22a250105a28f6d7a33c3070df0b80db6725`](https://sepolia.arbiscan.io/tx/0xcdb63c9153cf90c1ab0fd4fe055a22a250105a28f6d7a33c3070df0b80db6725) |
| Relay + mint + swap + ETH delivery | Ethereum Sepolia | [`0xcbc91fae208a9a86b0bfad3355c713d33bcbcade8625f525e4ad174afa9775fb`](https://sepolia.etherscan.io/tx/0xcbc91fae208a9a86b0bfad3355c713d33bcbcade8625f525e4ad174afa9775fb) |

Result: 0.000065445930745602 native ETH delivered (`SwapDelivered` event in the
relay tx; this pool prices ETH unrealistically). Executor USDC after: 0.

### #4 — Arbitrum Sepolia → OP Sepolia (2026-07-27)

| Step | Chain | Tx |
|---|---|---|
| Burn (2.9 USDC) | Arbitrum Sepolia | [`0xf3a90d5f3521c650420f8fb43766f70edf4da685b054d0c840b41562251818e3`](https://sepolia.arbiscan.io/tx/0xf3a90d5f3521c650420f8fb43766f70edf4da685b054d0c840b41562251818e3) |
| Relay + mint + swap + ETH delivery | OP Sepolia | [`0x71c53980e87fd80ab5c6eb39aaa38896258ba3e1d1c63a64ce48e42f447688eb`](https://sepolia-optimism.etherscan.io/tx/0x71c53980e87fd80ab5c6eb39aaa38896258ba3e1d1c63a64ce48e42f447688eb) |

Result: **0.000562537150249797 native ETH** delivered. End-to-end ≈ 20s.

### #5 — FULL NATIVE-TO-NATIVE: Base Sepolia ETH → Arbitrum Sepolia ETH (2026-07-27)

The complete Conduit product loop, one user signature end to end:
`swapAndBurnNative` swapped 0.004 native ETH → USDC on Base's Uniswap V3 and
burned it via `depositForBurnWithHook` **in a single transaction**; the relay
minted on Arbitrum and swapped all minted USDC (`amountIn = 0`) to native ETH.
Run with `scripts/e2e-native.ts` against v2 contracts.

| Step | Chain | Tx |
|---|---|---|
| Swap (ETH→USDC) + CCTP burn, one tx | Base Sepolia | [`0xaeb0313c2d0c80c62c3a00442a4559f328c783917082da9894a0937ccc0022e3`](https://sepolia.basescan.org/tx/0xaeb0313c2d0c80c62c3a00442a4559f328c783917082da9894a0937ccc0022e3) |
| Relay + mint + swap (USDC→ETH), one tx | Arbitrum Sepolia | [`0xc5f61b6de30f16da051537a3867b1c6e1dfde89c803335e1bdbeb3a25b64d4a6`](https://sepolia.arbiscan.io/tx/0xc5f61b6de30f16da051537a3867b1c6e1dfde89c803335e1bdbeb3a25b64d4a6) |

Result: **0.110835143317079112 native ETH** delivered on Arbitrum.
(The apparent gain is the two testnet pools' arbitrary prices disagreeing —
mainnet pools arbitrage this away.)

### #6 — Native-to-native WITH 0.05% Conduit fee: Arbitrum → OP Sepolia (2026-07-27)

First swap through the fee-enabled SwapAndBurn, and a third distinct source
chain. 0.05 native ETH → ~3.14 USDC on Arbitrum's Uniswap; **0.001571 USDC
(exactly 5 bps) retained in the treasury**; the rest burned and delivered as
native ETH on OP Sepolia.

| Step | Chain | Tx |
|---|---|---|
| Swap + 0.05% fee + burn, one tx | Arbitrum Sepolia | [`0xd967ef21bc4915bd73c2227b57ce5c46550d505b4c6866c9bd2b206d14014849`](https://sepolia.arbiscan.io/tx/0xd967ef21bc4915bd73c2227b57ce5c46550d505b4c6866c9bd2b206d14014849) |
| Relay + mint + swap, one tx | OP Sepolia | [`0xeac3b54148856e1d09aea600428928d332b9112bac2fdae4bba7a3a3fce79078`](https://sepolia-optimism.etherscan.io/tx/0xeac3b54148856e1d09aea600428928d332b9112bac2fdae4bba7a3a3fce79078) |

Result: **0.001093259470395926 native ETH** delivered on OP Sepolia.
Treasury balance verifiable on-chain: `USDC.balanceOf(0xcEE2…F6Ec) = 1571`.

### #7 & #8 — Arc Testnet ↔ Base Sepolia (2026-07-30, 5th chain, zero new contracts)

Arc's native gas token *is* USDC — confirmed on-chain: `eth_getBalance` and
the "USDC" address `0x3600…0000` (an ERC20-view precompile, `decimals()=6`,
**not** 18 as the SDK's `usdcDecimals` field claims — SDK bug, see
[cctp_sdk](https://github.com/Godbrand0/cctp_sdk) issues) return the same
balance at a 10^12 scale factor. TokenMessenger and MessageTransmitter are
deployed at the standard testnet addresses, same as every other CCTP V2 chain.

This means Arc needs **no Conduit contracts at all**:
- **Arc → anywhere**: no swap step — the sender's native balance already
  is USDC, so the existing SDK's plain `transfer()` burns directly from the
  EOA. Adding a destination hook (e.g. Base's `ReceiveAndSwap`) makes it a
  full native-to-native swap.
- **Anywhere → Arc**: the existing `SwapAndBurn` (ETH→USDC→burn) works
  unchanged — just set `mintRecipient` to the user's own address with no
  hook executor. Minted USDC lands as their native balance directly; there's
  nothing left to swap into.

Scripts: `scripts/arc-to-base.ts`, `scripts/base-to-arc.ts`.

| Direction | Burn tx | Relay tx | Result |
|---|---|---|---|
| Arc → Base (full native-to-native, hook-swapped to ETH) | [`0x13ad19e4…0727df6`](https://testnet.arcscan.app/tx/0x13ad19e4d5178c84d1d2f1325c2ecbebcf91f025faac635cc7e1e1b250727df6) | [`0x8a2b841d…292029`](https://sepolia.basescan.org/tx/0x8a2b841d73da1e171ebaad8bfd782f83da1b06bb60fc6dc926369bfb70292029) | 3 USDC → **0.000982634927642425 ETH**, ~13s |
| Base → Arc (ETH swapped to USDC, delivered native) | [`0x6dfb3828…b96baba5e4`](https://sepolia.basescan.org/tx/0x6dfb38284b9f2a0695ebc45ca7a8ff585604195268ceebe815c148b96baba5e4) | [`0xeea66a24…a9b6b3cd`](https://testnet.arcscan.app/tx/0xeea66a24b5f2f96a30cf102ec3306dbf4b59905d60b7cc91fe9a8b1ba9b6b3cd) | 0.004 ETH → **12.00814 USDC** landed as native balance |

Note: Circle's `depositForBurnWithHook` reverts on empty `hookData`, so the
Base→Arc call (via `SwapAndBurn`, which always uses the hook variant) passes
an inert single byte (`0x00`). It's genuinely never executed — Arc-side
relaying calls plain `receiveMessage`, not a hook executor — so it's dead
cargo exactly like any unused hook elsewhere.

### #9 — Arc wired into the live frontend + relayer (2026-07-30)

Arc is now a selectable chain in the app itself (`frontend/lib/legs.ts`),
not just standalone scripts. Verified through the **actual running app**,
not a reimplementation: burned 0.004 ETH on Base via `SwapAndBurn` exactly
as the UI's `swap()` constructs the call (mintRecipient = own address,
destinationCaller = 0, inert `0x00` hookData), then `POST /api/swaps` to a
live `next start` server and polled `GET /api/swaps/:hash` — confirming
`lib/relayer.ts`'s new Arc branch (plain `receiveMessage` instead of
`relayAndExecute`) runs correctly in production code, end to end:

```
RECEIVED → AWAITING_ATTESTATION → RELAYING → COMPLETE
```

| Step | Tx |
|---|---|
| Burn (Base Sepolia) | [`0xfa53bb28…7e14857a`](https://sepolia.basescan.org/tx/0xfa53bb28a18dd9abc6074767b92b14f826c93a2fefea8d22bf958eb97e14857a) |
| Relay (Arc Testnet, via the app's relayer) | [`0x6d4351fa…2bcf15e4`](https://testnet.arcscan.app/tx/0x6d4351fa3653687fd6e0af88c377fd2a2aea28be7bae0c3751ce18042bcf15e4) |

Result: 11.764396 USDC landed as native balance on Arc, volume correctly
decoded and persisted (`usdcAmount: 11764396`) — the same code path
`/stats` reads from.

Known limitation: Arc-sourced swaps burn directly from the EOA (there's no
SwapAndBurn-equivalent on Arc, since there's nothing to swap), so they
currently skip the 0.05% Conduit fee. `SwapDetailsModal` accounts for this
when displaying the fee breakdown.

### #10 & #11 — Unichain Sepolia ↔ Base Sepolia (2026-08-06, 6th chain)

Uniswap's own rollup. Uniswap V3 is deployed there, but not at the
canonical mainnet addresses — the Factory is (`0x1F98…31F984`, confirmed
via `owner()`), but the SwapRouter02 address had to be found by scanning
a live pool's `Swap` events for a real `exactInputSingle` call and
confirming the sender contract's `factory()`/`WETH9()` match, since
neither the canonical address nor the address returned by a web search
actually resolved on-chain. Verified router:
[`0xd1AAE39293221B77B0C71fBD6dCb7Ea29Bb5B166`](https://sepolia.uniscan.xyz/address/0xd1AAE39293221B77B0C71fBD6dCb7Ea29Bb5B166).
USDC/WETH pools exist at all four standard fee tiers with real liquidity;
deployed against the 3000 (0.3%) tier, matching Base/Arbitrum's convention.

| Direction | Burn tx | Relay tx | Result |
|---|---|---|---|
| Unichain → Base (full native-to-native) | [`0x281364730e…486e4636`](https://sepolia.uniscan.xyz/tx/0x281364730e40db5b41e5986aedc69e9e2f52d20c5a353e85d409a15a486e4636) | [`0xff04065cd7…7f1688147a`](https://sepolia.basescan.org/tx/0xff04065cd704adda91a968b3585c8be0a2992df6b757ebdd6c061b7f1688147a) | 0.02295056 ETH delivered on Base |
| Base → Unichain (reverse route, 0.05% fee) | [`0xdd572eb58d…dd6f61767`](https://sepolia.basescan.org/tx/0xdd572eb58d50888a32d222846d8034440d20809d99e0e8c71770f9bdd6f61767) | [`0x0d05196d4a…497a8b457`](https://sepolia.uniscan.xyz/tx/0x0d05196d4a2348a427ba5142d281bd4829b53c9811f78ff33a23a86497a8b457) | 0.001936672176777817 ETH delivered on Unichain (confirmed via the WETH `Withdrawal` event in the relay tx's logs — the e2e script's own before/after balance readout misleadingly showed ~0, since that run self-relayed and paid its own relay gas from the same wallet it measured) |

Both runs used the 0.05%-fee `SwapAndBurn`; Unichain → Base additionally
proves the destination-side `ReceiveAndSwap` hook execution on a 6th
distinct chain with a non-canonical router address, without any code
changes beyond the deploy-script config.

### #12 & #13 — Avalanche Fuji ↔ Base Sepolia (2026-08-06, 7th chain, new contract variant)

Avalanche is the first chain that needed genuinely new contracts, not just a
deploy-script config entry — Uniswap V3 isn't deployed on Fuji at all. Added
`SwapAndBurnUniV2.sol` / `ReceiveAndSwapUniV2.sol`: identical fee/hook/refund
logic to the V3 contracts, but swapping through a Uniswap-V2-style path-based
router (`swapExactAVAXForTokens`/`swapExactTokensForAVAX`) instead of V3's
`exactInputSingle`. 14 new Foundry tests, same coverage shape as the V3 suite.

Finding a *working* DEX took real investigation. Trader Joe's legacy V1
router (`0xd7f6…A901`) has a real, confirmed WAVAX/USDC pair — but every
state-changing swap against it reverts with no reason, even called directly
(not through our contract), while its own `getAmountsOut` quote function
works fine. Circle's actual USDC has zero liquidity on Trader Joe's modern
V2.2 LBRouter. The working venue turned out to be **Pangolin**
(`0x2D99…B921`, confirmed via `factory()`/`WAVAX()` and a real executed
swap) — real, healthy two-sided liquidity (~496 USDC / ~43.6 WAVAX), and it
only implements the Avalanche-native function names
(`swapExact*AVAX*For*`, not `*ETH*`), which the interface reflects.

| Contract | Address |
|---|---|
| SwapAndBurnUniV2 | [`0x9AcD57857367494eb6CB02Bd2241Cc78FdCdDe8b`](https://testnet.snowtrace.io/address/0x9AcD57857367494eb6CB02Bd2241Cc78FdCdDe8b) |
| ReceiveAndSwapUniV2 | [`0x064B35CA8f0886A10eD7C43E29D558E66b0dea36`](https://testnet.snowtrace.io/address/0x064B35CA8f0886A10eD7C43E29D558E66b0dea36) |

| Direction | Burn tx | Relay tx | Result |
|---|---|---|---|
| Fuji → Base (full native-to-native) | [`0x455e6223…a34abf23`](https://testnet.snowtrace.io/tx/0x455e62233c5300d29f7d5ce81781154f735042ac7eeeb2261d69bb31a34abf23) | [`0x903caee9…4e4dcf53`](https://sepolia.basescan.org/tx/0x903caee94d0f48ed3a2609847da680bc6b2549f44944032e93e420154e4dcf53) | 0.005 AVAX → **0.000333605170089195 ETH** |
| Base → Fuji (reverse route, 0.05% fee) | [`0xcbcd8cda…f62f9b46`](https://sepolia.basescan.org/tx/0xcbcd8cdad9d3d4f562edffe9e6466fdb20ad642c05980037ce54030cf62f9b46) | [`0xf0714051…49bde0b8`](https://testnet.snowtrace.io/tx/0xf0714051923a972fdbc5f027b9848b006c1a998db3372993bb72bbc349bde0b8) | 0.015 ETH → **0.219468797764207856 AVAX** |

Known limitation: the backing pool is real but thin relative to Base/Arbitrum
(~$500-notional at unrealistic testnet pricing, vs. thousands elsewhere), so
swap amounts here are deliberately small. Would very likely work unchanged
against mainnet Trader Joe or Pangolin, which are heavily-used production
routers — this looks like a testnet-maintenance issue (Trader Joe's V1
router) or thin-testnet-liquidity issue (Pangolin), not a flaw in the
contract pattern itself. Also note: Avalanche Fuji's public RPC (like Arc's
and Unichain's) required an explicit gas limit on the swap+burn and relay
calls — automatic gas estimation intermittently reported "exceeds block gas
limit" for these specific contract-to-contract calls.

### #14 — Avalanche wired into the live frontend + relayer (2026-08-15)

Avalanche is now a selectable chain in the app (`frontend/lib/legs.ts`), not
just standalone scripts. Required real new logic, not just a config entry —
the swap/quote code branches on a new `dex: "v2"` field: reserve-based spot
quoting (constant-product math, `getReserves()`) instead of Uniswap V3's
`sqrtPriceX96`, and a V2-shaped ABI (`SWAP_AND_BURN_V2_ABI` /
`SWAP_USDC_TO_NATIVE_V2_ABI` — no `poolFee` param) for both the burn call and
the destination hook. The relayer also needed the same explicit-gas-limit
fix already noted above, applied server-side for a Fuji destination.

Verified through the actual running app (same method as Arc/Unichain): a
Base → Avalanche burn built with the frontend's exact call shape, POSTed to
a live `next start` server's `/api/swaps`, and polled through
`RECEIVED → AWAITING_ATTESTATION → RELAYING → COMPLETE` —

| Step | Tx |
|---|---|
| Burn (Base Sepolia) | [`0xb4ad0bf2…dd71c8`](https://sepolia.basescan.org/tx/0xb4ad0bf2e05ed39425ce5370602e2b01d522f7bd7e9b2c2e1d03e47da4dd71c8) |
| Relay (Avalanche Fuji, via the app's relayer, gas-override path) | [`0xe557a0fc…be482a177`](https://testnet.snowtrace.io/tx/0xe557a0fc36d96f663406baf2a5129c2982518485e5e65b1f2f17cbece482a177) |

confirming the new `dex: "v2"` gas-override path works in production code,
not just the standalone proof scripts.

### #15 — Stellar Testnet — 8th chain, first non-EVM, fully trustless, one signature (2026-08-22)

The largest architectural departure of any chain so far: Stellar is non-EVM
(Soroban/Rust, not Solidity), and Circle's Stellar-side contract —
`CctpForwarder` — has **no atomic hook-execution capability** the way EVM's
`MessageTransmitter` + a hook executor does. `CctpForwarder.mint_and_forward`
only mints USDC and forwards it to a plain address; it cannot also invoke a
swap function in the same call.

**The naive fix (a second user signature) was rejected in favor of a fully
trustless design** — recorded in the project's own notes: rather than have
the user sign a second authorization, or trust Conduit's relayer to
correctly map a burn to a Stellar recipient (a real redirect-of-funds risk,
since nothing on-chain would bind that mapping), Conduit re-parses the same
attested CCTP message a second time on the Stellar side — the exact pattern
`ReceiveAndSwap.sol` already uses on every EVM chain — so the final
recipient is cryptographically bound inside Circle's own attestation, not
supplied by whoever relays.

**How it works**, two on-chain steps, both permissionless (no second user
signature):
1. The existing, **unmodified** `SwapAndBurn` on any EVM chain burns with
   `mintRecipient`/`destinationCaller` = `CctpForwarder`'s own address
   (required — verified on-chain that using anything else reverts with
   `InvalidMintRecipient`), and `hookData` = Circle's required Stellar
   format (pointing `mint_and_forward` at Conduit's own `swap_and_deliver`
   Soroban contract) **plus a Conduit-appended trailing section** encoding
   the real final Stellar recipient — confirmed on-chain that
   `mint_and_forward` tolerates trailing bytes after its own parsed section,
   the same way `ReceiveAndSwap.sol`'s hookData works on EVM. No new EVM
   contract was needed: `hookData` was already a fully caller-supplied
   parameter with no on-chain format constraint.
2. Anyone (normally Conduit's relayer) calls `swap_and_deliver(message)` on
   Conduit's own Soroban contract. It independently re-parses the *same*
   attested message to extract the real amount and final recipient, checks
   `MessageTransmitter.is_nonce_used(nonce)` to confirm the transfer
   genuinely minted (proof it doesn't need to re-verify Circle's attestation
   itself), guards against double-delivery, swaps USDC → XLM, and delivers
   native XLM to the real recipient.

**Two real Soroban-specific obstacles found and fixed, not assumed away:**
- Soroban contracts **cannot call classic SDEX orderbook operations** —
  confirmed via research before writing any swap logic, ruling out the
  liquidity venue originally assumed in the project's early planning notes.
  Switched to **Soroswap** (a Soroban-native AAM, Uniswap-V2-shaped),
  verified with real, healthy USDC/XLM reserves before committing to it.
- Soroswap's **router** internally performs a nested cross-contract
  `transfer` (router → pair → token, from = Conduit's contract) that
  Soroban's auth model rejects without pre-authorizing that exact
  sub-invocation tree. Fixed by bypassing the router entirely and using the
  pair's own low-level Uniswap-V2-style interface directly — transfer input
  tokens to the pair ourselves (a direct, single-hop call, auto-authorized),
  then call the pair's own `swap`, the same "optimistic transfer" pattern
  real Uniswap V2 uses. A small (0.5%) safety margin below Conduit's own
  constant-product estimate accounts for Soroswap's exact fee model not
  being independently re-derivable without their pair source; the caller's
  real slippage floor is still checked against the honest, non-marked-down
  estimate.

**Contracts (Stellar Testnet):**

| Contract | Address |
|---|---|
| `swap_and_deliver` (Conduit, Soroban) | [`CBHP22SRJB4JXSDAQ6LKAZV72JLBL2GV7MCRVLYKO6GI7GKZ3XP5XPY6`](https://stellar.expert/explorer/testnet/contract/CBHP22SRJB4JXSDAQ6LKAZV72JLBL2GV7MCRVLYKO6GI7GKZ3XP5XPY6) |
| `CctpForwarder` (Circle) | `CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ` |
| `MessageTransmitter` (Circle) | `CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY` |
| `TokenMessengerMinter` (Circle) | `CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP` |
| USDC (Stellar SAC, ground-truth verified via `TokenMessengerMinter.get_local_token`) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Soroswap USDC/XLM pair | `CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS` |

**Live proof — Arbitrum Sepolia native ETH → Stellar native XLM, one signature:**

| Step | Tx |
|---|---|
| Burn (Arbitrum Sepolia, existing unmodified `SwapAndBurn`) | [`0x3342df49…238145`](https://sepolia.arbiscan.io/tx/0x3342df49353b3fe15170ac991e809b2a57e379fde6e18d4f0bb6d9aac1238145) |
| `mint_and_forward` (Stellar, Circle's contract) | [`7cdf2850…e22f5`](https://stellar.expert/explorer/testnet/tx/7cdf285068cb1ba7315c788da8e2f5d401f5df1fd33c2f115401c88cdb8e22f5) |
| `swap_and_deliver` (Stellar, Conduit's contract) | [`2187cb1f…805094f`](https://stellar.expert/explorer/testnet/tx/2187cb1faa704c86ed679eb55e4c109497af2fff247d392eba681f186805094f) |

Result: **20.5876992 native XLM** delivered to the final recipient's Stellar
account — confirmed via a fresh, unfunded-before-this-transfer test account's
balance delta.

Known limitation: `cargo test` currently fails to compile due to an upstream
`soroban-env-host` 22.1.3 dependency bug in its own testutils (unrelated to
this contract's code — the release wasm build, what actually gets deployed,
is clean and unaffected); see the comment in `stellar/swap_and_deliver/Cargo.toml`.
Real correctness is proven by the live on-chain execution above, not a unit
test.

### #16 — Stellar wired into the live frontend + relayer, destination-only (2026-08-22)

Stellar is now a selectable **destination** chain in the app
(`frontend/lib/legs.ts`), not just standalone scripts — Phase 1 of two.
Stellar isn't EVM, so `Leg.chain` (a `viem` `Chain`) is now optional; a new
`isStellar` flag switches the swap/quote/relay code onto a parallel path
instead of `viem` contract calls throughout:

- **UI**: since the Stellar side needs no wallet connection or signature at
  all (trustless by design — see #15), the destination becomes a plain
  Stellar G-address text field, validated with `StrKey.isValidEd25519PublicKey`
  (a real strkey check, not a regex guess) before the swap button unlocks.
  Stellar is excluded from the "From" selector entirely, since Stellar-as-
  source isn't built yet (Phase 2) — several wagmi hooks dereference
  `source.chain.id` unconditionally on render, so hiding it there (rather
  than only guarding inside the swap callback) avoids a page crash if it
  were selectable.
- **Quoting**: a new `/api/stellar-quote` route proxies a Soroban RPC
  `simulateTransaction` call reading the Soroswap pair's `get_reserves`,
  mirroring the existing `/api/fee` proxy pattern — browser JS can't cleanly
  do this via `viem`.
- **hookData**: built client-side to the exact byte layout proven in #15
  (reserved + version + length-prefixed `swap_and_deliver` contract id +
  Conduit's trailing length-prefixed final recipient), using `viem`'s
  `concatHex`/`numberToHex`/`stringToHex` (browser-safe; the original proof
  script used Node's `Buffer`). `mintRecipient`/`destinationCaller` are both
  `CctpForwarder`'s own address, matching the same on-chain-verified
  requirement from #15.
- **Relayer**: `relayer.ts` gained a `relayToStellar()` branch — polls Iris,
  then calls `mint_and_forward` and `swap_and_deliver` via Soroban RPC
  (prepare/sign/send/poll), mirroring `scripts/stellar-e2e.ts`'s `invoke()`
  helper. No `SwapRow` schema change was needed — the recipient lives inside
  the attested hookData, not a stored column, same as every other chain.

**Live proof — through the actual running app, not the standalone script:**
a fresh `scripts/frontend-e2e-stellar.ts` burns on Arbitrum Sepolia using the
frontend's exact hookData construction, then POSTs to a live `next dev`
server's `/api/swaps` — the same request the browser sends — so the app's
own `relayToStellar()` does the real work.

| Step | Tx |
|---|---|
| Burn (Arbitrum Sepolia, existing unmodified `SwapAndBurn`) | [`0x56a93117…a6b6a34`](https://sepolia.arbiscan.io/tx/0x56a93117e938203400aee1cea78a7b78474c797c6310f622ad06e9617a6b6a34) |
| Relay (Stellar, via the app's `relayer.ts`) | [`3d2660c3…4ff784c`](https://stellar.expert/explorer/testnet/tx/3d2660c38118caa9f5307400e5f042abe69e5ef8b5377366fdeaa10c54ff784c) |

Status transitioned `RELAYING → COMPLETE` in ~12 seconds via `/api/swaps/{hash}`;
**13.6604827 XLM** delivered to a freshly generated, previously-unfunded
Stellar account, confirming the whole flow — burn, attestation poll,
`mint_and_forward`, `swap_and_deliver` — works through the production code
path, not just a hand-rolled script.

Known limitation (resolved by #17 below): Stellar-as-**source** was not yet
built at the time of this entry.

### #17 — Stellar wired as a SOURCE chain, full bidirectional support (2026-08-22)

Phase 2: a user can now hold XLM (or USDC) on Stellar, connect a Stellar
wallet, and swap out to any EVM chain's native token — Conduit is fully
bidirectional on Stellar. Two real on-chain findings shaped the design,
neither assumed in advance:

- **Soroswap's testnet router works fine for a real user-signed
  transaction.** #15 found the router fails when *Conduit's own relayer
  contract* (`swap_and_deliver`) calls it — a contract identity can't
  satisfy Soroban's auth requirements for a nested cross-contract transfer
  made on its behalf. That finding does NOT extend to a normal wallet
  signing directly: when the transaction's source account is a real Ed25519
  keypair, `rpc.Server.prepareTransaction`'s simulation-derived auth entries
  cover the router's whole nested call tree in one signature — confirmed
  live via `scripts/verify-soroswap-router.ts` before committing to the
  design. So Phase 2 calls Soroswap's router
  (`CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`) directly for
  the XLM→USDC leg — one signature, not the pair-level bypass #15 needed.
- **A Stellar account needs a classic trustline for USDC before it can hold
  a balance.** Stellar's USDC SAC wraps a classic asset
  (`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) — only
  *accounts* need a trustline, not *contracts*, which is why #15/#16 (where
  USDC is only ever held by the `swap_and_deliver` contract) never hit this.
  A `changeTrust` step was added, skipped automatically for a wallet that
  already has one.
- **Circle's `deposit_for_burn_with_hook` needs a standard `approve` first**
  (internally `transfer_from`, per Circle's `deposit.rs`) — same shape as an
  EVM ERC20 approve+transferFrom.
- **Stellar's 7-decimal local USDC amount is normalized to CCTP's canonical
  6-decimal amount automatically inside Circle's own contract** — confirmed
  on the live proof burn (210,762,437 local units → 21,076,243 canonical
  µUSDC, exactly ÷10). This means the existing, unmodified `ReceiveAndSwap.sol`
  and `relayer.ts`'s standard `relayAndExecute` path needed **zero changes**
  to consume a Stellar-sourced burn — Stellar-as-source plugs directly into
  the same destination machinery every EVM chain already uses.

Because there's no atomic multi-step call on Stellar, a Stellar-source swap
is 3 sequential wallet signatures (trustline if needed, router swap, approve,
burn) instead of every other chain's single signature — the UI surfaces this
as an explicit step-by-step progress indicator rather than leaving the user
wondering if something's stuck.

**Live proof — Stellar (XLM) → Arbitrum Sepolia (native ETH), through the
actual running app:**

| Step | Tx |
|---|---|
| USDC trustline (Stellar) | one-time per wallet, skipped on repeat swaps |
| Swap XLM → USDC (Soroswap router) | [`4277b350…2795900`](https://stellar.expert/explorer/testnet/tx/4277b35043b74deea3b11a9cbca4aac8230314aba3c1e1346a070ce4e2795900) |
| Approve `TokenMessengerMinter` | [`46b5720c…37afa57`](https://stellar.expert/explorer/testnet/tx/46b5720cd441af4b0c6b701456bcfd68f6cd056dab67cc443615d927537afa57) |
| Burn (`deposit_for_burn_with_hook`) | [`460308f0…6cfa1be9`](https://stellar.expert/explorer/testnet/tx/460308f084aa1d303d94f131e8b9bf1d27ec4d918014f29e99ed20c96cfa1be9) |
| Relay (Arbitrum Sepolia, app's existing `relayer.ts`, unmodified) | [`0x6b7482…f30c37c31`](https://sepolia.arbiscan.io/tx/0x6b74822badeb1ab8eca6e6b2bd7a28a839df4f94cffa6c16d302cb9f30c37c31) |

Status transitioned `AWAITING_ATTESTATION → RELAYING → COMPLETE` in ~10
seconds via `/api/swaps/{hash}`; **0.01835548386867192 ETH** delivered to a
freshly generated, previously-unfunded Arbitrum Sepolia account. Reproduced
independently via `scripts/frontend-e2e-stellar-source.ts` against a live
`next dev` server (not just the implementing agent's own run), confirming
the result.

Files: `frontend/lib/legs.ts` (`stellarTokenMessengerMinter`,
`quoteXlmToUsdc`), `frontend/app/hooks/useStellarWallet.ts` (new — Stellar
Wallets Kit v2.5 wrapper; its API is a static class,
`StellarWalletsKit.init/.authModal/.signTransaction`, not instance-based —
verified against the installed package's own `.d.ts`, not assumed),
`frontend/app/hooks/useSwap.ts` (`swapFromStellar` branch),
`frontend/app/api/stellar-source/{prepare,submit,balance}/route.ts` (new —
server-side XDR build/simulate, the browser signs via the Kit),
`frontend/app/api/stellar-quote/route.ts` (now bidirectional),
`frontend/app/api/swaps/route.ts` (accepts bare-hex Stellar tx hashes
alongside `0x`-prefixed EVM ones), `frontend/app/components/SwapCard.tsx`
(Stellar wallet connect UI, multi-step signing progress banner, Stellar now
selectable as "From").

Known limitation: the Stellar Wallets Kit's actual browser UI
(`authModal`, real Freighter popup) was implemented per its verified API
but not click-through tested in a real browser — this was proven with
`@stellar/stellar-sdk` `Keypair` signing directly (identical on-chain
operations, no sandboxed browser available). A real click-through test in
an actual browser with Freighter installed is the one remaining thing to
verify before calling Stellar fully production-ready in the UI.
