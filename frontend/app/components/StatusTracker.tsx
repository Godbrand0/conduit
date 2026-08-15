"use client";

import type { SwapRow } from "@/lib/db";
import type { SwapStep } from "@/app/hooks/useSwap";

interface StatusTrackerProps {
  steps: SwapStep[];
  serverSwap: SwapRow | null;
  destLabel: string;
  /** "USDC" on Arc, or the destination chain's native currency symbol
   *  (ETH, AVAX, …) everywhere else. */
  destUnit: string;
}

export function StatusTracker({ steps, serverSwap, destLabel, destUnit }: StatusTrackerProps) {
  return (
    <div className="mt-5 space-y-3 rounded-2xl border border-white/5 bg-[var(--card)] p-5 shadow-2xl shadow-black/40">
      {steps.map((s) => (
        <div key={s.label} className="flex items-center gap-3 text-sm">
          <span
            className={
              s.done
                ? "text-emerald-400"
                : s.active
                  ? "animate-pulse text-cyan-400"
                  : "text-slate-600"
            }
          >
            {s.done ? "✅" : s.active ? "◉" : "○"}
          </span>
          <span className={s.done ? "text-slate-200" : "text-slate-400"}>{s.label}</span>
          {s.link && (
            <a
              href={s.link}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-cyan-400 hover:underline"
            >
              tx ↗
            </a>
          )}
        </div>
      ))}
      {serverSwap?.status === "COMPLETE" && (
        <p className="pt-1 text-sm text-emerald-400">
          Native {destUnit} delivered on {destLabel}. You can close this tab
          any time — the relayer finishes without you.
        </p>
      )}
      {serverSwap?.status === "FAILED" && (
        <p className="break-all text-xs text-rose-400">
          Relay failed: {serverSwap.error} — it will be retried automatically.
        </p>
      )}
    </div>
  );
}
