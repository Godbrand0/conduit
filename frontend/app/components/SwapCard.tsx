"use client";

import { useState } from "react";
import { ArrowDownUp, ChevronDown, Zap } from "lucide-react";
import { formatEther, formatUnits } from "viem";
import { LEGS } from "@/lib/legs";
import { ChainSelector } from "./ChainSelector";

interface SwapCardProps {
  from: string;
  to: string;
  amount: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  setAmount: (v: string) => void;
  reverse: () => void;
  maxFee: bigint | null;
  usdcEstimate: bigint | null;
  receiveEstimate: bigint | null;
  balance: bigint | null;
  onSwap: () => void;
  signing: boolean;
  busy: boolean;
  isConnected: boolean;
  error: string | null;
}

const fmtEth = (wei: bigint, digits = 5) =>
  Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: digits });

const unitFor = (chainKey: string) => (LEGS[chainKey]?.nativeIsUsdc ? "USDC" : "ETH");

export function SwapCard({
  from,
  to,
  amount,
  setFrom,
  setTo,
  setAmount,
  reverse,
  maxFee,
  usdcEstimate,
  receiveEstimate,
  balance,
  onSwap,
  signing,
  busy,
  isConnected,
  error,
}: SwapCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const source = LEGS[from];
  const dest = LEGS[to];

  return (
    <div className="w-full">
      {/* Header badges */}
      <div className="mb-4 flex items-center justify-between px-1">
        <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-xs text-amber-400/90">
          Testnet
        </span>
      </div>

      <div className="rounded-2xl border border-white/5 bg-[var(--card)] p-5 shadow-2xl shadow-black/40">
        {/* From */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>From</span>
            <button
              type="button"
              onClick={() => balance !== null && setAmount(formatEther((balance * 95n) / 100n))}
              className="text-xs text-slate-500 transition-colors hover:text-cyan-400"
              title="Use ~95% of balance (reserves gas)"
            >
              {balance !== null ? `Balance: ${fmtEth(balance, 4)} ${unitFor(from)}` : " "}
            </button>
          </div>
          <div className="flex gap-3">
            <ChainSelector value={from} exclude={to} onChange={setFrom} disabled={busy} />
            <div className="min-w-0 flex-1 rounded-xl border border-white/5 bg-[var(--card-inset)] px-4 py-2">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.0"
                className="w-full bg-transparent text-2xl font-semibold tracking-tight text-white outline-none placeholder:text-slate-600 [font-variant-numeric:tabular-nums]"
              />
              <div className="mt-0.5 truncate text-xs text-slate-500">
                {source.nativeIsUsdc
                  ? "native USDC — no swap needed"
                  : usdcEstimate !== null
                    ? `≈ ${Number(formatUnits(usdcEstimate, 6)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC before fees`
                    : " "}
              </div>
            </div>
          </div>
        </div>

        {/* Direction */}
        <div className="relative z-10 my-1 flex h-12 items-center justify-center">
          <button
            type="button"
            onClick={reverse}
            disabled={busy}
            title="Reverse route"
            aria-label="Reverse route"
            className="rounded-xl border border-white/10 bg-[var(--card-hover)] p-2.5 transition-all hover:scale-105 hover:border-cyan-500/40 disabled:opacity-40"
          >
            <ArrowDownUp className="h-4 w-4 text-slate-300" />
          </button>
        </div>

        {/* To */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>To</span>
            <span className="text-xs">You will receive</span>
          </div>
          <div className="flex gap-3">
            <ChainSelector value={to} exclude={from} onChange={setTo} disabled={busy} />
            <div className="min-w-0 flex-1 rounded-xl border border-white/5 bg-[var(--card-inset)] px-4 py-2">
              <div className="truncate text-2xl font-semibold tracking-tight text-white [font-variant-numeric:tabular-nums]">
                {receiveEstimate !== null ? `~${fmtEth(receiveEstimate)}` : "…"}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500">{unitFor(to)} on {dest.label}</div>
            </div>
          </div>
        </div>

        {/* Route + fees (collapsible) */}
        <div className="mt-5 border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            className="flex w-full items-center justify-between text-sm text-slate-400 transition-colors hover:text-slate-200"
          >
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-cyan-400" />
              <span>Details · ~20s · 0.05% fee</span>
            </div>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showDetails ? "rotate-180" : ""}`}
            />
          </button>

          {showDetails && (
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-400">Circle fast fee</dt>
                <dd className="text-slate-200">
                  {maxFee !== null ? `≤ ${formatUnits(maxFee, 6)} USDC` : "…"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Conduit fee</dt>
                <dd className="text-slate-200">0.05%</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Signatures</dt>
                <dd className="text-slate-200">1</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">ETA</dt>
                <dd className="text-cyan-400">~20 seconds</dd>
              </div>
            </dl>
          )}
        </div>

        {/* CTA */}
        <button
          onClick={onSwap}
          disabled={!isConnected || busy || !amount}
          className="mt-5 w-full rounded-xl bg-cyan-400 py-3.5 font-semibold text-black transition-all hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-cyan-400"
        >
          {signing
            ? "Confirm in wallet…"
            : busy
              ? "Swapping…"
              : isConnected
                ? "Swap"
                : "Connect wallet to swap"}
        </button>

        {error && (
          <p className="mt-3 whitespace-pre-line break-words text-xs text-rose-400">{error}</p>
        )}
      </div>
    </div>
  );
}
