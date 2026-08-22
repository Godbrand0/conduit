import { NextRequest, NextResponse } from "next/server";
import {
  rpc,
  Contract,
  Address,
  Asset,
  Operation,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { LEGS } from "@/lib/legs";

/**
 * Builds an UNSIGNED (but simulated/prepared, footprint + resource fees
 * filled in) Stellar transaction XDR for one step of the Stellar-as-source
 * flow, so the browser can hand it to Stellar Wallets Kit for the user's own
 * signature. Mirrors the existing /api/stellar-quote proxy pattern — Soroban
 * RPC calls don't fit a client-side effect/fetch cleanly, and this also
 * keeps contract addresses and byte-layout logic server-side in one place.
 *
 * Soroban only allows one contract-invoking operation per transaction, so
 * each step here is prepared and signed separately — up to three sequential
 * signatures for a user starting from native XLM (swap, approve, burn), two
 * if they already hold USDC (approve, burn). The classic `changeTrust`
 * step is also built here since a real Stellar ACCOUNT needs a trustline for
 * classic-asset-backed SAC tokens like USDC before it can hold a balance —
 * verified live (scripts/verify-soroswap-router.ts); contracts never need
 * this (Phase 1's swap_and_deliver never hit it because USDC there is held
 * by a contract, not an account).
 *
 * This route never signs anything — it has no access to the user's key.
 */

const RPC_URL = "https://soroban-testnet.stellar.org";
const SOROSWAP_ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";
// USDC's SAC wraps this classic asset — read live via the SAC's own name()
// during development (see DEPLOYMENTS.md), not guessed from docs.
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

type Body =
  | { step: "trustline"; publicKey: string }
  | { step: "swap"; publicKey: string; amountIn: string; amountOutMin: string }
  | { step: "approve"; publicKey: string; amount: string; spender: string }
  | {
      step: "burn";
      publicKey: string;
      amount: string;
      destinationDomain: number;
      mintRecipientHex: string;
      destinationCallerHex: string;
      maxFee: string;
      hookDataHex: string;
    };

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const source = LEGS.stellar;
  if (!source?.isStellar) {
    return NextResponse.json({ error: "stellar leg misconfigured" }, { status: 500 });
  }

  try {
    const server = new rpc.Server(RPC_URL);
    const account = await server.getAccount(body.publicKey);

    if (body.step === "trustline") {
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(Operation.changeTrust({ asset: new Asset("USDC", USDC_ISSUER) }))
        .setTimeout(60)
        .build();
      // Classic operation — no Soroban simulation/footprint needed.
      return NextResponse.json({ xdr: tx.toXdr() });
    }

    if (body.step === "swap") {
      const xlm = Asset.native().contractId(Networks.TESTNET);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(
          new Contract(SOROSWAP_ROUTER).call(
            "swap_exact_tokens_for_tokens",
            nativeToScVal(BigInt(body.amountIn), { type: "i128" }),
            nativeToScVal(BigInt(body.amountOutMin), { type: "i128" }),
            nativeToScVal([Address.fromString(xlm), Address.fromString(source.stellarUsdc!)]),
            new Address(body.publicKey).toScVal(),
            nativeToScVal(Math.floor(Date.now() / 1000) + 300, { type: "u64" })
          )
        )
        .setTimeout(60)
        .build();
      const prepared = await server.prepareTransaction(tx);
      return NextResponse.json({ xdr: prepared.toXdr() });
    }

    if (body.step === "approve") {
      const ledger = await server.getLatestLedger();
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(
          new Contract(source.stellarUsdc!).call(
            "approve",
            new Address(body.publicKey).toScVal(),
            new Address(body.spender).toScVal(),
            nativeToScVal(BigInt(body.amount), { type: "i128" }),
            nativeToScVal(ledger.sequence + 100_000, { type: "u32" }) // ~5.7 days at 5s/ledger
          )
        )
        .setTimeout(60)
        .build();
      const prepared = await server.prepareTransaction(tx);
      return NextResponse.json({ xdr: prepared.toXdr() });
    }

    if (body.step === "burn") {
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
        .addOperation(
          new Contract(source.stellarTokenMessengerMinter!).call(
            "deposit_for_burn_with_hook",
            new Address(body.publicKey).toScVal(),
            nativeToScVal(BigInt(body.amount), { type: "i128" }),
            nativeToScVal(body.destinationDomain, { type: "u32" }),
            nativeToScVal(Buffer.from(body.mintRecipientHex.replace(/^0x/, ""), "hex"), { type: "bytes" }),
            new Address(source.stellarUsdc!).toScVal(),
            nativeToScVal(Buffer.from(body.destinationCallerHex.replace(/^0x/, ""), "hex"), { type: "bytes" }),
            nativeToScVal(BigInt(body.maxFee), { type: "i128" }),
            nativeToScVal(1000, { type: "u32" }), // fast finality, matches every other leg's convention
            nativeToScVal(Buffer.from(body.hookDataHex.replace(/^0x/, ""), "hex"), { type: "bytes" })
          )
        )
        .setTimeout(60)
        .build();
      const prepared = await server.prepareTransaction(tx);
      return NextResponse.json({ xdr: prepared.toXdr() });
    }

    return NextResponse.json({ error: "unknown step" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "prepare failed" },
      { status: 502 }
    );
  }
}
