import { Pool } from "pg";
import type { PlatformStats, SwapRow, UpdatableSwapFields } from "./db";

export async function createPostgresStore() {
  // Verify the database server's certificate by default. Neon/Supabase
  // connection snippets commonly suggest rejectUnauthorized:false, and this
  // used to follow that — but it accepts *any* certificate, leaving the
  // connection encrypted yet unauthenticated and open to anyone on the
  // network path. Providers whose chain isn't in Node's default trust store
  // should supply their CA via DATABASE_CA_CERT rather than disabling the
  // check. DATABASE_SSL_NO_VERIFY remains as a deliberate, visible escape
  // hatch for local development only.
  const ssl = process.env.DATABASE_SSL_NO_VERIFY === "true"
    ? { rejectUnauthorized: false }
    : process.env.DATABASE_CA_CERT
      ? { rejectUnauthorized: true, ca: process.env.DATABASE_CA_CERT }
      : { rejectUnauthorized: true };

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl,
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS swaps (
    "burnTxHash" TEXT PRIMARY KEY,
    "fromChain" TEXT NOT NULL,
    "toChain" TEXT NOT NULL,
    status TEXT NOT NULL,
    "relayTxHash" TEXT,
    error TEXT,
    "usdcAmount" BIGINT,
    "assetMode" TEXT NOT NULL DEFAULT 'swap',
    "createdAt" BIGINT NOT NULL,
    "updatedAt" BIGINT NOT NULL
  )`);

  // Migration for rows created before raw-USDC mode.
  await pool.query(`ALTER TABLE swaps ADD COLUMN IF NOT EXISTS "assetMode" TEXT NOT NULL DEFAULT 'swap'`);

  function rowOut(r: Record<string, unknown>): SwapRow {
    return {
      burnTxHash: r.burnTxHash as string,
      fromChain: r.fromChain as string,
      toChain: r.toChain as string,
      status: r.status as SwapRow["status"],
      relayTxHash: (r.relayTxHash as string) ?? null,
      error: (r.error as string) ?? null,
      usdcAmount: r.usdcAmount !== null ? Number(r.usdcAmount) : null,
      assetMode: (r.assetMode as SwapRow["assetMode"]) ?? "swap",
      createdAt: Number(r.createdAt),
      updatedAt: Number(r.updatedAt),
    };
  }

  async function insertSwap(
    burnTxHash: string,
    fromChain: string,
    toChain: string,
    assetMode: "swap" | "usdc" = "swap"
  ) {
    const now = Date.now();
    await pool.query(
      `INSERT INTO swaps ("burnTxHash", "fromChain", "toChain", status, "assetMode", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'RECEIVED', $4, $5, $5)
       ON CONFLICT ("burnTxHash") DO NOTHING`,
      [burnTxHash, fromChain, toChain, assetMode, now]
    );
  }

  // Column names are interpolated into the UPDATE below, so they are checked
  // against this allowlist first. Every current caller passes literal keys,
  // but nothing in the type system stops a future one from forwarding
  // user-controlled object keys into a SQL identifier position.
  const UPDATABLE_COLUMNS = new Set(["status", "relayTxHash", "error", "usdcAmount"]);

  async function updateSwap(burnTxHash: string, fields: UpdatableSwapFields) {
    const cols = Object.keys(fields);
    for (const col of cols) {
      if (!UPDATABLE_COLUMNS.has(col)) throw new Error(`refusing to update unknown column: ${col}`);
    }
    const sets = cols.map((c, i) => `"${c}" = $${i + 2}`);
    sets.push(`"updatedAt" = $${cols.length + 2}`);
    const vals = cols.map((c) => fields[c as keyof UpdatableSwapFields]);
    await pool.query(
      `UPDATE swaps SET ${sets.join(", ")} WHERE "burnTxHash" = $1`,
      [burnTxHash, ...vals, Date.now()]
    );
  }

  async function getSwap(burnTxHash: string): Promise<SwapRow | undefined> {
    const res = await pool.query(`SELECT * FROM swaps WHERE "burnTxHash" = $1`, [burnTxHash]);
    return res.rows[0] ? rowOut(res.rows[0]) : undefined;
  }

  async function getAllSwaps(limit = 50): Promise<SwapRow[]> {
    const res = await pool.query(
      `SELECT * FROM swaps ORDER BY "createdAt" DESC LIMIT $1`,
      [limit]
    );
    return res.rows.map(rowOut);
  }

  async function getStats(): Promise<PlatformStats> {
    const totalsRes = await pool.query(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN status = 'COMPLETE' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status = 'COMPLETE' THEN COALESCE("usdcAmount", 0) ELSE 0 END) AS volume
      FROM swaps
    `);
    const t = totalsRes.rows[0];

    const routesRes = await pool.query(`
      SELECT "fromChain", "toChain", COUNT(*) AS count,
             SUM(CASE WHEN status = 'COMPLETE' THEN COALESCE("usdcAmount", 0) ELSE 0 END) AS "volumeUsdc"
      FROM swaps GROUP BY "fromChain", "toChain" ORDER BY count DESC
    `);

    return {
      totalSwaps: Number(t.total),
      completedSwaps: Number(t.completed ?? 0),
      volumeUsdc: Number(t.volume ?? 0),
      routes: routesRes.rows.map((r) => ({
        fromChain: r.fromChain as string,
        toChain: r.toChain as string,
        count: Number(r.count),
        volumeUsdc: Number(r.volumeUsdc),
      })),
    };
  }

  return { insertSwap, updateSwap, getSwap, getAllSwaps, getStats };
}
