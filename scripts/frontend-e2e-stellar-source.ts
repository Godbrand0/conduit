/**
 * Live proof for Phase 2: Stellar (native XLM) as SOURCE -> an EVM chain as
 * destination (native ETH). Mirrors scripts/frontend-e2e-stellar.ts's
 * approach (real burn, then POST to the running dev server's /api/swaps so
 * the app's OWN relayer.ts does the real relay work) but reversed.
 *
 * This script signs directly with a Keypair via @stellar/stellar-sdk rather
 * than through the Stellar Wallets Kit (which needs a real browser + a
 * Freighter extension, unavailable in this headless environment) — but it
 * performs the exact same on-chain operations, in the exact same order, that
 * frontend/app/hooks/useSwap.ts's source.isStellar branch builds server-side
 * via /api/stellar-source/prepare, so it proves the underlying protocol flow
 * end to end. The wallet-signing UI itself is unverified live (see report).
 *
 * Uses a disposable, Friendbot-funded testnet keypair, NOT the shared
 * relayer's STELLAR_RELAYER_SECRET.
 */
import { config } from "dotenv";
import {
  rpc,
  Contract,
  Address,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Keypair,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { createPublicClient, http, encodeFunctionData, padHex, formatEther } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { encodeHook } from "@cctp-sdk/core";

config({ path: new URL("../.env", import.meta.url).pathname });

const APP_URL = "http://localhost:3000";
const RPC_URL = "https://soroban-testnet.stellar.org";
const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAIR = "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS";
const TOKEN_MESSENGER_MINTER = "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"; // read live via USDC SAC's name() in verify-soroswap-router.ts
const STELLAR_DOMAIN = 27;

const ARB_EXECUTOR = "0x9B6aaDaEeD2cAF2B3b26C62aA5dEaCcB8052F40B" as const;
const ARB_POOL_FEE = 3000;
const ARB_DOMAIN = 3;

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

const server = new rpc.Server(RPC_URL);

// Fresh, previously-unfunded EVM recipient so the balance delta is unambiguous.
const freshPk = generatePrivateKey();
const freshAccount = privateKeyToAccount(freshPk);
console.log(`Fresh EVM recipient (unfunded until this transfer lands): ${freshAccount.address}`);

const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(process.env.ARB_SEPOLIA_RPC) });

const kp = Keypair.random();
console.log(`Disposable Stellar test keypair (source): ${kp.publicKey()}`);
console.log("Funding via Friendbot...");
const fr = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
if (!fr.ok) throw new Error(`Friendbot failed: ${fr.status} ${await fr.text()}`);
console.log("Funded with 10,000 test XLM.");

