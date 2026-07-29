import { NextRequest, NextResponse } from "next/server";
import { AttestationClient } from "@cctp-sdk/core";
import { LEGS } from "@/lib/legs";

/** Proxy Circle's fast-fee endpoint (browser CORS) and return µUSDC. */
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!LEGS[from] || !LEGS[to]) {
    return NextResponse.json({ error: "unknown chain" }, { status: 400 });
  }
  const client = new AttestationClient("https://iris-api-sandbox.circle.com");
  const fee = await client.getMinimumFee(LEGS[from].domain, LEGS[to].domain);
  return NextResponse.json({ maxFee: fee.toString() });
}
