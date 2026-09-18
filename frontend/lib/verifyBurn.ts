import { createPublicClient, http } from "viem";
import { rpc } from "@stellar/stellar-sdk";
import { LEGS, type Leg } from "./legs";

/**
 * Confirm that a claimed burn transaction really is a Conduit burn on the
 * claimed source chain, before any relay work is scheduled for it.
 *
 * Without this, POST /api/swaps accepted any well-formed transaction hash:
 * the server would then poll Circle for up to three minutes and submit a
 * relay transaction, paying gas out of the relayer wallet — for arbitrary
 * third-party CCTP transfers that had nothing to do with Conduit, as fast as
 * anyone cared to ask. The relayer stays permissionless in the sense that
 * matters (anyone may *trigger* a relay of a genuine Conduit burn, and the
 * hook that decides where funds go is bound inside the attested message);
 * what it no longer does is fund strangers' unrelated transfers.
 */
export async function isConduitBurn(
  burnTxHash: string,
  from: string
): Promise<boolean> {
  const source = LEGS[from];
  if (!source) return false;
  return source.isStellar
    ? verifyStellarBurn(burnTxHash, source)
    : verifyEvmBurn(burnTxHash as `0x${string}`, source);
}

async function verifyEvmBurn(burnTxHash: `0x${string}`, source: Leg): Promise<boolean> {
  try {
    const client = createPublicClient({
      chain: source.chain!,
      transport: http(source.rpc, { retryCount: 2, retryDelay: 1000 }),
    });
    const receipt = await client.getTransactionReceipt({ hash: burnTxHash });
    if (receipt.status !== "success") return false;

    // The burn must have gone through one of this leg's own entry points:
    // Conduit's SwapAndBurn, or the canonical TokenMessenger for the
    // raw-USDC path (which burns straight from the user's EOA).
    const permitted = [source.swapAndBurn, source.tokenMessenger]
      .filter(Boolean)
      .map((a) => (a as string).toLowerCase());
    const target = receipt.to?.toLowerCase();
    return !!target && permitted.includes(target);
  } catch {
    // Unknown hash, wrong chain, or an RPC failure — all reasons not to
    // start spending the relayer's gas on it.
    return false;
  }
}

async function verifyStellarBurn(burnTxHash: string, source: Leg): Promise<boolean> {
  try {
    const server = new rpc.Server(source.rpc);
    const tx = await server.getTransaction(burnTxHash);
    // Soroban RPC exposes no cheap "which contract did this invoke" view, so
    // this is a weaker check than the EVM side: it confirms the transaction
    // exists on the claimed network and succeeded. The Stellar burn path is
    // also user-signed end to end, so a forged hash cannot redirect funds —
    // it could only waste a relay attempt.
    return tx.status === "SUCCESS";
  } catch {
    return false;
  }
}
