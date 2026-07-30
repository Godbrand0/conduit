"use client";

import { useEffect } from "react";
import { X, ArrowRight } from "lucide-react";
import type { SwapRow } from "@/lib/db";
import { LEGS } from "@/lib/legs";
import { ChainIcon } from "./ChainSelector";
import { StatusBadge } from "./StatusBadge";

// Mirrors SwapAndBurn.sol's FEE_BPS — the stored usdcAmount is what's actually
// burned (post-fee), so the pre-fee amount and fee are derived, not stored.
const CONDUIT_FEE_BPS = 5;

interface SwapDetailsModalProps {
  swap: SwapRow;
  onClose: () => void;
  onTrack?: () => void;
}

const fmtUsdc = (micro: number) =>
  (micro / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{children}</span>
    </div>
  );
}

export function SwapDetailsModal({ swap, onClose, onTrack }: SwapDetailsModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const source = LEGS[swap.fromChain] ?? { label: swap.fromChain, short: swap.fromChain, explorer: "" };
  const dest = LEGS[swap.toChain] ?? { label: swap.toChain, short: swap.toChain, explorer: "" };

  const burned = swap.usdcAmount;
  const preFee = burned !== null ? burned / (1 - CONDUIT_FEE_BPS / 10_000) : null;
  const conduitFee = burned !== null && preFee !== null ? preFee - burned : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[var(--card)] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ChainIcon chainKey={swap.fromChain} size={22} />
            <span className="text-sm font-semibold text-slate-100">{source.short}</span>
            <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
            <ChainIcon chainKey={swap.toChain} size={22} />
            <span className="text-sm font-semibold text-slate-100">{dest.short}</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Status + amount */}
        <div className="flex items-center justify-between px-5 pt-4">
          <StatusBadge status={swap.status} />
          <span className="text-xs text-slate-500">{fmtDate(swap.createdAt)}</span>
        </div>

        <div className="px-5 pt-3">
          <p className="text-2xl font-semibold tracking-tight text-white [font-variant-numeric:tabular-nums]">
            {burned !== null ? `${fmtUsdc(burned)} USDC` : "—"}
          </p>
          <p className="text-xs text-slate-500">bridged via CCTP V2 burn-and-mint</p>
        </div>

        {/* Details */}
        <div className="mt-3 divide-y divide-white/5 border-t border-white/5 px-5">
          <Row label="Route">
            {source.label} → {dest.label}
          </Row>
          {preFee !== null && (
            <Row label="Amount before Conduit fee">{fmtUsdc(preFee)} USDC</Row>
          )}
          {conduitFee !== null && (
            <Row label={`Conduit fee (${CONDUIT_FEE_BPS / 100}%)`}>
              {fmtUsdc(conduitFee)} USDC
            </Row>
          )}
          <Row label="Circle fast transfer fee">deducted before mint</Row>
          <Row label="Created">{fmtDate(swap.createdAt)}</Row>
          <Row label="Last updated">{fmtDate(swap.updatedAt)}</Row>
        </div>

        {/* Transactions */}
        <div className="space-y-2 border-t border-white/5 px-5 py-4">
          <a
            href={`${source.explorer}/tx/${swap.burnTxHash}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-lg border border-white/5 bg-[var(--card-inset)] px-3 py-2.5 text-xs transition-colors hover:border-white/10"
          >
            <span className="text-slate-500">Burn tx · {source.short}</span>
            <span className="font-mono text-cyan-400">
              {swap.burnTxHash.slice(0, 10)}…{swap.burnTxHash.slice(-8)} ↗
            </span>
          </a>
          {swap.relayTxHash ? (
            <a
              href={`${dest.explorer}/tx/${swap.relayTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-lg border border-white/5 bg-[var(--card-inset)] px-3 py-2.5 text-xs transition-colors hover:border-white/10"
            >
              <span className="text-slate-500">Relay tx · {dest.short}</span>
              <span className="font-mono text-cyan-400">
                {swap.relayTxHash.slice(0, 10)}…{swap.relayTxHash.slice(-8)} ↗
              </span>
            </a>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-white/5 bg-[var(--card-inset)] px-3 py-2.5 text-xs">
              <span className="text-slate-500">Relay tx · {dest.short}</span>
              <span className="text-slate-600">pending</span>
            </div>
          )}
        </div>

        {swap.error && (
          <div className="mx-5 mb-4 rounded-lg border border-rose-500/20 bg-rose-950/30 px-3 py-2.5 text-xs text-rose-400">
            {swap.error}
          </div>
        )}

        {onTrack && swap.status !== "COMPLETE" && swap.status !== "FAILED" && (
          <div className="border-t border-white/5 px-5 py-4">
            <button
              onClick={onTrack}
              className="w-full rounded-xl bg-cyan-400 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-cyan-300"
            >
              View live status
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
