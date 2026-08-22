import { AttestationClient, HOOK_EXECUTOR_ABI, MESSAGE_TRANSMITTER_ABI } from "@cctp-sdk/core";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  rpc,
  Contract,
  TransactionBuilder,
  Networks,
  Keypair,
  BASE_FEE,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { LEGS, type Leg } from "./legs";
import { getSwap, updateSwap } from "./db";

const IRIS = "https://iris-api-sandbox.circle.com";

/** Hashes currently being relayed by this process — prevents duplicate work
 * from concurrent GET-triggered retries. CCTP's used-nonce check is the real
 * idempotency guarantee; this just avoids wasted RPC calls. */
const inFlight = new Set<string>();

/**
 * Poll Iris for the attestation, then submit relayAndExecute on the
 * destination executor. Trustless: the hook comes from the attested message,
 * so this wallet can only pay gas, never redirect funds.
 */
export async function relaySwap(
  burnTxHash: `0x${string}`,
  fromChain: string,
  toChain: string
): Promise<void> {
  if (inFlight.has(burnTxHash)) return;
  inFlight.add(burnTxHash);
  try {
    const source = LEGS[fromChain];
    const dest = LEGS[toChain];
    if (!source || !dest) throw new Error(`unknown route ${fromChain} → ${toChain}`);

    // Stellar is non-EVM (Soroban) — no viem chain/publicClient/wallet
    // applies to it at all, so it gets its own, entirely separate relay
    // path (two Soroban contract calls instead of one EVM tx). See
    // DEPLOYMENTS.md #15 and scripts/stellar-e2e.ts for the reference impl.
    if (dest.isStellar) {
      await relayToStellar(burnTxHash, source, dest);
      return;
    }

    // Some public testnet RPCs (Arc's in particular) rate-limit aggressively.
    // Retry generously so a transient 429 doesn't surface as a swap failure —
    // the transaction itself is usually already broadcast by that point.
    // dest.chain is always defined past this point (the Stellar branch,
    // the only leg without one, already returned above).
    const publicClient = createPublicClient({
      chain: dest.chain!,
      transport: http(dest.rpc, { retryCount: 6, retryDelay: 2000 }),
    });
    const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as `0x${string}`);
    const wallet = createWalletClient({
      account,
      chain: dest.chain!,
      transport: http(dest.rpc, { retryCount: 6, retryDelay: 2000 }),
    });

    // A prior attempt may have broadcast the relay tx and then failed only
    // while *confirming* it (exactly what happened on Arc's rate-limited RPC
    // in production). Check for that before resubmitting — avoids both a
    // wasted duplicate transaction and the guaranteed nonce-reuse revert.
    const existing = await getSwap(burnTxHash);
    if (existing?.relayTxHash) {
      try {
        await publicClient.waitForTransactionReceipt({
          hash: existing.relayTxHash as `0x${string}`,
        });
        await updateSwap(burnTxHash, { status: "COMPLETE" });
        return;
      } catch {
        // Genuinely not confirmed (or the RPC is still down) — fall through
        // and re-derive everything below.
      }
    }

    await updateSwap(burnTxHash, { status: "AWAITING_ATTESTATION" });
    const attestationClient = new AttestationClient(IRIS);
    const { attestation, messageBytes } = await attestationClient.poll(burnTxHash, source.domain, {
      maxAttempts: 90,
      intervalMs: 2000,
    });

    // Burn amount lives in the attested message: 148-byte header + BurnMessageV2
    // body, amount at body offset 68 → absolute bytes 216–248.
    let usdcAmount: number | null = null;
    try {
      usdcAmount = Number(BigInt(`0x${messageBytes.slice(2 + 216 * 2, 2 + 248 * 2)}`));
    } catch {
      // leave null — stats simply won't count this swap's volume
    }

    await updateSwap(burnTxHash, { status: "RELAYING", usdcAmount });

    // Avalanche Fuji's public RPC intermittently misestimates gas for
    // contract-to-contract calls ("exceeds block gas limit" on a call that
    // works fine with an explicit limit) — bypass automatic estimation.
    const gasOverride = dest.dex === "v2" ? { gas: 800_000n } : {};

    try {
      // Arc has no ReceiveAndSwap executor (nothing to swap into — native
      // balance already is USDC), so relay via the plain MessageTransmitter
      // instead of relayAndExecute.
      const relayTxHash = dest.nativeIsUsdc
        ? await wallet.writeContract({
            address: dest.messageTransmitter!,
            abi: MESSAGE_TRANSMITTER_ABI,
            functionName: "receiveMessage",
            args: [messageBytes, attestation],
            ...gasOverride,
          })
        : await wallet.writeContract({
            address: dest.executor!,
            abi: HOOK_EXECUTOR_ABI,
            functionName: "relayAndExecute",
            args: [messageBytes, attestation],
            ...gasOverride,
          });
      // Persist the hash the moment it's known — a receipt-wait failure
      // below (rate limits, RPC hiccups) must not lose track of a
      // transaction that's already broadcast.
      await updateSwap(burnTxHash, { relayTxHash });
      await publicClient.waitForTransactionReceipt({ hash: relayTxHash });
      await updateSwap(burnTxHash, { status: "COMPLETE", relayTxHash });
    } catch (err) {
      // A used nonce means someone else already relayed — that's success.
      if (err instanceof Error && /nonce.*used|used.*nonce/i.test(err.message)) {
        await updateSwap(burnTxHash, { status: "COMPLETE" });
        return;
      }
      throw err;
    }
  } catch (err) {
    await updateSwap(burnTxHash, {
      status: "FAILED",
      error: err instanceof Error ? err.message.slice(0, 500) : "unknown error",
    });
    throw err;
  } finally {
    inFlight.delete(burnTxHash);
  }
}

