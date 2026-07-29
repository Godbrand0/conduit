export type SwapStatus =
  | "RECEIVED"
  | "AWAITING_ATTESTATION"
  | "RELAYING"
  | "COMPLETE"
  | "FAILED";

export type SwapRow = {
  burnTxHash: string;
  fromChain: string;
  toChain: string;
  status: SwapStatus;
  relayTxHash: string | null;
  error: string | null;
  /** USDC burned, in µUSDC — decoded from the attested CCTP message */
  usdcAmount: number | null;
  createdAt: number;
  updatedAt: number;
};

export type PlatformStats = {
  totalSwaps: number;
  completedSwaps: number;
  volumeUsdc: number; // µUSDC, completed swaps only
  routes: { fromChain: string; toChain: string; count: number; volumeUsdc: number }[];
};

export type UpdatableSwapFields = Partial<
  Pick<SwapRow, "status" | "relayTxHash" | "error" | "usdcAmount">
>;

interface SwapStore {
  insertSwap(burnTxHash: string, fromChain: string, toChain: string): Promise<void>;
  updateSwap(burnTxHash: string, fields: UpdatableSwapFields): Promise<void>;
  getSwap(burnTxHash: string): Promise<SwapRow | undefined>;
  getAllSwaps(limit?: number): Promise<SwapRow[]>;
  getStats(): Promise<PlatformStats>;
}

/**
 * Vercel's filesystem is ephemeral, so SQLite can't back the store there —
 * DATABASE_URL (a pooled Postgres connection, e.g. from Neon/Supabase)
 * selects the Postgres-backed store; local dev without it falls back to a
 * SQLite file so no setup is needed to run the app.
 */
const store: SwapStore = process.env.DATABASE_URL
  ? await import("./db-postgres").then((m) => m.createPostgresStore())
  : await import("./db-sqlite").then((m) => m.createSqliteStore());

export const insertSwap = store.insertSwap;
export const updateSwap = store.updateSwap;
export const getSwap = store.getSwap;
export const getAllSwaps = store.getAllSwaps;
export const getStats = store.getStats;
