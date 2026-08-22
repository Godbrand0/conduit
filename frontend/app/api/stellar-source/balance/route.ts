import { NextRequest, NextResponse } from "next/server";
import { rpc, Contract, Address, TransactionBuilder, Networks, BASE_FEE, scValToNative } from "@stellar/stellar-sdk";
import { LEGS } from "@/lib/legs";

/**
 * Reads a Stellar account's current USDC balance via a read-only Soroban
 * simulation (no fee charged, nothing submitted) — used right after the
 * XLM -> USDC swap step so useSwap.ts knows the EXACT amount to approve +
 * burn next, rather than trusting the pre-swap quote estimate (which can
 * differ slightly from the real output).
 */
const RPC_URL = "https://soroban-testnet.stellar.org";

export async function GET(req: NextRequest) {
  const publicKey = req.nextUrl.searchParams.get("publicKey");
  const source = LEGS.stellar;
  if (!publicKey || !source?.stellarUsdc) {
    return NextResponse.json({ error: "missing publicKey" }, { status: 400 });
  }
  try {
    const server = new rpc.Server(RPC_URL);
    const account = await server.getAccount(publicKey);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(source.stellarUsdc).call("balance", new Address(publicKey).toScVal()))
      .setTimeout(30)
      .build();
    const sim = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
    const balance = BigInt(scValToNative(sim.result!.retval));
    return NextResponse.json({ balance: balance.toString() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "balance read failed" },
      { status: 502 }
    );
  }
}
