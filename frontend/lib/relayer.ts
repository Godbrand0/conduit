import { AttestationClient, HOOK_EXECUTOR_ABI, MESSAGE_TRANSMITTER_ABI } from "@cctp-sdk/core";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LEGS } from "./legs";
import { updateSwap } from "./db";

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
    const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as `0x${string}`);
    const wallet = createWalletClient({ account, chain: dest.chain, transport: http(dest.rpc) });
    const publicClient = createPublicClient({ chain: dest.chain, transport: http(dest.rpc) });

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
          })
        : await wallet.writeContract({
            address: dest.executor!,
            abi: HOOK_EXECUTOR_ABI,
            functionName: "relayAndExecute",
            args: [messageBytes, attestation],
          });
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
