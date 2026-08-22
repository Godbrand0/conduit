"use client";

import { useState } from "react";
import { ArrowDownUp, ChevronDown, Zap, AlertTriangle, Wallet } from "lucide-react";
import { formatEther, formatUnits } from "viem";
import { LEGS, LEG_KEYS } from "@/lib/legs";
import type { Quote } from "@/app/hooks/useSwap";
import { isValidStellarRecipient } from "@/app/hooks/useSwap";
import type { useStellarWallet } from "@/app/hooks/useStellarWallet";
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
  quote: Quote;
  balance: bigint | null;
  onSwap: () => void;
  signing: boolean;
  busy: boolean;
  isConnected: boolean;
  error: string | null;
  stellarRecipient: string;
  setStellarRecipient: (v: string) => void;
  /** Progress text during the Stellar-source multi-signature sequence
   *  (e.g. "2 of 3: Swap XLM → USDC…"), null outside that flow. */
  stellarSourceStep: string | null;
  /** Stellar wallet connection (Stellar Wallets Kit), separate from wagmi's
   *  EVM connection — only relevant/shown when Stellar is the source. */
  stellarWallet: ReturnType<typeof useStellarWallet>;
}

const fmtEth = (wei: bigint, digits = 6) =>
  Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: digits });

const fmtUsdc = (micro: bigint, digits = 4) =>
  Number(formatUnits(micro, 6)).toLocaleString(undefined, { maximumFractionDigits: digits });