/**
 * Stellar destination: two permissionless Soroban calls, no user signature
 * beyond the original EVM burn — CctpForwarder.mint_and_forward (Circle's
 * own contract, mints USDC and forwards to swap_and_deliver), then
 * swap_and_deliver.swap_and_deliver (Conduit's own contract, re-parses the
 * same attested message a second time to find the real final recipient,
 * swaps USDC -> XLM on Soroswap, delivers it). This relayer wallet only
 * pays Stellar network fees; it can't redirect funds since the recipient is
 * bound inside the attested message itself, not supplied here.
 */
async function relayToStellar(burnTxHash: `0x${string}`, source: Leg, dest: Leg): Promise<void> {
  const server = new rpc.Server(dest.rpc);
  const relayerKp = Keypair.fromSecret(process.env.STELLAR_RELAYER_SECRET as string);

  // Same resume-after-crash logic as the EVM path, adapted to Soroban's own
  // getTransaction status check instead of viem's waitForTransactionReceipt.
  const existing = await getSwap(burnTxHash);
  if (existing?.relayTxHash) {
    try {
      const tx = await server.getTransaction(existing.relayTxHash);
      if (tx.status === "SUCCESS") {
        await updateSwap(burnTxHash, { status: "COMPLETE" });
        return;
      }
    } catch {
      // Fall through and re-derive everything below.
    }
  }

  await updateSwap(burnTxHash, { status: "AWAITING_ATTESTATION" });
  const attestationClient = new AttestationClient(IRIS);
  const { attestation, messageBytes } = await attestationClient.poll(burnTxHash, source.domain, {
    maxAttempts: 90,
    intervalMs: 2000,
  });

  let usdcAmount: number | null = null;
  try {
    usdcAmount = Number(BigInt(`0x${messageBytes.slice(2 + 216 * 2, 2 + 248 * 2)}`));
  } catch {
    // leave null — stats simply won't count this swap's volume
  }

  await updateSwap(burnTxHash, { status: "RELAYING", usdcAmount });

  const messageBuf = Buffer.from(messageBytes.slice(2), "hex");
  const attestationBuf = Buffer.from(attestation.slice(2), "hex");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function invoke(contractId: string, fn: string, args: any[]) {
    const contract = new Contract(contractId);
    const src = await server.getAccount(relayerKp.publicKey());
    const tx = new TransactionBuilder(src, {
      fee: (Number(BASE_FEE) * 100).toString(),
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call(fn, ...args))
      .setTimeout(60)
      .build();
    const prepared = await server.prepareTransaction(tx);
    prepared.sign(relayerKp);
    const sent = await server.sendTransaction(prepared);
    if (sent.status !== "PENDING") {
      throw new Error(`sendTransaction failed: ${sent.status} ${JSON.stringify(sent.errorResult ?? "")}`);
    }
    // NOT_FOUND can also be transient RPC-indexing lag right after
    // submission, not necessarily a real failure — keep polling through it.
    let final: rpc.Api.GetTransactionResponse = await server.getTransaction(sent.hash);
    for (let i = 0; i < 30 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      final = await server.getTransaction(sent.hash);
    }
    return { hash: sent.hash, final };
  }

  const alreadyHandled = (msg: string) => /already|used.*nonce|nonce.*used|delivered/i.test(msg);

  try {
    const step1 = await invoke(dest.stellarCctpForwarder!, "mint_and_forward", [
      nativeToScVal(messageBuf, { type: "bytes" }),
      nativeToScVal(attestationBuf, { type: "bytes" }),
    ]);
    if (step1.final.status !== "SUCCESS") {
      const detail = JSON.stringify(step1.final).slice(0, 500);
      if (!alreadyHandled(detail)) throw new Error(`mint_and_forward failed: ${detail}`);
    }

    const step2 = await invoke(dest.stellarSwapAndDeliver!, "swap_and_deliver", [
      nativeToScVal(messageBuf, { type: "bytes" }),
      nativeToScVal(1n, { type: "i128" }), // min_out=1: testnet pool, arbitrary price
    ]);
    // Persist the hash the moment it's known, before checking its final
    // status — a status-check failure below must not lose track of a
    // transaction that's already broadcast.
    await updateSwap(burnTxHash, { relayTxHash: step2.hash });
    if (step2.final.status !== "SUCCESS") {
      const detail = JSON.stringify(step2.final).slice(0, 500);
      if (!alreadyHandled(detail)) throw new Error(`swap_and_deliver failed: ${detail}`);
    }
    await updateSwap(burnTxHash, { status: "COMPLETE", relayTxHash: step2.hash });
  } catch (err) {
    if (err instanceof Error && alreadyHandled(err.message)) {
      await updateSwap(burnTxHash, { status: "COMPLETE" });
      return;
    }
    throw err;
  }
}
