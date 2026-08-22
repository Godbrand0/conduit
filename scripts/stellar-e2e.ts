/**
 * Full end-to-end proof: Base Sepolia native ETH -> Stellar Testnet native
 * XLM, one signature, fully trustless — no extra user signature needed.
 *
 * Uses the EXISTING, unmodified SwapAndBurn on Base (hookData is a plain
 * caller-supplied parameter, no on-chain format constraint), pointed at
 * Conduit's swap_and_deliver Soroban contract. Two on-chain steps on the
 * Stellar side (both permissionless, no signature): CctpForwarder.
 * mint_and_forward (Circle's own contract, delivers USDC to
 * swap_and_deliver), then swap_and_deliver.swap_and_deliver (Conduit's own
 * contract, re-parses the same attested message to find the *real* final
 * recipient Conduit embedded after Circle's own hookData section, swaps
 * USDC -> XLM on Soroswap, delivers it).
 */
import { config } from "dotenv";
import { createWalletClient, createPublicClient, http, parseEther, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { AttestationClient } from "@cctp-sdk/core";
import {
  Horizon,
  rpc,
  TransactionBuilder,
  Networks,
  Keypair,
  BASE_FEE,
  StrKey,
  Contract,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

config({ path: new URL("../.env", import.meta.url).pathname });

const ARBITRUM_RPC = process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc";
const SWAP_AND_BURN_ARBITRUM = "0xcEE2b537Ee71c0B4399761537357c1c2B5A5F6Ec" as const;
const ARBITRUM_DOMAIN = 3;
const STELLAR_DOMAIN = 27;
const CCTP_FORWARDER = "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ";
const SWAP_AND_DELIVER = "CBHP22SRJB4JXSDAQ6LKAZV72JLBL2GV7MCRVLYKO6GI7GKZ3XP5XPY6";
const FINAL_RECIPIENT_G = "GAGGMB6D7IBFUMXB2A2CTC3UBV3OOIBGOTONDKBWT4PWY45MWMMFBS36";
// Testnet Stellar relayer keypair (pays Stellar-side transaction fees for
// both mint_and_forward and swap_and_deliver) — set STELLAR_RELAYER_SECRET
// in .env, same pattern as PRIVATE_KEY for the EVM side. Never hardcode a
// secret key here, even a testnet-only one.
const RELAYER_SECRET = process.env.STELLAR_RELAYER_SECRET as string;
if (!RELAYER_SECRET) throw new Error("Set STELLAR_RELAYER_SECRET in .env");

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: arbitrumSepolia, transport: http(ARBITRUM_RPC) });
const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(ARBITRUM_RPC) });

// --- CCTP's own mintRecipient/destinationCaller must ALWAYS be
// CctpForwarder's own address — it's the entity MessageTransmitter actually
// mints to. Where funds really go is CctpForwarder's OWN concern, encoded
// inside hookData's forwardRecipient field (here: swap_and_deliver), which
// Conduit's own trailing field then further redirects to the final user. ---
const cctpForwarderBytes32 =
  `0x${Buffer.from(StrKey.decodeContract(CCTP_FORWARDER)).toString("hex")}` as `0x${string}`;
const circleRecipientAscii = Buffer.from(SWAP_AND_DELIVER, "ascii"); // 56 bytes
const reserved = Buffer.alloc(24, 0);
const version = Buffer.alloc(4, 0);
const circleLen = Buffer.alloc(4);
circleLen.writeUInt32BE(circleRecipientAscii.length);

const finalRecipientAscii = Buffer.from(FINAL_RECIPIENT_G, "ascii"); // 56 bytes
const trailingLen = Buffer.alloc(4);
trailingLen.writeUInt32BE(finalRecipientAscii.length);

const hookData = `0x${Buffer.concat([
  reserved,
  version,
  circleLen,
  circleRecipientAscii,
  trailingLen,
  finalRecipientAscii,
]).toString("hex")}` as `0x${string}`;

