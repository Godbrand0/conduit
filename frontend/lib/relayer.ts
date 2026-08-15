import { AttestationClient, HOOK_EXECUTOR_ABI, MESSAGE_TRANSMITTER_ABI } from "@cctp-sdk/core";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LEGS } from "./legs";
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

    // Some public testnet RPCs (Arc's in particular) rate-limit aggressively.
    // Retry generously so a transient 429 doesn't surface as a swap failure —
    // the transaction itself is usually already broadcast by that point.
    const publicClient = createPublicClient({
      chain: dest.chain,
      transport: http(dest.rpc, { retryCount: 6, retryDelay: 2000 }),
    });
    const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as `0x${string}`);
    const wallet = createWalletClient({
      account,
      chain: dest.chain,
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
