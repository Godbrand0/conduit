/**
 * Verifies the router-vs-bypass hypothesis for Phase 2 (Stellar as SOURCE):
 * does Soroswap's testnet ROUTER work when called by a real EOA keypair
 * (source account = signer), unlike the CONTRACT-identity caller case in
 * Phase 1 (DEPLOYMENTS.md #15), which failed on the router's nested
 * token.transfer(from=caller, to=pair) because a contract can't sign a
 * Soroban auth entry for a sub-invocation the way an Ed25519 account can?
 *
 * Uses a disposable, Friendbot-funded testnet keypair — NOT the shared
 * relayer's STELLAR_RELAYER_SECRET — so no user confirmation is needed to
 * spend anything of value.
 */
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
  scValToNative,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const PAIR = "CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS";
// USDC's SAC wraps this classic Stellar asset (read live via `name()` on the
// SAC, not hardcoded from docs). Classic-asset-backed SAC transfers into a
// plain Stellar ACCOUNT (not a contract) still require a classic trustline
// on that account first — contracts never need one, which is why Phase 1
// (USDC minted straight into swap_and_deliver, a contract) never hit this.
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_ASSET = new Asset("USDC", USDC_ISSUER);

const server = new rpc.Server(RPC_URL);
const XLM = Asset.native().contractId(Networks.TESTNET);
console.log(`Native XLM SAC (testnet): ${XLM}`);

const kp = Keypair.random();
console.log(`Disposable test keypair: ${kp.publicKey()}`);
console.log("Funding via Friendbot...");
const fr = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
if (!fr.ok) throw new Error(`Friendbot failed: ${fr.status} ${await fr.text()}`);
console.log("Funded with 10,000 test XLM.");

console.log("Establishing a USDC trustline (classic changeTrust op) on the test account...");
{
  const src = await server.getAccount(kp.publicKey());
  const trustTx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(30)
    .build();
  trustTx.sign(kp);
  const sent = await server.sendTransaction(trustTx);
  if (sent.status !== "PENDING") throw new Error(`changeTrust send failed: ${sent.status}`);
  let final: rpc.Api.GetTransactionResponse = await server.getTransaction(sent.hash);
  for (let i = 0; i < 20 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    final = await server.getTransaction(sent.hash);
  }
  if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`changeTrust failed: ${final.status}`);
  console.log("Trustline established.");
}

async function invoke(contractId: string, fn: string, args: unknown[], signer: Keypair) {
  const contract = new Contract(contractId);
  const src = await server.getAccount(signer.publicKey());
  const tx = new TransactionBuilder(src, { fee: (Number(BASE_FEE) * 100).toString(), networkPassphrase: Networks.TESTNET })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .addOperation(contract.call(fn, ...(args as any)))
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status !== "PENDING") {
    throw new Error(`sendTransaction: ${sent.status} ${JSON.stringify(sent.errorResult ?? "")}`);
  }
  let final: rpc.Api.GetTransactionResponse = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    final = await server.getTransaction(sent.hash);
  }
  return { hash: sent.hash, final };
}

// Read reserves so we can pick a sane amount_out_min (real quote, not a guess).
const pairContract = new Contract(PAIR);
async function simulateRead(fn: string) {
  const src = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(pairContract.call(fn))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result!.retval);
}
const [reserves, token0] = await Promise.all([simulateRead("get_reserves"), simulateRead("token_0")]);
const usdcIsToken0 = token0 === USDC;
const [reserveUsdc, reserveXlm] = usdcIsToken0 ? [BigInt(reserves[0]), BigInt(reserves[1])] : [BigInt(reserves[1]), BigInt(reserves[0])];
console.log(`Pair reserves: USDC=${reserveUsdc} XLM(stroops)=${reserveXlm}`);

const amountIn = 50_0000000n; // 50 XLM (7-decimal stroops)
const amountInWithFee = amountIn * 997n;
const estOut = (amountInWithFee * reserveUsdc) / (reserveXlm * 1000n + amountInWithFee);
const amountOutMin = (estOut * 990n) / 1000n; // 1% slippage floor
console.log(`Swapping ${amountIn} stroops XLM -> est ${estOut} USDC (min ${amountOutMin})`);

console.log("\n--- Attempt 1: Soroswap ROUTER, called directly by the EOA (source account = signer) ---");
try {
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const { hash, final } = await invoke(
    ROUTER,
    "swap_exact_tokens_for_tokens",
    [
      nativeToScVal(amountIn, { type: "i128" }),
      nativeToScVal(amountOutMin, { type: "i128" }),
      nativeToScVal([Address.fromString(XLM), Address.fromString(USDC)], { type: "Vec" }),
      new Address(kp.publicKey()).toScVal(),
      nativeToScVal(deadline, { type: "u64" }),
    ],
    kp
  );
  console.log(`Router tx hash: ${hash}`);
  console.log(`Status: ${final.status}`);
  if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    console.log("RESULT: Router WORKS for an EOA caller. Use the router.");
  } else {
    console.log("RESULT: Router FAILED for an EOA caller too.", JSON.stringify(final).slice(0, 800));
  }
} catch (e) {
  console.log("RESULT: Router threw for an EOA caller:", e instanceof Error ? e.message : e);
}

// Check resulting USDC balance regardless, to see how much actually landed.
const usdcClient = new Contract(USDC);
const balSrc = await server.getAccount(kp.publicKey());
const balTx = new TransactionBuilder(balSrc, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(usdcClient.call("balance", new Address(kp.publicKey()).toScVal()))
  .setTimeout(30)
  .build();
const balSim = await server.simulateTransaction(balTx);
if (!rpc.Api.isSimulationError(balSim)) {
  console.log(`Final USDC balance of test account: ${scValToNative(balSim.result!.retval)}`);
}
