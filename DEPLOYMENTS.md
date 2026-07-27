# Conduit Deployments & On-Chain Proofs

All transactions below are verifiable on public testnet explorers.
Deployer/relayer: `0x6dC4F7e7dC254777B8301eF3f89dD7757740c5f7`

## Contracts

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
