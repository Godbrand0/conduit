/**
 * Live proof that the FRONTEND'S wired Stellar code path works, not just the
 * standalone stellar-e2e.ts script. Fires a burn using the exact same
 * hookData byte construction as frontend/app/hooks/useSwap.ts, then POSTs to
 * the running dev server's /api/swaps — the same request the browser would
 * send — so the actual frontend/lib/relayer.ts relayToStellar() branch does
 * the real work (mint_and_forward + swap_and_deliver), not this script.
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, concatHex, numberToHex, stringToHex, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { StrKey, Keypair, Horizon } from "@stellar/stellar-sdk";

config({ path: new URL("../.env", import.meta.url).pathname });

const APP_URL = "http://localhost:3000";
const SWAP_AND_BURN_ARBITRUM = "0xcEE2b537Ee71c0B4399761537357c1c2B5A5F6Ec" as const;
const STELLAR_CCTP_FORWARDER = "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ";
const STELLAR_SWAP_AND_DELIVER = "CBHP22SRJB4JXSDAQ6LKAZV72JLBL2GV7MCRVLYKO6GI7GKZ3XP5XPY6";
const STELLAR_DOMAIN = 27;

// Fresh recipient so before/after balance comparison is unambiguous (avoids
// any stale balance from a prior proof run against the same account).
const recipientKp = Keypair.random();
const stellarRecipient = recipientKp.publicKey();
console.log(`Fresh Stellar recipient (unfunded until this transfer lands): ${stellarRecipient}`);

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: arbitrumSepolia, transport: http(process.env.ARB_SEPOLIA_RPC) });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(process.env.ARB_SEPOLIA_RPC) });

// --- Replicate useSwap.ts's dest.isStellar branch exactly ---
const forwarderBytes32 = toHex(StrKey.decodeContract(STELLAR_CCTP_FORWARDER)) as `0x${string}`;
const mintRecipientBytes32 = forwarderBytes32;
const destinationCaller = forwarderBytes32;
const circleRecipientAscii = stringToHex(STELLAR_SWAP_AND_DELIVER);
const finalRecipientAscii = stringToHex(stellarRecipient);
const hookData = concatHex([
  numberToHex(0, { size: 24 }),
  numberToHex(0, { size: 4 }),
  numberToHex(STELLAR_SWAP_AND_DELIVER.length, { size: 4 }),
  circleRecipientAscii,
  numberToHex(stellarRecipient.length, { size: 4 }),
  finalRecipientAscii,
]);

console.log(`Burning 0.015 ETH on Arbitrum Sepolia -> Stellar XLM to ${stellarRecipient}`);
const burnHash = await wallet.writeContract({
  address: SWAP_AND_BURN_ARBITRUM,
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
  ] as const,
  functionName: "swapAndBurnNative",
  args: [parseUnits("5", 6), 3000, STELLAR_DOMAIN, mintRecipientBytes32, destinationCaller, 2_000_000n, 1000, hookData],
  value: parseEther("0.015"),
});
console.log(`[burn tx] ${burnHash}`);
await publicClient.waitForTransactionReceipt({ hash: burnHash });
console.log("[burn] confirmed on Arbitrum");

console.log("[app] POSTing to running frontend's /api/swaps (same request the browser sends)...");
const res = await fetch(`${APP_URL}/api/swaps`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ burnTxHash: burnHash, from: "arbitrum", to: "stellar" }),
});
console.log(`[app] POST /api/swaps -> ${res.status}`, await res.json().catch(() => ({})));

const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
console.log("[poll] waiting for frontend's relayer.ts to complete (checking /api/swaps/{hash})...");
let status = "";
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const r = await fetch(`${APP_URL}/api/swaps/${burnHash}`);
  if (!r.ok) { process.stdout.write("."); continue; }
  const s = await r.json();
  status = s.status;
  process.stdout.write(`\r[poll ${i}] status=${status}                          `);
  if (status === "COMPLETE" || status === "FAILED") {
    console.log("\n", JSON.stringify(s, null, 2));
    break;
  }
}

if (status === "COMPLETE") {
  const acc = await horizon.accounts().accountId(stellarRecipient).call();
  const xlm = acc.balances.find((b: any) => b.asset_type === "native")!.balance;
  console.log(`\n✅ Frontend-wired EVM -> Stellar swap complete. Recipient now has ${xlm} XLM.`);
} else {
  console.log(`\n❌ Swap did not complete via the frontend. Final status: ${status || "unknown/timeout"}`);
  process.exit(1);
}
