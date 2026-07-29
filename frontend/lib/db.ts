import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

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

const dir = path.join(process.cwd(), ".data");
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(path.join(dir, "swaps.db"));

db.exec(`CREATE TABLE IF NOT EXISTS swaps (
  burnTxHash TEXT PRIMARY KEY,
  fromChain TEXT NOT NULL,
  toChain TEXT NOT NULL,
  status TEXT NOT NULL,
  relayTxHash TEXT,
  error TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`);

// Migration for rows created before volume tracking.
try {
  db.exec(`ALTER TABLE swaps ADD COLUMN usdcAmount INTEGER`);
} catch {
  // column already exists
}

export function insertSwap(burnTxHash: string, fromChain: string, toChain: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO swaps (burnTxHash, fromChain, toChain, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'RECEIVED', ?, ?)`
  ).run(burnTxHash, fromChain, toChain, Date.now(), Date.now());
}

export function updateSwap(
  burnTxHash: string,
  fields: Partial<Pick<SwapRow, "status" | "relayTxHash" | "error" | "usdcAmount">>
): void {
  const sets: string[] = ["updatedAt = ?"];
  const vals: (string | number)[] = [Date.now()];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v as string);
  }
  vals.push(burnTxHash);
  db.prepare(`UPDATE swaps SET ${sets.join(", ")} WHERE burnTxHash = ?`).run(...vals);
}

export function getSwap(burnTxHash: string): SwapRow | undefined {
  return db.prepare(`SELECT * FROM swaps WHERE burnTxHash = ?`).get(burnTxHash) as
    | SwapRow
    | undefined;
}

export function getAllSwaps(limit = 50): SwapRow[] {
  return db.prepare(`SELECT * FROM swaps ORDER BY createdAt DESC LIMIT ?`).all(limit) as SwapRow[];
}

export type PlatformStats = {
  totalSwaps: number;
  completedSwaps: number;
  volumeUsdc: number; // µUSDC, completed swaps only
  routes: { fromChain: string; toChain: string; count: number; volumeUsdc: number }[];
};

export function getStats(): PlatformStats {
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'COMPLETE' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'COMPLETE' THEN COALESCE(usdcAmount, 0) ELSE 0 END) AS volume
       FROM swaps`
    )
    .get() as { total: number; completed: number | null; volume: number | null };

  const routes = db
    .prepare(
      `SELECT fromChain, toChain, COUNT(*) AS count,
              SUM(CASE WHEN status = 'COMPLETE' THEN COALESCE(usdcAmount, 0) ELSE 0 END) AS volumeUsdc
       FROM swaps GROUP BY fromChain, toChain ORDER BY count DESC`
    )
    .all() as { fromChain: string; toChain: string; count: number; volumeUsdc: number }[];

  return {
    totalSwaps: totals.total,
    completedSwaps: totals.completed ?? 0,
    volumeUsdc: totals.volume ?? 0,
    routes,
  };
}

