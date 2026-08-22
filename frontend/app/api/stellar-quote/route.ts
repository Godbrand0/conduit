import { NextRequest, NextResponse } from "next/server";
import { rpc, Contract, scValToNative, TransactionBuilder, Networks, BASE_FEE, Account, Keypair } from "@stellar/stellar-sdk";
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
 *
 * Two things made the original version slow: fetching a real account's
 * sequence number from RPC on every single request (a full extra round-trip
 * a read-only simulation doesn't need — simulateTransaction never validates
 * the envelope's sequence against on-chain state, only actual submission
 * does, so a dummy source account works fine here — a standard pattern for
 * read-only Soroban calls), and re-deriving `token_0` (the pair's token
 * ordering, which never changes for a given pair) on every call instead of
 * once. This version does exactly one simulateTransaction round-trip per
 * quote (token_0 cached module-level after the first call, and a short
 * reserves cache absorbs rapid re-fetches from typing).
 */
// A random keypair with a real, valid checksum — never funded, never
// signs anything, exists purely to give TransactionBuilder a
// structurally-valid source account for a read-only simulation.
const DUMMY_SOURCE = new Account(Keypair.random().publicKey(), "0");
let cachedUsdcIsToken0: boolean | null = null;
let cachedReserves: { at: number; reserve0: bigint; reserve1: bigint } | null = null;
const RESERVES_TTL_MS = 3_000;

async function simulate(server: rpc.Server, pair: Contract, fn: string) {
  const tx = new TransactionBuilder(DUMMY_SOURCE, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(pair.call(fn))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(sim.error);
  return scValToNative(sim.result!.retval);
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("to") ?? req.nextUrl.searchParams.get("from") ?? "";
  const dest = LEGS[key];
  if (!dest?.isStellar) {
    return NextResponse.json({ error: "not a stellar leg" }, { status: 400 });
  }

  if (cachedReserves && Date.now() - cachedReserves.at < RESERVES_TTL_MS && cachedUsdcIsToken0 !== null) {
    const { reserve0, reserve1 } = cachedReserves;
    return NextResponse.json({
      reserveUsdc: (cachedUsdcIsToken0 ? reserve0 : reserve1).toString(),
      reserveXlm: (cachedUsdcIsToken0 ? reserve1 : reserve0).toString(),
    });
  }

  try {
    const server = new rpc.Server(dest.rpc);
    const pair = new Contract(dest.stellarPair!);

    // token_0 is immutable for a given pair — fetch once, reuse forever.
    const [reserves, token0] = await Promise.all([
      simulate(server, pair, "get_reserves"),
      cachedUsdcIsToken0 === null ? simulate(server, pair, "token_0") : Promise.resolve(null),
    ]);
    if (token0 !== null) cachedUsdcIsToken0 = token0 === dest.stellarUsdc;

    const [reserve0, reserve1] = [BigInt(reserves[0]), BigInt(reserves[1])];
    cachedReserves = { at: Date.now(), reserve0, reserve1 };
    const usdcIsToken0 = cachedUsdcIsToken0!;

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
