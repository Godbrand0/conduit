/**
 * Proof: Arc Testnet (native-USDC gas token) → Base Sepolia native ETH.
 *
 * Arc's "USDC" is a precompile ERC20 view over the chain's native 18-decimal
 * balance (decimals() reports 6, matching CCTP convention) — confirmed
 * on-chain 2026-07-30. That means the source side needs no swap or
 * Conduit contract at all: the user's native balance already *is* USDC, so
 * we call CctpClient.transfer() directly from the EOA with a destination
 * hook targeting the existing Base ReceiveAndSwap, which swaps the minted
 * USDC to native ETH exactly like every other route.
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseUnits, formatEther, encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { CctpClient, AttestationClient, Hooks } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

const ARC_RPC = "https://rpc.testnet.arc.network";
const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com";
const RECEIVE_AND_SWAP_BASE = process.env.RECEIVE_AND_SWAP_BASE as `0x${string}`;
const AMOUNT_USDC = process.env.AMOUNT_USDC ?? "3";
const POOL_FEE = 3000;

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);

// arc isn't a viem built-in chain — define it minimally for the wallet client.
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
} as const;

const sourceWallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) });
const destWallet = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_RPC) });
const destPublic = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });

const client = new CctpClient({
  env: "testnet",
  rpcs: { arc: ARC_RPC, base: BASE_RPC },
  hookExecutors: { base: RECEIVE_AND_SWAP_BASE },
});

const amount = parseUnits(AMOUNT_USDC, 6); // CCTP's usdc unit is 6 decimals on Arc too

const hook = Hooks.raw(
  RECEIVE_AND_SWAP_BASE,
  encodeFunctionData({
    abi: parseAbi(["function swapUsdcToNative(uint256 amountIn, uint24 poolFee, uint256 minOut, address recipient)"]),
    functionName: "swapUsdcToNative",
    args: [0n, POOL_FEE, 1n, account.address],
  }),
  0n
);

const ethBefore = await destPublic.getBalance({ address: account.address });
console.log(`Burning ${AMOUNT_USDC} USDC (native on Arc) → native ETH on Base Sepolia`);

const transfer = await client.transfer(
  { from: "arc", to: "base", amount, fast: true, hook, hookExecutor: RECEIVE_AND_SWAP_BASE },
  sourceWallet,
  destWallet
);

transfer.on("stateChange", (snap) => console.log(`[${new Date().toISOString()}] ${snap.state}`));
const result = await transfer.wait();
const ethAfter = await destPublic.getBalance({ address: account.address });

console.log("\n✅ Arc → Base complete");
console.log("  Burn tx (Arc Testnet):     ", result.sourceTxHash);
console.log("  Relay tx (Base Sepolia):   ", result.destinationTxHash);
console.log(`  Native ETH received: ${formatEther(ethAfter - ethBefore)} ETH`);
