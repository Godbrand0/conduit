import type { SwapRow } from "./db";

/**
 * The client-safe projection of a swap row.
 *
 * Raw relayer errors used to be persisted verbatim (500 chars of whatever
 * viem/Soroban RPC produced) and handed straight to the browser, which
 * leaked RPC endpoints, contract addresses and internal state to anyone who
 * asked. The full string is still stored for operators to read; what leaves
 * the server is a short category.
 */
export type PublicSwapRow = Omit<SwapRow, "error"> & { error: string | null };

export function toPublicSwap(row: SwapRow): PublicSwapRow {
  return { ...row, error: publicError(row.error) };
}

function publicError(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw.toLowerCase();

  if (/attestation|iris|poll/.test(text)) {
    return "Circle has not attested this transfer yet.";
  }
  if (/insufficient funds|gas required|out of gas/.test(text)) {
    return "The relayer could not pay for the destination transaction.";
  }
  if (/slippage|too little received|amountoutmin/.test(text)) {
    return "The destination price moved past the slippage limit; USDC was refunded instead.";
  }
  if (/rate limit|429|timeout|econn|fetch failed|network/.test(text)) {
    return "A network or RPC problem interrupted the relay.";
  }
  if (/nonce/.test(text)) {
    return "This transfer was already relayed.";
  }
  return "The relay failed and will be retried automatically.";
}
