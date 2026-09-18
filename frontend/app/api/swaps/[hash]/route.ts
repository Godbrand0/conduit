import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getSwap } from "@/lib/db";
import { relaySwap } from "@/lib/relayer";
import { rateLimit } from "@/lib/ratelimit";
import { toPublicSwap } from "@/lib/publicSwap";

const STALE_MS = 90_000;
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  // This route can re-trigger a relay, so it gets a ceiling too — generous,
  // since the UI legitimately polls it every few seconds while a swap runs.
  if (!rateLimit(req, "swaps:get", 120, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const { hash } = await params;
  // Reject anything that isn't a plausible tx hash before it reaches the
  // database, rather than relying on the query layer to be the only guard.
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(hash)) {
    return NextResponse.json({ error: "invalid hash" }, { status: 400 });
  }

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

  return NextResponse.json(toPublicSwap(swap));
}
