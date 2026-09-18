import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PlatformStats, SwapRow, UpdatableSwapFields } from "./db";

export function createSqliteStore() {
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
    assetMode TEXT NOT NULL DEFAULT 'swap',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`);

  // Migration for rows created before volume tracking.
  try {
    db.exec(`ALTER TABLE swaps ADD COLUMN usdcAmount INTEGER`);
  } catch {
    // column already exists
  }

  // Migration for rows created before raw-USDC mode.
  try {
    db.exec(`ALTER TABLE swaps ADD COLUMN assetMode TEXT NOT NULL DEFAULT 'swap'`);
  } catch {
    // column already exists
  }

  async function insertSwap(
    burnTxHash: string,
    fromChain: string,
    toChain: string,
    assetMode: "swap" | "usdc" = "swap"
  ) {
    db.prepare(
      `INSERT OR IGNORE INTO swaps (burnTxHash, fromChain, toChain, status, assetMode, createdAt, updatedAt)
       VALUES (?, ?, ?, 'RECEIVED', ?, ?, ?)`
    ).run(burnTxHash, fromChain, toChain, assetMode, Date.now(), Date.now());
  }

  const UPDATABLE_COLUMNS = new Set(["status", "relayTxHash", "error", "usdcAmount"]);

  async function updateSwap(burnTxHash: string, fields: UpdatableSwapFields) {
    const sets: string[] = ["updatedAt = ?"];
    const vals: (string | number)[] = [Date.now()];
    for (const [k, v] of Object.entries(fields)) {
      // Column names land in a SQL identifier position, so they are checked
      // against an allowlist rather than trusted. See db-postgres.ts.
      if (!UPDATABLE_COLUMNS.has(k)) throw new Error(`refusing to update unknown column: ${k}`);
      sets.push(`${k} = ?`);
      vals.push(v as string);
    }
    vals.push(burnTxHash);
    db.prepare(`UPDATE swaps SET ${sets.join(", ")} WHERE burnTxHash = ?`).run(...vals);
  }

  async function getSwap(burnTxHash: string): Promise<SwapRow | undefined> {
    return db.prepare(`SELECT * FROM swaps WHERE burnTxHash = ?`).get(burnTxHash) as
      | SwapRow
      | undefined;
  }

  async function getAllSwaps(limit = 50): Promise<SwapRow[]> {
    return db
      .prepare(`SELECT * FROM swaps ORDER BY createdAt DESC LIMIT ?`)
      .all(limit) as SwapRow[];
  }

  async function getStats(): Promise<PlatformStats> {
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

  return { insertSwap, updateSwap, getSwap, getAllSwaps, getStats };
}
