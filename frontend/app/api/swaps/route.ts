import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { insertSwap } from "@/lib/db";
import { relaySwap } from "@/lib/relayer";
import { LEGS } from "@/lib/legs";

// Fast transfers attest in ~15-20s; on Vercel a serverless function is
// frozen/killed the instant its response is sent, so the relay must either
// be awaited or scheduled with after() — a bare fire-and-forget promise
// would get cut off mid-poll. after() lets us respond immediately while the
// platform keeps the function alive for the background work.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { burnTxHash, from, to } = await req.json();
  // Stellar tx hashes are a bare 64-hex-char string (no 0x prefix, and not
  // the keccak of an RLP-encoded EVM tx) — Soroban RPC/Horizon never add
  // one. Every other chain is EVM, whose viem-produced tx hash IS 0x-
  // prefixed. Accept either shape, gated by which one this route matches.
  const validHash = LEGS[from]?.isStellar
    ? /^[0-9a-fA-F]{64}$/.test(burnTxHash ?? "")
    : /^0x[0-9a-fA-F]{64}$/.test(burnTxHash ?? "");
  if (!validHash || !LEGS[from] || !LEGS[to] || from === to) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  await insertSwap(burnTxHash, from, to);
  // The GET route's stale-sweep is the safety net if this run gets interrupted
  // anyway (deploys, cold-start limits); errors are persisted by relaySwap.
  after(() => relaySwap(burnTxHash, from, to).catch(() => {}));

  return NextResponse.json({ ok: true }, { status: 202 });
}
