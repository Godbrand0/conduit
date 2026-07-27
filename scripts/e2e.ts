/**
 * Conduit end-to-end proof: USDC on the source chain → CCTP V2 fast transfer →
 * native ETH on the destination chain, where the ReceiveAndSwap hook executor
 * swaps the minted USDC in the relay transaction.
 *
 * Usage:
 *   pnpm e2e                     # base → arbitrum (default)
 *   FROM=arbitrum TO=base pnpm e2e
 *   AMOUNT=2.9 FROM=... TO=... pnpm e2e
 *
 * Reads PRIVATE_KEY / RPCs / executor addresses from ../.env
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseUnits, formatEther, encodeFunctionData, parseAbi, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, arbitrumSepolia } from "viem/chains";
import { CctpClient, AttestationClient, type SupportedChain } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

type Leg = {
  chain: Chain;
  rpc: string;
  domain: number;
  executor: `0x${string}`;
  poolFee: number; // USDC/WETH fee tier with real liquidity, verified on-chain
};

const LEGS: Record<string, Leg> = {
  base: {
    chain: baseSepolia,
    rpc: process.env.BASE_SEPOLIA_RPC!,
    domain: 6,
    executor: process.env.RECEIVE_AND_SWAP_BASE as `0x${string}`,
    poolFee: 3000,
  },
  arbitrum: {
    chain: arbitrumSepolia,
    rpc: process.env.ARB_SEPOLIA_RPC!,
    domain: 3,
    executor: process.env.RECEIVE_AND_SWAP_ARBITRUM as `0x${string}`,
    poolFee: 3000,
  },
};

const from = (process.env.FROM ?? "base") as SupportedChain & keyof typeof LEGS;
const to = (process.env.TO ?? "arbitrum") as SupportedChain & keyof typeof LEGS;
const source = LEGS[from];
const dest = LEGS[to];
if (!source || !dest || from === to) throw new Error(`bad route ${from} → ${to}`);
if (!dest.executor) throw new Error(`no executor configured for ${to}`);

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const sourceWallet = createWalletClient({ account, chain: source.chain, transport: http(source.rpc) });
const destWallet = createWalletClient({ account, chain: dest.chain, transport: http(dest.rpc) });
const destPublic = createPublicClient({ chain: dest.chain, transport: http(dest.rpc) });

const client = new CctpClient({
  env: "testnet",
  rpcs: { [from]: source.rpc, [to]: dest.rpc },
  hookExecutors: { [to]: dest.executor },
});

const amount = parseUnits(process.env.AMOUNT ?? "2.9", 6);

// Fast-transfer fee is deducted before mint, so the swap input must be the
// post-fee amount. Fetch the exact fee Iris will charge for this route.
const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const fee = await attestation.getMinimumFee(source.domain, dest.domain);
const swapInput = amount - fee;
if (swapInput <= 0n) throw new Error("amount does not cover the fast fee");
console.log(`${from} → ${to}: burning ${amount} base units, fast fee ${fee}, swapping ${swapInput} on destination`);

const hookCalldata = encodeFunctionData({
  abi: parseAbi([
    "function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)",
  ]),
  functionName: "swapUsdcToNative",
  // minOut=1: proof run against arbitrarily-priced testnet pools;
  // production quotes set a real slippage floor.
  args: [swapInput, dest.poolFee, 1n, account.address],
});

const ethBefore = await destPublic.getBalance({ address: account.address });

const transfer = await client.transfer(
  {
    from,
    to,
    amount,
    fast: true,
    maxFee: fee,
    hook: {
      target: dest.executor, // executor self-call into swapUsdcToNative
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
console.log(`  Burn tx (${from}):  `, result.sourceTxHash);
console.log(`  Relay tx (${to}):`, result.destinationTxHash);
console.log(`  Native ETH received: ${formatEther(ethAfter - ethBefore)} ETH`);
