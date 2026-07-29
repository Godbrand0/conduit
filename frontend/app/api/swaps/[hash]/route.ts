import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSwap } from "@/lib/db";
import { relaySwap } from "@/lib/relayer";

const STALE_MS = 90_000;
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const swap = await getSwap(hash);
  if (!swap) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Sweep: re-kick anything stalled (crashed poll, timeout, server restart).
  const stalled =
    swap.status !== "COMPLETE" &&
    swap.status !== "RELAYING" &&
    Date.now() - swap.updatedAt > STALE_MS;
  if (stalled) {
    after(() =>
      relaySwap(swap.burnTxHash as `0x${string}`, swap.fromChain, swap.toChain).catch(() => {})
    );
  }

  return NextResponse.json(swap);
}
