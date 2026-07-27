/**
 * Conduit FULL native-to-native proof: native ETH on Base Sepolia →
 * SwapAndBurn (ETH→USDC swap + CCTP burn, ONE transaction) → CCTP V2 fast
 * transfer → ReceiveAndSwap on Arbitrum Sepolia (mint + USDC→ETH swap, one
 * relay transaction) → native ETH delivered.
 *
 * The user-visible flow: sign once, ETH leaves Base, ETH arrives on Arbitrum.
 *
 * Usage: pnpm tsx e2e-native.ts   (AMOUNT_ETH=0.004 to override)
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatEther, encodeFunctionData, parseAbi, padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, arbitrumSepolia } from "viem/chains";
import { AttestationClient, encodeHook, HOOK_EXECUTOR_ABI } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

const SWAP_AND_BURN = process.env.SWAP_AND_BURN_BASE as `0x${string}`;
const EXECUTOR = process.env.RECEIVE_AND_SWAP_ARBITRUM as `0x${string}`;
const AMOUNT_ETH = process.env.AMOUNT_ETH ?? "0.004";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const baseRpc = process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com";
const arbRpc = process.env.ARB_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc";

const baseWallet = createWalletClient({ account, chain: baseSepolia, transport: http(baseRpc) });
const basePublic = createPublicClient({ chain: baseSepolia, transport: http(baseRpc) });
const arbWallet = createWalletClient({ account, chain: arbitrumSepolia, transport: http(arbRpc) });
const arbPublic = createPublicClient({ chain: arbitrumSepolia, transport: http(arbRpc) });

const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const maxFee = await attestation.getMinimumFee(6, 3); // Base → Arbitrum

// Destination hook: swap ALL minted USDC (amountIn=0 — the exact minted amount
// is unknowable at sign time) to native ETH for the user.
const hook = encodeHook({
  target: EXECUTOR,
  calldata: encodeFunctionData({
    abi: parseAbi(["function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)"]),
    functionName: "swapUsdcToNative",
    args: [0n, 3000, 1n, account.address], // minOut=1: proof run, testnet pool prices are arbitrary
  }),
  forwardAmount: 0n,
});

const executorBytes32 = padHex(EXECUTOR, { size: 32 });
const ethBefore = await arbPublic.getBalance({ address: account.address });

console.log(`ONE SIGNATURE: ${AMOUNT_ETH} native ETH (Base) → native ETH (Arbitrum), max fast fee ${maxFee} µUSDC`);

const burnHash = await baseWallet.writeContract({
  address: SWAP_AND_BURN,
  abi: parseAbi([
    "function swapAndBurnNative(uint256 minUsdcOut, uint24 poolFee, uint32 destinationDomain, bytes32 mintRecipient, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData) payable returns (uint256)",
  ]),
  functionName: "swapAndBurnNative",
  args: [parseUnits("2", 6), 3000, 3, executorBytes32, executorBytes32, maxFee, 1000, hook],
  value: parseEther(AMOUNT_ETH),
});
console.log(`[swap+burn tx] ${burnHash}`);
await basePublic.waitForTransactionReceipt({ hash: burnHash });
console.log("[swap+burn] confirmed — ETH swapped to USDC and burned in one tx");

const { attestation: att, messageBytes } = await attestation.poll(burnHash, 6, {
  maxAttempts: 60,
  intervalMs: 2000,
  onAttempt: (n) => process.stdout.write(`\r[attestation] polling Iris… ${n}`),
});
console.log("\n[attestation] complete");

const relayHash = await arbWallet.writeContract({
  address: EXECUTOR,
  abi: HOOK_EXECUTOR_ABI,
  functionName: "relayAndExecute",
  args: [messageBytes, att],
});
console.log(`[relay tx] ${relayHash}`);
await arbPublic.waitForTransactionReceipt({ hash: relayHash });

const ethAfter = await arbPublic.getBalance({ address: account.address });
console.log("\n✅ NATIVE-TO-NATIVE COMPLETE");
console.log(`  Burn tx (Base):     ${burnHash}`);
console.log(`  Relay tx (Arbitrum): ${relayHash}`);
console.log(`  Native ETH received on Arbitrum: ${formatEther(ethAfter - ethBefore)} ETH`);
