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
| **SwapAndBurn** | Base Sepolia | [`0x9bF592B913BB735d1e4fed5c5B5a6073B9b4E62E`](https://sepolia.basescan.org/address/0x9bF592B913BB735d1e4fed5c5B5a6073B9b4E62E) | [`0x3063fdfe…9bf589`](https://sepolia.basescan.org/tx/0x3063fdfe2c0ab645783d30aed00b319b09a6b7a2fe5f1bef78663868a69bf589) |

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
