/**
 * Conduit end-to-end proof: Base Sepolia USDC → CCTP V2 → Arbitrum Sepolia,
 * where the ReceiveAndSwap hook executor swaps the minted USDC to native ETH
 * in the relay transaction.
 *
 * Usage: RECEIVE_AND_SWAP=0x... pnpm e2e
 * Reads PRIVATE_KEY / RPCs from ../.env
 */
import "dotenv/config";
import { config } from "dotenv";
import { createWalletClient, http, parseUnits, formatEther, encodeFunctionData, parseAbi, createPublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, arbitrumSepolia } from "viem/chains";
import { CctpClient, AttestationClient } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

const AMOUNT_USDC = "2.9"; // burned on Base Sepolia
const POOL_FEE = 3000; // 0.3% USDC/WETH pool on Arbitrum Sepolia (has real liquidity)

const RECEIVE_AND_SWAP = process.env.RECEIVE_AND_SWAP as `0x${string}`;
if (!RECEIVE_AND_SWAP) throw new Error("Set RECEIVE_AND_SWAP to the deployed executor address");

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const sourceWallet = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC),
});
const destWallet = createWalletClient({
  account,
  chain: arbitrumSepolia,
  transport: http(process.env.ARB_SEPOLIA_RPC),
});
const destPublic = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(process.env.ARB_SEPOLIA_RPC),
});

const client = new CctpClient({
  env: "testnet",
  rpcs: {
    base: process.env.BASE_SEPOLIA_RPC!,
    arbitrum: process.env.ARB_SEPOLIA_RPC!,
  },
  hookExecutors: { arbitrum: RECEIVE_AND_SWAP },
});

const amount = parseUnits(AMOUNT_USDC, 6);

// Fast-transfer fee is deducted before mint, so the swap input must be the
// post-fee amount. Fetch the exact fee Iris will charge (Base=6 → Arbitrum=3).
const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const fee = await attestation.getMinimumFee(6, 3);
const swapInput = amount - fee;
console.log(`Burning ${AMOUNT_USDC} USDC, fast fee ${fee} base units, swapping ${swapInput} on destination`);

const hookCalldata = encodeFunctionData({
  abi: parseAbi([
    "function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)",
  ]),
  functionName: "swapUsdcToNative",
  // minOut=1: this is a proof run against an arbitrarily-priced testnet pool;
  // production quotes set a real slippage floor.
  args: [swapInput, POOL_FEE, 1n, account.address],
});

const ethBefore = await destPublic.getBalance({ address: account.address });

const transfer = await client.transfer(
  {
    from: "base",
    to: "arbitrum",
    amount,
    fast: true,
    maxFee: fee,
    hook: {
      target: RECEIVE_AND_SWAP, // executor self-call into swapUsdcToNative
      calldata: hookCalldata,
      forwardAmount: 0n, // 0 = all minted USDC
    },
  },
  sourceWallet,
  destWallet
);

transfer.on("stateChange", (snap) => {
  console.log(`[${new Date().toISOString()}] ${snap.state}`);
});

const result = await transfer.wait();
const ethAfter = await destPublic.getBalance({ address: account.address });

console.log("\n✅ Transfer complete");
console.log("  Burn tx (Base Sepolia):     ", result.sourceTxHash);
console.log("  Relay tx (Arbitrum Sepolia):", result.destinationTxHash);
console.log(`  Native ETH received: ${formatEther(ethAfter - ethBefore)} ETH`);
