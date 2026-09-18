import { NextRequest, NextResponse } from "next/server";
import { getAllSwaps } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { toPublicSwap } from "@/lib/publicSwap";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Recent swaps, for the history view.
 *
 * This is deliberately a global feed — the app has no accounts, and every
 * field in it (transaction hashes, routes, amounts) is already public
 * on-chain data. What it must not do is hand out an unbounded, unmetered,
 * internally-detailed dump: the response is capped, and relayer error
 * strings are reduced to a category by toPublicSwap.
 */
export async function GET(req: NextRequest) {
  if (!rateLimit(req, "swaps:history", 30, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const requested = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_LIMIT) : DEFAULT_LIMIT;

  try {
    const swaps = await getAllSwaps(limit);
    return NextResponse.json({ swaps: swaps.map(toPublicSwap) });
  } catch {
    return NextResponse.json({ error: "Failed to fetch swaps" }, { status: 500 });
  }
}
