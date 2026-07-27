/**
 * Conduit FULL native-to-native proof, any route: native ETH on the source
 * chain → SwapAndBurn (ETH→USDC swap + 0.05% Conduit fee + CCTP burn, ONE
 * transaction) → CCTP V2 fast transfer → ReceiveAndSwap on the destination
 * (mint + USDC→ETH swap, one relay transaction) → native ETH delivered.
 *
 * Usage:
 *   pnpm tsx e2e-native.ts                      # base → arbitrum
 *   FROM=arbitrum TO=optimism AMOUNT_ETH=0.05 pnpm tsx e2e-native.ts
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatEther, encodeFunctionData, parseAbi, padHex, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, arbitrumSepolia, sepolia, optimismSepolia } from "viem/chains";
import { AttestationClient, encodeHook, HOOK_EXECUTOR_ABI } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

type Leg = {
  chain: Chain;
  rpc: string;
  domain: number;
  executor: `0x${string}`;
  swapAndBurn: `0x${string}`;
  poolFee: number;
};

const LEGS: Record<string, Leg> = {
  base: {
    chain: baseSepolia,
    rpc: process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com",
    domain: 6,
    executor: process.env.RECEIVE_AND_SWAP_BASE as `0x${string}`,
    swapAndBurn: process.env.SWAP_AND_BURN_BASE as `0x${string}`,
    poolFee: 3000,
  },
  arbitrum: {
    chain: arbitrumSepolia,
    rpc: process.env.ARB_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc",
    domain: 3,
    executor: process.env.RECEIVE_AND_SWAP_ARBITRUM as `0x${string}`,
    swapAndBurn: process.env.SWAP_AND_BURN_ARBITRUM as `0x${string}`,
    poolFee: 3000,
  },
  ethereum: {
    chain: sepolia,
    rpc: process.env.ETH_SEPOLIA_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com",
    domain: 0,
    executor: process.env.RECEIVE_AND_SWAP_ETHEREUM as `0x${string}`,
    swapAndBurn: process.env.SWAP_AND_BURN_ETHEREUM as `0x${string}`,
    poolFee: 500,
  },
  optimism: {
    chain: optimismSepolia,
    rpc: process.env.OP_SEPOLIA_RPC ?? "https://sepolia.optimism.io",
    domain: 2,
    executor: process.env.RECEIVE_AND_SWAP_OPTIMISM as `0x${string}`,
    swapAndBurn: process.env.SWAP_AND_BURN_OPTIMISM as `0x${string}`,
    poolFee: 500,
  },
};

const from = process.env.FROM ?? "base";
const to = process.env.TO ?? "arbitrum";
const source = LEGS[from];
const dest = LEGS[to];
if (!source || !dest || from === to) throw new Error(`bad route ${from} → ${to}`);

const AMOUNT_ETH = process.env.AMOUNT_ETH ?? "0.004";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

const srcWallet = createWalletClient({ account, chain: source.chain, transport: http(source.rpc) });
const srcPublic = createPublicClient({ chain: source.chain, transport: http(source.rpc) });
const dstWallet = createWalletClient({ account, chain: dest.chain, transport: http(dest.rpc) });
const dstPublic = createPublicClient({ chain: dest.chain, transport: http(dest.rpc) });

const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const maxFee = await attestation.getMinimumFee(source.domain, dest.domain);

// Destination hook: swap ALL minted USDC (amountIn=0) to native ETH.
const hook = encodeHook({
  target: dest.executor,
  calldata: encodeFunctionData({
    abi: parseAbi(["function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)"]),
    functionName: "swapUsdcToNative",
    args: [0n, dest.poolFee, 1n, account.address], // minOut=1: testnet pool prices are arbitrary
  }),
  forwardAmount: 0n,
});

const executorBytes32 = padHex(dest.executor, { size: 32 });
const ethBefore = await dstPublic.getBalance({ address: account.address });

console.log(`ONE SIGNATURE: ${AMOUNT_ETH} native ETH (${from}) → native ETH (${to}), max fast fee ${maxFee} µUSDC`);

const burnHash = await srcWallet.writeContract({
  address: source.swapAndBurn,
  abi: parseAbi([
    "function swapAndBurnNative(uint256 minUsdcOut, uint24 poolFee, uint32 destinationDomain, bytes32 mintRecipient, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) payable returns (uint256)",
  ]),
  functionName: "swapAndBurnNative",
  args: [parseUnits("2", 6), source.poolFee, dest.domain, executorBytes32, executorBytes32, maxFee, 1000, hook],
  value: parseEther(AMOUNT_ETH),
});
console.log(`[swap+burn tx] ${burnHash}`);
await srcPublic.waitForTransactionReceipt({ hash: burnHash });
console.log("[swap+burn] confirmed — ETH swapped, 0.05% fee skimmed, USDC burned in one tx");

const { attestation: att, messageBytes } = await attestation.poll(burnHash, source.domain, {
  maxAttempts: 60,
  intervalMs: 2000,
  onAttempt: (n) => process.stdout.write(`\r[attestation] polling Iris… ${n}`),
});
console.log("\n[attestation] complete");

const relayHash = await dstWallet.writeContract({
  address: dest.executor,
  abi: HOOK_EXECUTOR_ABI,
  functionName: "relayAndExecute",
  args: [messageBytes, att],
});
console.log(`[relay tx] ${relayHash}`);
await dstPublic.waitForTransactionReceipt({ hash: relayHash });

const ethAfter = await dstPublic.getBalance({ address: account.address });
console.log("\n✅ NATIVE-TO-NATIVE COMPLETE");
console.log(`  Burn tx (${from}):  ${burnHash}`);
console.log(`  Relay tx (${to}): ${relayHash}`);
console.log(`  Native ETH received on ${to}: ${formatEther(ethAfter - ethBefore)} ETH`);
