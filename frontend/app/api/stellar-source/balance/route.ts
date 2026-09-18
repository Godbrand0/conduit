import { NextRequest, NextResponse } from "next/server";
import { rpc, Contract, Address, StrKey, TransactionBuilder, BASE_FEE, scValToNative } from "@stellar/stellar-sdk";
import { LEGS } from "@/lib/legs";
import { rateLimit } from "@/lib/ratelimit";
import { STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from "@/lib/stellarNetwork";

/**
 * Reads a Stellar account's current USDC balance via a read-only Soroban
 * simulation (no fee charged, nothing submitted) — used right after the
 * XLM -> USDC swap step so useSwap.ts knows the EXACT amount to approve +
 * burn next, rather than trusting the pre-swap quote estimate (which can
 * differ slightly from the real output).
 */
export async function GET(req: NextRequest) {
  if (!rateLimit(req, "stellar:balance", 60, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const publicKey = req.nextUrl.searchParams.get("publicKey");
  const source = LEGS.stellar;
  if (!publicKey || !StrKey.isValidEd25519PublicKey(publicKey) || !source?.stellarUsdc) {
    return NextResponse.json({ error: "missing or invalid publicKey" }, { status: 400 });
  }
  try {
    const server = new rpc.Server(STELLAR_RPC_URL);
    const account = await server.getAccount(publicKey);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(new Contract(source.stellarUsdc).call("balance", new Address(publicKey).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    const balance = BigInt(scValToNative(sim.result!.retval));
    return NextResponse.json({ balance: balance.toString() });
  } catch (e) {
    console.error("stellar-source/balance failed", e);
    return NextResponse.json({ error: "balance read failed" }, { status: 502 });
  }
}