const unitFor = (chainKey: string) => {
  const leg = LEGS[chainKey];
  if (!leg) return "ETH";
  if (leg.isStellar) return "XLM";
  return leg.nativeIsUsdc ? "USDC" : leg.chain!.nativeCurrency.symbol;
};

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
  quote,
  balance,
  onSwap,
  signing,
  busy,
  isConnected,
  error,
  stellarRecipient,
  setStellarRecipient,
  stellarSourceStep,
  stellarWallet,
}: SwapCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const source = LEGS[from];
  const dest = LEGS[to];
  const needsStellarRecipient = !!dest.isStellar;
  const stellarRecipientValid = !needsStellarRecipient || isValidStellarRecipient(stellarRecipient);
  const needsStellarWallet = !!source.isStellar;
  // Stellar-as-source needs BOTH wallets: the Stellar one to sign the burn,
  // and an EVM one since the destination is always an EVM chain whose
  // connected address is the implicit recipient (same as every other
  // route — there's no separate "EVM recipient" field anywhere in this app).
  const readyToSwap = needsStellarWallet ? isConnected && !!stellarWallet.address : isConnected;

  // Only computable when the source amount already IS USDC (Arc) — for
  // every other chain the input is a native-token amount, so "how much more
  // native token" would need a second pool round-trip we don't do inline.
  const suggestedMinUsdc =
    quote.tooSmall && source.nativeIsUsdc && quote.circleFeeUsdc !== null
      ? quote.circleFeeUsdc + 1n
      : null;

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
              {balance !== null ? `Balance: ${fmtEth(balance, 4)} ${unitFor(from)}` : " "}
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
                    ? `≈ ${fmtUsdc(usdcEstimate, 2)} USDC before fees`
                    : " "}
              </div>
            </div>
          </div>
        </div>

        {/* Stellar wallet connect — only shown when Stellar is the source,
            since that's the only case that needs a Stellar signature (as a
            destination, Stellar is fully trustless — see the recipient
            field below instead). Independent of wagmi's EVM connection,
            which is still required too (the destination is always EVM). */}
        {needsStellarWallet && (
          <div className="mt-2.5 flex items-center justify-between rounded-xl border border-white/5 bg-[var(--card-inset)] px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Wallet className="h-3.5 w-3.5" />
              <span>Stellar wallet</span>
            </div>
            {stellarWallet.address ? (
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="font-mono text-xs text-slate-300">
                  {stellarWallet.address.slice(0, 6)}…{stellarWallet.address.slice(-4)}
                </span>
                <button
                  type="button"
                  onClick={() => stellarWallet.disconnect()}
                  disabled={busy}
                  className="text-xs text-slate-500 transition-colors hover:text-rose-400 disabled:opacity-40"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => stellarWallet.connect()}
                disabled={busy || stellarWallet.connecting}
                className="rounded-lg bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-black transition-all hover:bg-cyan-300 disabled:opacity-40"
              >
                {stellarWallet.connecting ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
        )}

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
              <div className="break-all text-2xl font-semibold tracking-tight text-white [font-variant-numeric:tabular-nums]">
                {quote.tooSmall
                  ? "Too small"
                  : quote.estimate !== null
                    ? `~${fmtEth(quote.estimate)}`
                    : usdcEstimate !== null
                      ? "Fetching quote…"
                      : "…"}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500">
                {quote.tooSmall ? "increase the amount" : `${unitFor(to)} on ${dest.label}`}
              </div>
            </div>
          </div>
          {quote.netUsdc !== null && !quote.tooSmall && (
            <p className="text-right text-xs text-slate-500">
              {fmtUsdc(quote.netUsdc, 4)} USDC net after fees
            </p>
          )}
        </div>

        {/* Stellar recipient — trustless destination, no wallet connection
            needed on that side, just a delivery address the user types in. */}
        {needsStellarRecipient && (
          <div className="mt-3 space-y-1.5">
            <label htmlFor="stellar-recipient" className="text-sm text-slate-400">
              Stellar recipient address
            </label>
            <input
              id="stellar-recipient"
              value={stellarRecipient}
              onChange={(e) => setStellarRecipient(e.target.value.trim())}
              disabled={busy}
              placeholder="G..."
              spellCheck={false}
              className={`w-full rounded-xl border bg-[var(--card-inset)] px-4 py-2.5 font-mono text-sm text-white outline-none placeholder:text-slate-600 disabled:opacity-40 ${
                stellarRecipient && !stellarRecipientValid
                  ? "border-rose-500/40"
                  : "border-white/5 focus:border-cyan-500/40"
              }`}
            />
            {stellarRecipient && !stellarRecipientValid && (
              <p className="text-xs text-rose-400">Not a valid Stellar address (must start with G).</p>
            )}
          </div>
        )}

        {/* Amount-too-small warning */}
        {quote.tooSmall && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-950/30 px-3 py-2.5 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This amount won&apos;t cover the fees on this route
              {quote.circleFeeUsdc !== null && quote.circleFeeUsdc > 0n
                ? ` (Circle fast fee alone is ${fmtUsdc(quote.circleFeeUsdc, 4)} USDC)`
                : ""}
              .{" "}
              {suggestedMinUsdc !== null
                ? `Try at least ${fmtUsdc(suggestedMinUsdc, 4)} USDC.`
                : "Try a larger amount."}
            </span>
          </div>
        )}

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
                <dt className="text-slate-400">Amount before fees</dt>
                <dd className="text-slate-200">
                  {usdcEstimate !== null ? `${fmtUsdc(usdcEstimate)} USDC` : "…"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Conduit fee (0.05%)</dt>
                <dd className="text-slate-200">
                  {quote.conduitFeeUsdc !== null ? `− ${fmtUsdc(quote.conduitFeeUsdc)} USDC` : "…"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Circle fast fee</dt>
                <dd className="text-slate-200">
                  {quote.circleFeeUsdc !== null
                    ? `− ${fmtUsdc(quote.circleFeeUsdc)} USDC`
                    : maxFee !== null
                      ? `≤ ${fmtUsdc(maxFee)} USDC`
                      : "…"}
                </dd>
              </div>
              <div className="flex justify-between border-t border-white/5 pt-2.5">
                <dt className="text-slate-300">Net bridged</dt>
                <dd className="font-medium text-slate-100">
                  {quote.netUsdc !== null ? `${fmtUsdc(quote.netUsdc)} USDC` : "…"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Signatures</dt>
                <dd className="text-slate-200">{needsStellarWallet ? "up to 4 (Stellar wallet)" : 1}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">ETA</dt>
                <dd className="text-cyan-400">{needsStellarWallet ? "~40 seconds" : "~20 seconds"}</dd>
              </div>
            </dl>
          )}
        </div>

        {/* Stellar-source progress — several sequential signatures, unlike
            every other route's single one, so make each step explicit
            rather than leaving the user staring at a generic "Swapping…". */}
        {stellarSourceStep && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-cyan-500/20 bg-cyan-950/20 px-3 py-2.5 text-xs text-cyan-300">
            <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{stellarSourceStep}</span>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={onSwap}
          disabled={
            !readyToSwap || busy || !amount || quote.tooSmall || (needsStellarRecipient && !stellarRecipientValid)
          }
          className="mt-5 w-full rounded-xl bg-cyan-400 py-3.5 font-semibold text-black transition-all hover:bg-cyan-300 active:scale-[0.98] disabled:opacity-40 disabled:hover:bg-cyan-400"
        >
          {signing
            ? "Confirm in wallet…"
            : busy
              ? "Swapping…"
              : quote.tooSmall
                ? "Amount too small"
                : needsStellarRecipient && !stellarRecipientValid
                  ? "Enter a valid Stellar address"
                  : needsStellarWallet && !stellarWallet.address
                    ? "Connect your Stellar wallet"
                    : readyToSwap
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
