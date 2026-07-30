/**
 * Proof: Base Sepolia native ETH → Arc Testnet native-USDC.
 *
 * Reverse of arc-to-base.ts. Base side is unchanged — the existing
 * SwapAndBurn contract does ETH→USDC swap + 0.05% fee + burn, one
 * signature. Arc needs no destination contract at all: Arc's "USDC" IS
 * the native gas balance (confirmed on-chain 2026-07-30), so minting
 * straight to the user's own address via depositForBurn's mintRecipient
 * (no hook) already delivers native-equivalent funds — nothing to swap.
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, formatUnits, padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { AttestationClient, MESSAGE_TRANSMITTER_ABI } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

const BASE_RPC = process.env.BASE_SEPOLIA_RPC ?? "https://base-sepolia-rpc.publicnode.com";
const ARC_RPC = "https://rpc.testnet.arc.network";
const SWAP_AND_BURN_BASE = process.env.SWAP_AND_BURN_BASE as `0x${string}`;
const AMOUNT_ETH = process.env.AMOUNT_ETH ?? "0.004";
const ARC_DOMAIN = 26;
const ARC_MESSAGE_TRANSMITTER = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as const;
const ARC_USDC_VIEW = "0x3600000000000000000000000000000000000000" as const;

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
} as const;

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const baseWallet = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_RPC) });
const basePublic = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const arcWallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) });
const arcPublic = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) });

const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const maxFee = await attestation.getMinimumFee(6, ARC_DOMAIN); // Base → Arc

const recipientBytes32 = padHex(account.address, { size: 32 });
const usdcBefore = await arcPublic.readContract({
  address: ARC_USDC_VIEW,
  abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
  functionName: "balanceOf",
  args: [account.address],
});

console.log(`Burning ${AMOUNT_ETH} native ETH (Base) → native-equivalent USDC on Arc, max fee ${maxFee}`);

const burnHash = await baseWallet.writeContract({
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
  // SwapAndBurn always calls depositForBurnWithHook, which Circle's TokenMessenger
  // rejects with empty hookData — pass an inert single byte. Nothing on Arc ever
  // executes it (we call plain receiveMessage below, not a hook executor), so
  // this is dead cargo exactly like an unused hook on any other chain; the mint
  // goes straight to mintRecipient (the user's own address) regardless.
  args: [parseUnits("2", 6), 3000, ARC_DOMAIN, recipientBytes32, `0x${"0".repeat(64)}`, maxFee, 1000, "0x00"],
  value: parseEther(AMOUNT_ETH),
});
console.log(`[swap+burn tx] ${burnHash}`);
await basePublic.waitForTransactionReceipt({ hash: burnHash });
console.log("[swap+burn] confirmed on Base");

const { attestation: att, messageBytes } = await attestation.poll(burnHash, 6, {
  maxAttempts: 60,
  intervalMs: 2000,
  onAttempt: (n) => process.stdout.write(`\r[attestation] polling Iris… ${n}`),
});
console.log("\n[attestation] complete");

const relayHash = await arcWallet.writeContract({
  address: ARC_MESSAGE_TRANSMITTER,
  abi: MESSAGE_TRANSMITTER_ABI,
  functionName: "receiveMessage",
  args: [messageBytes, att],
});
console.log(`[relay tx] ${relayHash}`);
await arcPublic.waitForTransactionReceipt({ hash: relayHash });

const usdcAfter = await arcPublic.readContract({
  address: ARC_USDC_VIEW,
  abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
  functionName: "balanceOf",
  args: [account.address],
});

console.log("\n✅ Base → Arc complete");
console.log(`  Burn tx (Base Sepolia): ${burnHash}`);
console.log(`  Relay tx (Arc Testnet): ${relayHash}`);
console.log(`  USDC received on Arc: ${formatUnits(usdcAfter - usdcBefore, 6)} USDC (native-equivalent)`);
