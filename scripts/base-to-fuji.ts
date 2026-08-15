/**
 * Proof: Base Sepolia native ETH -> Avalanche Fuji native AVAX, through the
 * existing V3-based SwapAndBurn on Base and the new ReceiveAndSwapUniV2
 * (Pangolin's router) on Fuji.
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseEther, padHex, encodeFunctionData, parseAbi, formatEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AttestationClient, encodeHook, HOOK_EXECUTOR_ABI } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

const FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com";
const SWAP_AND_BURN_BASE = process.env.SWAP_AND_BURN_BASE as `0x${string}`;
const RECEIVE_AND_SWAP_UNIV2_FUJI = "0x064B35CA8f0886A10eD7C43E29D558E66b0dea36" as const;
const FUJI_DOMAIN = 1;
const AMOUNT_ETH = process.env.AMOUNT_ETH ?? "0.015";

const fujiTestnet = {
  id: 43113,
  name: "Avalanche Fuji",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [FUJI_RPC] } },
} as const;

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const sourceWallet = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_RPC) });
const sourcePublic = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const destPublic = createPublicClient({ chain: fujiTestnet, transport: http(FUJI_RPC) });

// ReceiveAndSwapUniV2's swapUsdcToNative has no poolFee param (V2 routers
// don't have fee tiers), unlike the V3 version used everywhere else.
const hook = encodeHook({
  target: RECEIVE_AND_SWAP_UNIV2_FUJI,
  calldata: encodeFunctionData({
    abi: parseAbi(["function swapUsdcToNative(uint256 amountIn, uint256 minOut, address recipient)"]),
    functionName: "swapUsdcToNative",
    args: [0n, 1n, account.address],
  }),
  forwardAmount: 0n,
});
const executorBytes32 = padHex(RECEIVE_AND_SWAP_UNIV2_FUJI, { size: 32 });

const avaxBefore = await destPublic.getBalance({ address: account.address });
console.log(`Swapping ${AMOUNT_ETH} ETH (Base) -> USDC -> burn -> AVAX (Pangolin, Fuji)`);

const burnHash = await sourceWallet.writeContract({
  address: SWAP_AND_BURN_BASE,
  abi: [
    {
      type: "function",
      name: "swapAndBurnNative",
      stateMutability: "payable",
      inputs: [
        { name: "minUsdcOut", type: "uint256" },
        { name: "poolFee", type: "uint24" },
        { name: "destinationDomain", type: "uint32" },
        { name: "mintRecipient", type: "bytes32" },
        { name: "destinationCaller", type: "bytes32" },
        { name: "maxFee", type: "uint256" },
        { name: "minFinalityThreshold", type: "uint32" },
        { name: "hookData", type: "bytes" },
      ],
      outputs: [{ name: "usdcBurned", type: "uint256" }],
    },
  ],
  functionName: "swapAndBurnNative",
  args: [parseUnits("2", 6), 3000, FUJI_DOMAIN, executorBytes32, executorBytes32, 1_300_000n, 1000, hook],
  value: parseEther(AMOUNT_ETH),
});
console.log(`[swap+burn tx] ${burnHash}`);
await sourcePublic.waitForTransactionReceipt({ hash: burnHash });
console.log("[swap+burn] confirmed on Base");

const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const { attestation: att, messageBytes } = await attestation.poll(burnHash, 6, {
  maxAttempts: 60,
  intervalMs: 2000,
  onAttempt: (n) => process.stdout.write(`\r[attestation] polling Iris… ${n}`),
});
console.log("\n[attestation] complete");

const destWallet = createWalletClient({ account, chain: fujiTestnet, transport: http(FUJI_RPC) });
const relayHash = await destWallet.writeContract({
  address: RECEIVE_AND_SWAP_UNIV2_FUJI,
  abi: HOOK_EXECUTOR_ABI,
  functionName: "relayAndExecute",
  args: [messageBytes, att],
  gas: 800_000n,
});
console.log(`[relay tx] ${relayHash}`);
await destPublic.waitForTransactionReceipt({ hash: relayHash });

const avaxAfter = await destPublic.getBalance({ address: account.address });
console.log("\n✅ Base → Fuji complete");
console.log(`  Burn tx (Base): ${burnHash}`);
console.log(`  Relay tx (Fuji): ${relayHash}`);
console.log(`  Native AVAX received: ${formatEther(avaxAfter - avaxBefore)} AVAX`);
