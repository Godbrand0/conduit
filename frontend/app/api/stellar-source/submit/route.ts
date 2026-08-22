import { NextRequest, NextResponse } from "next/server";
import { rpc, TransactionBuilder, Networks } from "@stellar/stellar-sdk";

/**
 * Submits a Stellar Wallets Kit-signed transaction XDR and polls Soroban RPC
 * until it lands, returning the tx hash + final status. Kept server-side for
 * the same reason /api/stellar-quote and prepare/ are — no client-side
 * Soroban RPC plumbing needed in the browser, and it's one less thing that
 * has to guess at CORS behavior of the public RPC endpoint.
 */
const RPC_URL = "https://soroban-testnet.stellar.org";

export async function POST(req: NextRequest) {
  const { signedXdr } = (await req.json()) as { signedXdr: string };
  if (!signedXdr) {
    return NextResponse.json({ error: "missing signedXdr" }, { status: 400 });
  }

  try {
    const server = new rpc.Server(RPC_URL);
    const tx = TransactionBuilder.fromXdr(signedXdr, Networks.TESTNET);
    const sent = await server.sendTransaction(tx);
    if (sent.status !== "PENDING") {
      return NextResponse.json(
        { error: `send failed: ${sent.status}`, detail: sent.errorResult ?? null },
        { status: 502 }
      );
    }

    let final: rpc.Api.GetTransactionResponse = await server.getTransaction(sent.hash);
    for (let i = 0; i < 30 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      final = await server.getTransaction(sent.hash);
    }

    return NextResponse.json({ hash: sent.hash, status: final.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "submit failed" },
      { status: 502 }
    );
  }
}
