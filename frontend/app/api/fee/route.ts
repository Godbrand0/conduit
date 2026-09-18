import { NextRequest, NextResponse } from "next/server";
import { AttestationClient } from "@cctp-sdk/core";
import { LEGS } from "@/lib/legs";
import { rateLimit } from "@/lib/ratelimit";

/** Proxy Circle's fast-fee endpoint (browser CORS) and return µUSDC. */
export async function GET(req: NextRequest) {
  if (!rateLimit(req, "fee", 60, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!LEGS[from] || !LEGS[to]) {
    return NextResponse.json({ error: "unknown chain" }, { status: 400 });
  }
  try {
    const client = new AttestationClient("https://iris-api-sandbox.circle.com");
    const fee = await client.getMinimumFee(LEGS[from].domain, LEGS[to].domain);
    return NextResponse.json({ maxFee: fee.toString() });
  } catch (e) {
    console.error("fee lookup failed", e);
    return NextResponse.json({ error: "fee lookup failed" }, { status: 502 });
  }
}
