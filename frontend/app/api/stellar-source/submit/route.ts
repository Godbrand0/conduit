import { NextRequest, NextResponse } from "next/server";
import { rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { rateLimit } from "@/lib/ratelimit";
import { STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from "@/lib/stellarNetwork";

/**
 * Submits a Stellar Wallets Kit-signed transaction XDR and polls Soroban RPC
 * until it lands, returning the tx hash + final status. Kept server-side for
 * the same reason /api/stellar-quote and prepare/ are — no client-side
 * Soroban RPC plumbing needed in the browser, and it's one less thing that
 * has to guess at CORS behavior of the public RPC endpoint.
 *
 * Transactions arrive already signed, so this cannot move anyone's funds
 * without their key. It is still an outbound broadcast path, so it is
 * metered and size-bounded rather than left as an open relay that anyone can
 * push arbitrary traffic through.
 */
const MAX_XDR_LENGTH = 100_000;

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "stellar:submit", 30, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const { signedXdr } = (await req.json()) as { signedXdr: string };
  if (typeof signedXdr !== "string" || !signedXdr || signedXdr.length > MAX_XDR_LENGTH) {
    return NextResponse.json({ error: "missing or oversized signedXdr" }, { status: 400 });
  }

  let tx;
  try {
    // Parsing against our own passphrase also rejects transactions built for
    // a different network.
    tx = TransactionBuilder.fromXdr(signedXdr, STELLAR_NETWORK_PASSPHRASE);
  } catch {
    return NextResponse.json({ error: "malformed transaction" }, { status: 400 });
  }

  try {
    const server = new rpc.Server(STELLAR_RPC_URL);
    const sent = await server.sendTransaction(tx);
    if (sent.status !== "PENDING") {
      return NextResponse.json({ error: `send failed: ${sent.status}` }, { status: 502 });
    }

    let final: rpc.Api.GetTransactionResponse = await server.getTransaction(sent.hash);
    for (let i = 0; i < 30 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      final = await server.getTransaction(sent.hash);
    }

    return NextResponse.json({ hash: sent.hash, status: final.status });
  } catch (e) {
    console.error("stellar-source/submit failed", e);
    return NextResponse.json({ error: "could not submit transaction" }, { status: 502 });
  }
}