async function invoke(contractId: string, fn: string, args: unknown[]) {
  const contract = new Contract(contractId);
  const src = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(src, { fee: (Number(BASE_FEE) * 100).toString(), networkPassphrase: Networks.TESTNET })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addOperation(contract.call(fn, ...(args as any)))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(kp);
  const sent = await server.sendTransaction(prepared);
  if (sent.status !== "PENDING") {
    throw new Error(`sendTransaction: ${sent.status} ${JSON.stringify(sent.errorResult ?? "")}`);
  }
  let final: rpc.Api.GetTransactionResponse = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    final = await server.getTransaction(sent.hash);
  }
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${fn} failed: ${final.status} ${JSON.stringify(final).slice(0, 1000)}`);
  }
  return sent.hash;
}

// --- Step 0: trustline (real Stellar accounts need one for classic-backed
// SAC assets like USDC before they can hold a balance — confirmed live via
// scripts/verify-soroswap-router.ts; contracts never need this, only
// accounts, which is why Phase 1 never hit it). ---
console.log("\n[1/4] Establishing USDC trustline...");
{
  const src = await server.getAccount(kp.publicKey());
  const trustTx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", USDC_ISSUER) }))
    .setTimeout(30)
    .build();
  trustTx.sign(kp);
  const sent = await server.sendTransaction(trustTx);
  let final: rpc.Api.GetTransactionResponse = await server.getTransaction(sent.hash);
  for (let i = 0; i < 20 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    final = await server.getTransaction(sent.hash);
  }
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`changeTrust failed: ${final.status}`);
  console.log("Trustline established.");
}

// --- Step 1: swap XLM -> USDC via Soroswap's ROUTER (verified live to work
// for a real EOA signer — see scripts/verify-soroswap-router.ts and
// DEPLOYMENTS.md). One signature. ---
const XLM = Asset.native().contractId(Networks.TESTNET);
const amountInStroops = 200_0000000n; // 200 XLM
console.log(`\n[2/4] Swapping ${amountInStroops} stroops (200 XLM) -> USDC via Soroswap router...`);
const swapHash = await invoke(ROUTER, "swap_exact_tokens_for_tokens", [
  nativeToScVal(amountInStroops, { type: "i128" }),
  nativeToScVal(1n, { type: "i128" }), // testnet pool, arbitrary min — real app uses a real slippage floor
  nativeToScVal([Address.fromString(XLM), Address.fromString(USDC)], { type: "Vec" }),
  new Address(kp.publicKey()).toScVal(),
  nativeToScVal(Math.floor(Date.now() / 1000) + 300, { type: "u64" }),
]);
console.log(`[swap tx] ${swapHash}`);

// Read resulting USDC balance to know exactly how much to burn.
const usdcContract = new Contract(USDC);
async function usdcBalance(): Promise<bigint> {
  const src = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(usdcContract.call("balance", new Address(kp.publicKey()).toScVal()))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  const { scValToNative } = await import("@stellar/stellar-sdk");
  return BigInt(scValToNative(sim.result!.retval));
}
const usdcAmount = await usdcBalance();
console.log(`USDC acquired: ${usdcAmount} (µUSDC)`);
if (usdcAmount <= 0n) throw new Error("Swap produced no USDC");

// --- Step 2: approve TokenMessengerMinter (standard Soroban approve pattern
// — deposit_and_burn internally uses transfer_from, confirmed against
// Circle's own source). One signature. ---
console.log("\n[3/4] Approving TokenMessengerMinter to pull USDC...");
const ledger = await server.getLatestLedger();
const approveHash = await invoke(USDC, "approve", [
  new Address(kp.publicKey()).toScVal(),
  new Address(TOKEN_MESSENGER_MINTER).toScVal(),
  nativeToScVal(usdcAmount, { type: "i128" }),
  nativeToScVal(ledger.sequence + 100_000, { type: "u32" }),
]);
console.log(`[approve tx] ${approveHash}`);

// --- Step 3: deposit_for_burn_with_hook, targeting Arbitrum Sepolia's
// existing, UNMODIFIED ReceiveAndSwap executor -- the exact same hookData
// byte format useSwap.ts already builds for every EVM-source route (no new
// EVM-side logic needed). One signature. ---
console.log("\n[4/4] Burning USDC on Stellar -> Arbitrum Sepolia native ETH via deposit_for_burn_with_hook...");
const mintRecipientBytes32 = padHex(ARB_EXECUTOR, { size: 32 });
const destinationCallerBytes32 = padHex(ARB_EXECUTOR, { size: 32 });
const hookData = encodeHook({
  target: ARB_EXECUTOR,
  calldata: encodeFunctionData({
    abi: SWAP_USDC_TO_NATIVE_ABI,
    functionName: "swapUsdcToNative",
    args: [0n, ARB_POOL_FEE, 1n, freshAccount.address],
  }),
  forwardAmount: 0n,
});

const feeRes = await fetch(`${APP_URL}/api/fee?from=stellar&to=arbitrum`).then((r) => r.json()).catch(() => null);
const maxFee = feeRes?.maxFee ? BigInt(feeRes.maxFee) : 100_000n; // fallback: 0.1 USDC
console.log(`Using max_fee=${maxFee} (from /api/fee: ${JSON.stringify(feeRes)})`);

const burnHash = await invoke(TOKEN_MESSENGER_MINTER, "deposit_for_burn_with_hook", [
  new Address(kp.publicKey()).toScVal(),
  nativeToScVal(usdcAmount, { type: "i128" }),
  nativeToScVal(ARB_DOMAIN, { type: "u32" }),
  nativeToScVal(Buffer.from(mintRecipientBytes32.slice(2), "hex"), { type: "bytes" }),
  new Address(USDC).toScVal(),
  nativeToScVal(Buffer.from(destinationCallerBytes32.slice(2), "hex"), { type: "bytes" }),
  nativeToScVal(maxFee, { type: "i128" }),
  nativeToScVal(1000, { type: "u32" }),
  nativeToScVal(Buffer.from(hookData.slice(2), "hex"), { type: "bytes" }),
]);
console.log(`[burn tx] ${burnHash}`);

console.log("\n[app] POSTing to running frontend's /api/swaps (same request the browser would send)...");
const res = await fetch(`${APP_URL}/api/swaps`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ burnTxHash: burnHash, from: "stellar", to: "arbitrum" }),
});
console.log(`[app] POST /api/swaps -> ${res.status}`, await res.json().catch(() => ({})));

console.log("[poll] waiting for frontend's relayer.ts (standard EVM relayAndExecute path) to complete...");
let status = "";
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await fetch(`${APP_URL}/api/swaps/${burnHash}`);
  if (!r.ok) {
    process.stdout.write(".");
    continue;
  }
  const s = await r.json();
  status = s.status;
  process.stdout.write(`\r[poll ${i}] status=${status}                          `);
  if (status === "COMPLETE" || status === "FAILED") {
    console.log("\n", JSON.stringify(s, null, 2));
    break;
  }
}

if (status === "COMPLETE") {
  const bal = await publicClient.getBalance({ address: freshAccount.address });
  console.log(`\n✅ Stellar -> Arbitrum Sepolia swap complete. Recipient now has ${formatEther(bal)} ETH.`);
} else {
  console.log(`\n❌ Swap did not complete. Final status: ${status || "unknown/timeout"}`);
  process.exit(1);
}
