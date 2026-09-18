import { NextRequest, NextResponse } from "next/server";
import {
  rpc,
  Contract,
  Address,
  Asset,
  Operation,
  StrKey,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { LEGS } from "@/lib/legs";
import { rateLimit } from "@/lib/ratelimit";
import { STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL, STELLAR_USDC_ISSUER } from "@/lib/stellarNetwork";

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
 * if they already hold USDC. The classic `changeTrust` step is also built
 * here since a real Stellar ACCOUNT needs a trustline for classic-asset-
 * backed SAC tokens like USDC before it can hold a balance — verified live
 * (scripts/verify-soroswap-router.ts); contracts never need this (Phase 1's
 * swap_and_deliver never hit it because USDC there is held by a contract,
 * not an account).
 *
 * This route never signs anything — it has no access to the user's key.
 *
 * It does, however, decide what the user is asked to sign, and the browser
 * supplies the parameters. Every one of them is therefore validated below,
 * against an allowlist where the value is an address. Unvalidated, this
 * endpoint would build — from the application's own trusted origin — a USDC
 * approval for any spender, or a CCTP burn to any destination with any hook:
 * a phishing amplifier against users who reasonably trust an XDR that came
 * from the real app.
 */
const SOROSWAP_ROUTER = "CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD";

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

/** A positive integer amount, as a decimal string, that fits an i128. */
function parseAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[0-9]{1,39}$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n || parsed > 2n ** 127n - 1n) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** A non-negative i128 amount — maxFee may legitimately be zero. */
function parseFee(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[0-9]{1,39}$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed > 2n ** 127n - 1n) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseHex(value: unknown, maxBytes: number): Buffer | null {
  if (typeof value !== "string") return null;
  const stripped = value.replace(/^0x/, "");
  if (stripped.length === 0 || stripped.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(stripped)) return null;
  if (stripped.length / 2 > maxBytes) return null;
  return Buffer.from(stripped, "hex");
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "stellar:prepare", 30, 60_000)) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const body = (await req.json()) as Body;
  const source = LEGS.stellar;
  if (!source?.isStellar) {
    return NextResponse.json({ error: "stellar leg misconfigured" }, { status: 500 });
  }

  // The account whose transaction this is must be a real Stellar account
  // address — every step below builds against it.
  if (typeof body.publicKey !== "string" || !StrKey.isValidEd25519PublicKey(body.publicKey)) {
    return badRequest("invalid publicKey");
  }

  // The only destinations Conduit ever asks a user to approve or burn to.
  // Anything else is not a Conduit transaction and this route will not build
  // it, whoever is asking.
  const permittedSpenders = new Set([source.stellarTokenMessengerMinter, SOROSWAP_ROUTER].filter(Boolean));
  const permittedMintRecipients = new Set(
    Object.values(LEGS)
      .map((leg) => leg.executor?.toLowerCase())
      .filter(Boolean)
  );
  const permittedDomains = new Set(Object.values(LEGS).map((leg) => leg.domain));

  try {
    const server = new rpc.Server(STELLAR_RPC_URL);
    const account = await server.getAccount(body.publicKey);
    const networkPassphrase = STELLAR_NETWORK_PASSPHRASE;

    if (body.step === "trustline") {
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(Operation.changeTrust({ asset: new Asset("USDC", STELLAR_USDC_ISSUER) }))
        .setTimeout(60)
        .build();
      // Classic operation — no Soroban simulation/footprint needed.
      return NextResponse.json({ xdr: tx.toXdr() });
    }

    if (body.step === "swap") {
      const amountIn = parseAmount(body.amountIn);
      const amountOutMin = parseAmount(body.amountOutMin);
      if (amountIn === null) return badRequest("invalid amountIn");
      // A zero floor is exactly the placeholder this audit removed
      // everywhere else; refuse to build an unprotected swap here too.
      if (amountOutMin === null) return badRequest("invalid amountOutMin");

      const xlm = Asset.native().contractId(networkPassphrase);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(
          new Contract(SOROSWAP_ROUTER).call(
            "swap_exact_tokens_for_tokens",
            nativeToScVal(amountIn, { type: "i128" }),
            nativeToScVal(amountOutMin, { type: "i128" }),
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
      const amount = parseAmount(body.amount);
      if (amount === null) return badRequest("invalid amount");
      if (typeof body.spender !== "string" || !permittedSpenders.has(body.spender)) {
        return badRequest("spender is not a Conduit contract");
      }

      const ledger = await server.getLatestLedger();
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(
          new Contract(source.stellarUsdc!).call(
            "approve",
            new Address(body.publicKey).toScVal(),
            new Address(body.spender).toScVal(),
            nativeToScVal(amount, { type: "i128" }),
            nativeToScVal(ledger.sequence + 100_000, { type: "u32" }) // ~5.7 days at 5s/ledger
          )
        )
        .setTimeout(60)
        .build();
      const prepared = await server.prepareTransaction(tx);
      return NextResponse.json({ xdr: prepared.toXdr() });
    }

    if (body.step === "burn") {
      const amount = parseAmount(body.amount);
      const maxFee = parseFee(body.maxFee);
      const mintRecipient = parseHex(body.mintRecipientHex, 32);
      const destinationCaller = parseHex(body.destinationCallerHex, 32);
      // Circle's 32-byte header + two 56-char strkeys with 4-byte length
      // prefixes + Conduit's 16-byte min-out field.
      const hookData = parseHex(body.hookDataHex, 256);

      if (amount === null) return badRequest("invalid amount");
      if (maxFee === null) return badRequest("invalid maxFee");
      if (mintRecipient === null || mintRecipient.length !== 32) return badRequest("invalid mintRecipient");
      if (destinationCaller === null || destinationCaller.length !== 32) {
        return badRequest("invalid destinationCaller");
      }
      if (hookData === null) return badRequest("invalid hookData");
      if (typeof body.destinationDomain !== "number" || !permittedDomains.has(body.destinationDomain)) {
        return badRequest("unknown destinationDomain");
      }
      // The burn must mint to a Conduit executor. mintRecipient is a
      // left-padded 20-byte EVM address here (Stellar source always targets
      // an EVM destination), so compare its low 20 bytes.
      const mintRecipientAddress = `0x${mintRecipient.subarray(12).toString("hex")}`;
      if (!permittedMintRecipients.has(mintRecipientAddress)) {
        return badRequest("mintRecipient is not a Conduit executor");
      }

      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(
          new Contract(source.stellarTokenMessengerMinter!).call(
            "deposit_for_burn_with_hook",
            new Address(body.publicKey).toScVal(),
            nativeToScVal(amount, { type: "i128" }),
            nativeToScVal(body.destinationDomain, { type: "u32" }),
            nativeToScVal(mintRecipient, { type: "bytes" }),
            new Address(source.stellarUsdc!).toScVal(),
            nativeToScVal(destinationCaller, { type: "bytes" }),
            nativeToScVal(maxFee, { type: "i128" }),
            nativeToScVal(1000, { type: "u32" }), // fast finality, matches every other leg's convention
            nativeToScVal(hookData, { type: "bytes" })
          )
        )
        .setTimeout(60)
        .build();
      const prepared = await server.prepareTransaction(tx);
      return NextResponse.json({ xdr: prepared.toXdr() });
    }

    return badRequest("unknown step");
  } catch (e) {
    // The underlying RPC error is for operators, not for whoever is probing
    // this endpoint.
    console.error("stellar-source/prepare failed", e);
    return NextResponse.json({ error: "could not prepare transaction" }, { status: 502 });
  }
}
