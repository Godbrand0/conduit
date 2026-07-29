"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { LEGS, LEG_KEYS } from "@/lib/legs";

/** Chain logo hotlinked from TrustWallet's assets repo, keyed by chain slug
 * (matches our leg keys). Falls back to a brand-colored monogram if the image
 * fails. (DefiLlama's CDN serves blank placeholders for base/ethereum.) */
export function ChainIcon({ chainKey, size = 24 }: { chainKey: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const leg = LEGS[chainKey];

  if (failed || !leg) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
        style={{
          width: size,
          height: size,
          backgroundColor: leg?.color ?? "#334155",
          fontSize: size * 0.45,
        }}
        aria-hidden
      >
        {leg?.short?.[0] ?? "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${leg.key}/info/logo.png`}
      alt={leg.short}
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      onError={() => setFailed(true)}
    />
  );
}

interface ChainSelectorProps {
  value: string;
  exclude?: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}

export function ChainSelector({ value, exclude, onChange, disabled }: ChainSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const leg = LEGS[value];

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative w-36 shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-[var(--card-inset)] px-3 py-3 transition-colors hover:border-white/10 disabled:opacity-40"
      >
        <ChainIcon chainKey={value} />
        <span className="truncate text-sm font-medium text-slate-100">{leg.short}</span>
        <ChevronDown
          className={`ml-auto h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-52 rounded-xl border border-white/10 bg-[var(--card-hover)] p-1.5 shadow-2xl shadow-black/60">
          {LEG_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              disabled={k === exclude}
              onClick={() => {
                onChange(k);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                k === value
                  ? "bg-white/5 text-cyan-400"
                  : k === exclude
                    ? "cursor-not-allowed text-slate-600"
                    : "text-slate-200 hover:bg-white/5"
              }`}
            >
              <ChainIcon chainKey={k} size={20} />
              {LEGS[k].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
