"use client";

import { useEffect, useState } from "react";
import type { SwapRow } from "@/lib/db";
import { LEGS } from "@/lib/legs";
import { StatusBadge } from "./StatusBadge";
import { SwapDetailsModal } from "./SwapDetailsModal";

interface HistoryViewProps {
  onSelectSwap?: (burnTxHash: string, fromChain: string, toChain: string) => void;
}

export function HistoryView({ onSelectSwap }: HistoryViewProps) {
  const [swaps, setSwaps] = useState<SwapRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SwapRow | null>(null);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/swaps/history");
      if (res.ok) {
        const data = await res.json();
        setSwaps(data.swaps || []);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    const interval = setInterval(fetchHistory, 5000);
    return () => clearInterval(interval);
  }, []);

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-100">Swap Transactions</h2>
          <p className="text-xs text-slate-400 mt-0.5">Real-time status of cross-chain native swaps processed by CCTP</p>
        </div>
        <button
          onClick={fetchHistory}
          className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-700 hover:text-white transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M8 16H3v5" />
          </svg>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 w-full animate-pulse rounded-2xl border border-slate-800/60 bg-slate-900/40" />
          ))}
        </div>
      ) : swaps.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-slate-500 mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-slate-300">No Swap History Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            Initiate a native cross-chain swap to monitor transaction progress and attestation records here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {swaps.map((swap) => {
            const source = LEGS[swap.fromChain] || { label: swap.fromChain, explorer: "" };
            const dest = LEGS[swap.toChain] || { label: swap.toChain, explorer: "" };

            return (
              <div
                key={swap.burnTxHash}
                onClick={() => setSelected(swap)}
                className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-white/5 bg-[var(--card)] p-4 transition-all hover:border-white/10 hover:bg-[var(--card-hover)] cursor-pointer shadow-sm"
              >
                {/* Left side: Route & Hash */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <span>{source.label}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-cyan-400">
                      <path d="M5 12h14" />
                      <path d="m12 5 7 7-7 7" />
                    </svg>
                    <span>{dest.label}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 font-mono">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-500">Burn:</span>
                      <a
                        href={`${source.explorer}/tx/${swap.burnTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-cyan-400 hover:underline"
                      >
                        {swap.burnTxHash.slice(0, 8)}…{swap.burnTxHash.slice(-6)}
                      </a>
                    </div>
                    {swap.relayTxHash && (
                      <div className="flex items-center gap-1">
                        <span className="text-slate-500">Relay:</span>
                        <a
                          href={`${dest.explorer}/tx/${swap.relayTxHash}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-cyan-400 hover:underline"
                        >
                          {swap.relayTxHash.slice(0, 8)}…{swap.relayTxHash.slice(-6)}
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side: Status badge & timestamp */}
                <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2">
                  <StatusBadge status={swap.status} />
                  <span className="text-[11px] font-mono text-slate-500">
                    {formatDate(swap.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <SwapDetailsModal
          swap={selected}
          onClose={() => setSelected(null)}
          onTrack={
            onSelectSwap
              ? () => {
                  onSelectSwap(selected.burnTxHash, selected.fromChain, selected.toChain);
                  setSelected(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
