import { defineChain } from "viem";

/**
 * Arc Testnet isn't in viem's built-in chain list. Its native gas token IS
 * USDC — CCTP mints/burns through an ERC20-view precompile that rescales
 * the 18-decimal native balance to the standard 6 decimals (confirmed
 * on-chain 2026-07-30; see DEPLOYMENTS.md).
 */
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
});
