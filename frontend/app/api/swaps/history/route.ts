import { NextRequest, NextResponse } from "next/server";
import { getAllSwaps } from "@/lib/db";

export async function GET(_req: NextRequest) {
  try {
    const swaps = await getAllSwaps();
    return NextResponse.json({ swaps });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch swaps" }, { status: 500 });
  }
}
