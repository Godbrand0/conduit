import { NextRequest, NextResponse } from "next/server";
import {
  rpc,
  Contract,
  scValToNative,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Keypair,
} from "@stellar/stellar-sdk";
import { LEGS } from "@/lib/legs";

/**
 * Proxy Soroban RPC's simulateTransaction so the browser can spot-quote the
 * Soroswap USDC/XLM pair's reserves without a viem publicClient (Stellar has
 * no JSON-RPC — Soroban RPC calls don't fit a client-side effect cleanly).
 * Mirrors swap_and_deliver's own on-chain reserve read (constant-product,
 * 0.3% fee) — see stellar/swap_and_deliver/contracts/swap_and_deliver/src/lib.rs.
 *
 * Same reserves serve both directions: pass `to=stellar` when Stellar is the
 * destination (Phase 1, USDC → XLM) or `from=stellar` when Stellar is the
 * source (Phase 2, XLM → USDC) — either way this just returns the pair's raw
 * reserves and the client picks the right quote formula.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("to") ?? req.nextUrl.searchParams.get("from") ?? "";
  const dest = LEGS[key];
  if (!dest?.isStellar) {
    return NextResponse.json({ error: "not a stellar leg" }, { status: 400 });
  }

  try {
    const server = new rpc.Server(dest.rpc);
    const pair = new Contract(dest.stellarPair!);

    // simulateTransaction needs a real (existing) source account to read a
    // sequence number from — no fee is actually charged for a read-only
    // simulation, so reusing the relayer's own funded account is fine here.
    const relayerPub = Keypair.fromSecret(process.env.STELLAR_RELAYER_SECRET as string).publicKey();
    const source = await server.getAccount(relayerPub);

    const simulate = async (fn: string) => {
      const tx = new TransactionBuilder(source, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(pair.call(fn))
        .setTimeout(30)
        .build();
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
      return scValToNative(sim.result!.retval);
    };

    const [reserves, token0] = await Promise.all([simulate("get_reserves"), simulate("token_0")]);
    const [reserve0, reserve1] = [BigInt(reserves[0]), BigInt(reserves[1])];
    const usdcIsToken0 = token0 === dest.stellarUsdc;

    return NextResponse.json({
      reserveUsdc: (usdcIsToken0 ? reserve0 : reserve1).toString(),
      reserveXlm: (usdcIsToken0 ? reserve1 : reserve0).toString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "quote failed" },
      { status: 502 }
    );
  }
}
