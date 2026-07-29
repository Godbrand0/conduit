import Link from "next/link";
import { getStats, getAllSwaps } from "@/lib/db";
import { LEGS } from "@/lib/legs";

export const dynamic = "force-dynamic";

const fmtUsdc = (micro: number) =>
  (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[var(--card)] p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-white [font-variant-numeric:tabular-nums]">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function StatsPage() {
  const stats = getStats();
  const recent = getAllSwaps(10);
  const successRate =
    stats.totalSwaps > 0 ? Math.round((stats.completedSwaps / stats.totalSwaps) * 100) : null;

  return (
    <div className="min-h-screen bg-[var(--background)] text-slate-100">
      <header className="border-b border-white/5">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <h1 className="text-lg font-bold tracking-tight">Conduit · Platform Stats</h1>
          <Link
            href="/"
            className="rounded-lg border border-white/5 bg-[var(--card)] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-white/10 hover:text-white"
          >
            ← Back to swap
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6">
        {/* Headline numbers */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Total volume"
            value={`${fmtUsdc(stats.volumeUsdc)} USDC`}
            sub="settled through CCTP burn-and-mint"
          />
          <StatTile
            label="Swaps"
            value={String(stats.totalSwaps)}
            sub={`${stats.completedSwaps} completed`}
          />
          <StatTile
            label="Success rate"
            value={successRate !== null ? `${successRate}%` : "—"}
            sub="completed / initiated"
          />
        </div>

        {/* Per-route breakdown */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Volume by route</h2>
          {stats.routes.length === 0 ? (
            <p className="rounded-2xl border border-white/5 bg-[var(--card)] p-8 text-center text-sm text-slate-500">
              No swaps yet — stats appear after the first swap through the app.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/5 bg-[var(--card)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 font-medium">Route</th>
                    <th className="px-4 py-3 text-right font-medium">Swaps</th>
                    <th className="px-4 py-3 text-right font-medium">Volume (USDC)</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.routes.map((r) => (
                    <tr
                      key={`${r.fromChain}-${r.toChain}`}
                      className="border-b border-white/5 last:border-0"
                    >
                      <td className="px-4 py-3 text-slate-200">
                        {LEGS[r.fromChain]?.label ?? r.fromChain} →{" "}
                        {LEGS[r.toChain]?.label ?? r.toChain}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200 [font-variant-numeric:tabular-nums]">
                        {r.count}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200 [font-variant-numeric:tabular-nums]">
                        {fmtUsdc(r.volumeUsdc)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recent activity */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Recent swaps</h2>
          {recent.length === 0 ? (
            <p className="rounded-2xl border border-white/5 bg-[var(--card)] p-8 text-center text-sm text-slate-500">
              Nothing yet.
            </p>
          ) : (
            <div className="space-y-2">
              {recent.map((s) => (
                <div
                  key={s.burnTxHash}
                  className="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-[var(--card)] px-4 py-3 text-sm"
                >
                  <span className="truncate text-slate-200">
                    {LEGS[s.fromChain]?.short ?? s.fromChain} →{" "}
                    {LEGS[s.toChain]?.short ?? s.toChain}
                  </span>
                  <span className="shrink-0 text-slate-400 [font-variant-numeric:tabular-nums]">
                    {s.usdcAmount !== null ? `${fmtUsdc(s.usdcAmount)} USDC` : "—"}
                  </span>
                  <span
                    className={`shrink-0 text-xs ${
                      s.status === "COMPLETE"
                        ? "text-emerald-400"
                        : s.status === "FAILED"
                          ? "text-rose-400"
                          : "text-amber-400"
                    }`}
                  >
                    {s.status === "COMPLETE"
                      ? "✓ complete"
                      : s.status === "FAILED"
                        ? "✕ failed"
                        : "… in flight"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="text-center text-xs text-slate-600">
          Counts swaps made through this app on testnet. On-chain proofs:{" "}
          <a
            className="underline hover:text-slate-400"
            href="https://github.com/Godbrand0/conduit/blob/main/DEPLOYMENTS.md"
            target="_blank"
            rel="noreferrer"
          >
            DEPLOYMENTS.md
          </a>
        </p>
      </main>
    </div>
  );
}