console.log(`Burning ETH on Arbitrum -> USDC -> Stellar (via swap_and_deliver) -> XLM to ${FINAL_RECIPIENT_G}`);

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
  ],
  functionName: "swapAndBurnNative",
  // maxFee=2 USDC: real margin above Circle's quoted 1.3 USDC minimum for
  // this route, to actually get the fast-transfer path instead of silently
  // falling back to standard (L1-anchored) finality, which is what
  // happened on the first attempt when maxFee exactly matched the minimum.
  args: [parseUnits("10", 6), 3000, STELLAR_DOMAIN, cctpForwarderBytes32, cctpForwarderBytes32, 2_000_000n, 1000, hookData],
  value: parseEther("0.02"),
});
console.log(`[burn tx] ${burnHash}`);
await publicClient.waitForTransactionReceipt({ hash: burnHash });
console.log("[burn] confirmed on Arbitrum");

const attestation = new AttestationClient("https://iris-api-sandbox.circle.com");
const { attestation: att, messageBytes } = await attestation.poll(burnHash, ARBITRUM_DOMAIN, {
  maxAttempts: 60,
  intervalMs: 2000,
  onAttempt: (n) => process.stdout.write(`\r[attestation] polling Iris… ${n}`),
});
console.log("\n[attestation] complete");

const rpcServer = new rpc.Server("https://soroban-testnet.stellar.org");
const relayerKp = Keypair.fromSecret(RELAYER_SECRET);
const messageBuf = Buffer.from(messageBytes.slice(2), "hex");
const attestationBuf = Buffer.from(att.slice(2), "hex");

async function invoke(contractId: string, fn: string, args: any[]) {
  const contract = new Contract(contractId);
  const src = await rpcServer.getAccount(relayerKp.publicKey());
  const tx = new TransactionBuilder(src, { fee: (Number(BASE_FEE) * 100).toString(), networkPassphrase: Networks.TESTNET })
    .addOperation(contract.call(fn, ...args))
    .setTimeout(60)
    .build();
  const prepared = await rpcServer.prepareTransaction(tx);
  prepared.sign(relayerKp);
  const sent = await rpcServer.sendTransaction(prepared);
  let final = sent;
  // NOT_FOUND (not just PENDING) can also be transient RPC-indexing lag
  // right after submission, not necessarily a real failure — keep retrying
  // through it too, same as PENDING.
  for (let i = 0; i < 30 && (final.status === "PENDING" || final.status === "NOT_FOUND"); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    final = await rpcServer.getTransaction(sent.hash);
  }
  return { hash: sent.hash, final };
}

console.log("[step 1] CctpForwarder.mint_and_forward…");
const step1 = await invoke(CCTP_FORWARDER, "mint_and_forward", [
  nativeToScVal(messageBuf, { type: "bytes" }),
  nativeToScVal(attestationBuf, { type: "bytes" }),
]);
console.log(`  tx: ${step1.hash} status: ${step1.final.status}`);
if (step1.final.status !== "SUCCESS") {
  console.log(JSON.stringify(step1.final, null, 2).slice(0, 1500));
  process.exit(1);
}

const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const finalBefore = await horizon.accounts().accountId(FINAL_RECIPIENT_G).call();
const xlmBefore = Number(finalBefore.balances.find((b: any) => b.asset_type === "native")!.balance);

console.log("[step 2] swap_and_deliver.swap_and_deliver…");
const step2 = await invoke(SWAP_AND_DELIVER, "swap_and_deliver", [
  nativeToScVal(messageBuf, { type: "bytes" }),
  nativeToScVal(1n, { type: "i128" }), // min_out=1: testnet pool, arbitrary price
]);
console.log(`  tx: ${step2.hash} status: ${step2.final.status}`);
if (step2.final.status !== "SUCCESS") {
  console.log(JSON.stringify(step2.final, null, 2).slice(0, 2000));
  process.exit(1);
}

const finalAfter = await horizon.accounts().accountId(FINAL_RECIPIENT_G).call();
const xlmAfter = Number(finalAfter.balances.find((b: any) => b.asset_type === "native")!.balance);

console.log("\n✅ Arbitrum -> Stellar complete, fully trustless, one signature");
console.log(`  Burn tx (Arbitrum):          ${burnHash}`);
console.log(`  mint_and_forward tx (Stellar): ${step1.hash}`);
console.log(`  swap_and_deliver tx (Stellar): ${step2.hash}`);
console.log(`  Native XLM received: ${(xlmAfter - xlmBefore).toFixed(7)} XLM`);
