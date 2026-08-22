/**
 * Smoke-tests the NEW frontend API routes /api/stellar-source/{prepare,
 * submit,balance} themselves (not just the equivalent hand-rolled logic
 * frontend-e2e-stellar-source.ts already proved works on-chain) — these
 * routes are what the real browser + Stellar Wallets Kit flow in
 * useSwap.ts's swapFromStellar() actually calls. Signs the XDR the prepare
 * route returns with a local Keypair (standing in for the Kit's
 * signTransaction, which needs a real browser extension unavailable here),
 * then submits it back through the submit route exactly as the browser
 * would via fetch().
 */
import { Keypair, TransactionBuilder, Networks } from "@stellar/stellar-sdk";
import { encodeFunctionData, padHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeHook } from "@cctp-sdk/core";

const APP_URL = "http://localhost:3000";
const kp = Keypair.random();
console.log(`Disposable test keypair: ${kp.publicKey()}`);
console.log("Funding via Friendbot...");
const fr = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
if (!fr.ok) throw new Error(`Friendbot failed: ${fr.status}`);
console.log("Funded.");

async function prepareSignSubmit(step: string, args: Record<string, unknown>) {
  const prepRes = await fetch(`${APP_URL}/api/stellar-source/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, publicKey: kp.publicKey(), ...args }),
  });
  const prepData = await prepRes.json();
  console.log(`[prepare ${step}] ${prepRes.status}`, prepRes.ok ? "(xdr received)" : JSON.stringify(prepData));
  if (!prepRes.ok) throw new Error(prepData.error);

  const tx = TransactionBuilder.fromXdr(prepData.xdr, Networks.TESTNET);
  tx.sign(kp);
  const signedXdr = tx.toXdr();

  const subRes = await fetch(`${APP_URL}/api/stellar-source/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signedXdr }),
  });
  const subData = await subRes.json();
  console.log(`[submit ${step}] ${subRes.status}`, JSON.stringify(subData));
  if (!subRes.ok || subData.status !== "SUCCESS") throw new Error(`${step} failed`);
  return subData;
}

console.log("\n--- Step: trustline (via /api/stellar-source/prepare + submit) ---");
await prepareSignSubmit("trustline", {});

console.log("\n--- Step: swap XLM -> USDC (via the actual API routes) ---");
await prepareSignSubmit("swap", { amountIn: "1000000000", amountOutMin: "1" }); // 100 XLM

console.log("\n--- Reading balance via /api/stellar-source/balance ---");
const balRes = await fetch(`${APP_URL}/api/stellar-source/balance?publicKey=${kp.publicKey()}`).then((r) => r.json());
console.log("balance:", JSON.stringify(balRes));
const usdcAmount = BigInt(balRes.balance);
if (usdcAmount <= 0n) throw new Error("no USDC after swap");

console.log("\n--- Step: approve TokenMessengerMinter (via the actual API routes) ---");
await prepareSignSubmit("approve", {
  amount: usdcAmount.toString(),
  spender: "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
});

console.log("\n--- Step: burn (deposit_for_burn_with_hook, via the actual API routes) ---");
const ARB_EXECUTOR = "0x9B6aaDaEeD2cAF2B3b26C62aA5dEaCcB8052F40B" as const;
const freshRecipient = privateKeyToAccount(generatePrivateKey()).address;
const mintRecipientHex = padHex(ARB_EXECUTOR, { size: 32 });
const SWAP_USDC_TO_NATIVE_ABI = [
  {
    type: "function",
    name: "swapUsdcToNative",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "poolFee", type: "uint24" },
      { name: "minOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const;
const hookDataHex = encodeHook({
  target: ARB_EXECUTOR,
  calldata: encodeFunctionData({
    abi: SWAP_USDC_TO_NATIVE_ABI,
    functionName: "swapUsdcToNative",
    args: [0n, 3000, 1n, freshRecipient],
  }),
  forwardAmount: 0n,
});
await prepareSignSubmit("burn", {
  amount: usdcAmount.toString(),
  destinationDomain: 3,
  mintRecipientHex,
  destinationCallerHex: mintRecipientHex,
  maxFee: "0",
  hookDataHex,
});

console.log("\n✅ All /api/stellar-source/* routes (trustline, swap, balance, approve, burn) work end to end.");
