/**
 * Proof: Avalanche Fuji AVAX -> Base Sepolia native ETH, through
 * SwapAndBurnUniV2 (Pangolin's router) on the source side and the existing
 * V3-based ReceiveAndSwap on Base. Pangolin was the only Uniswap-V2-style
 * DEX on Fuji confirmed to actually execute a swap, not just quote one —
 * Trader Joe's legacy V1 router has a genuinely liquid WAVAX/USDC pool too,
 * but reverts on every real swap attempt.
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseEther, padHex, encodeFunctionData, parseAbi, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AttestationClient, encodeHook, HOOK_EXECUTOR_ABI } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

const FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com";
const SWAP_AND_BURN_UNIV2_FUJI = "0x9AcD57857367494eb6CB02Bd2241Cc78FdCdDe8b" as const;
const RECEIVE_AND_SWAP_BASE = process.env.RECEIVE_AND_SWAP_BASE as `0x${string}`;
const FUJI_DOMAIN = 1;
const AMOUNT_AVAX = process.env.AMOUNT_AVAX ?? "0.005";

const fujiTestnet = {
  id: 43113,
  name: "Avalanche Fuji",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [FUJI_RPC] } },
} as const;

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const sourceWallet = createWalletClient({ account, chain: fujiTestnet, transport: http(FUJI_RPC) });
const sourcePublic = createPublicClient({ chain: fujiTestnet, transport: http(FUJI_RPC) });
const destPublic = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });

const hook = encodeHook({
  target: RECEIVE_AND_SWAP_BASE,
  calldata: encodeFunctionData({
    abi: parseAbi(["function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)"]),
    functionName: "swapUsdcToNative",
    args: [0n, 3000, 1n, account.address],
  }),
  forwardAmount: 0n,
});
const executorBytes32 = padHex(RECEIVE_AND_SWAP_BASE, { size: 32 });

const ethBefore = await destPublic.getBalance({ address: account.address });
console.log(`Swapping ${AMOUNT_AVAX} AVAX -> USDC (Pangolin, Fuji) -> burn -> native ETH on Base`);

const burnHash = await sourceWallet.writeContract({
  address: SWAP_AND_BURN_UNIV2_FUJI,
  abi: [
    {
      type: "function",
      name: "swapAndBurnNative",
      stateMutability: "payable",
      inputs: [
        { name: "minUsdcOut", type: "uint256" },
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
  // minUsdcOut=1: pool is thin, testnet price is arbitrary. maxFee=1: Iris
  // quotes a genuine 0 fee for domain 1 -> 6, so any real burn clears this.
  args: [1n, 6, executorBytes32, executorBytes32, 1n, 1000, hook],
  value: parseEther(AMOUNT_AVAX),
  gas: 800_000n,
});
console.log(`[swap+burn tx] ${burnHash}`);
await sourcePublic.waitForTransactionReceipt({ hash: burnHash });
console.log("[swap+burn] confirmed on Fuji");

const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const { attestation: att, messageBytes } = await attestation.poll(burnHash, FUJI_DOMAIN, {
  maxAttempts: 60,
  intervalMs: 2000,
  onAttempt: (n) => process.stdout.write(`\r[attestation] polling Iris… ${n}`),
});
console.log("\n[attestation] complete");

const destWallet = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_RPC) });
const relayHash = await destWallet.writeContract({
  address: RECEIVE_AND_SWAP_BASE,
  abi: HOOK_EXECUTOR_ABI,
  functionName: "relayAndExecute",
  args: [messageBytes, att],
});
console.log(`[relay tx] ${relayHash}`);
await destPublic.waitForTransactionReceipt({ hash: relayHash });

const ethAfter = await destPublic.getBalance({ address: account.address });
console.log("\n✅ Fuji → Base complete");
console.log(`  Burn tx (Fuji):  ${burnHash}`);
console.log(`  Relay tx (Base): ${relayHash}`);
console.log(`  Native ETH received: ${formatEther(ethAfter - ethBefore)} ETH`);
