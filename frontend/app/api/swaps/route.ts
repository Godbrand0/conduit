import { NextRequest, NextResponse } from "next/server";
import { insertSwap } from "@/lib/db";
import { relaySwap } from "@/lib/relayer";
import { LEGS } from "@/lib/legs";

export async function POST(req: NextRequest) {
  const { burnTxHash, from, to } = await req.json();
  if (!/^0x[0-9a-fA-F]{64}$/.test(burnTxHash ?? "") || !LEGS[from] || !LEGS[to] || from === to) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  insertSwap(burnTxHash, from, to);
  // Fire-and-forget: fast transfers attest in ~15s; the GET route retries
  // anything that stalls. Errors are persisted to the row by relaySwap.
  relaySwap(burnTxHash, from, to).catch(() => {});

  return NextResponse.json({ ok: true }, { status: 202 });
}
