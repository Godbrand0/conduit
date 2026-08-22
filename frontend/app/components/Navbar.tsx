"use client";

import React, { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useStellarWallet } from "@/app/hooks/useStellarWallet";

interface NavbarProps {
  activeTab: "swap" | "history";
  setActiveTab: (tab: "swap" | "history") => void;
}

export function Navbar({ activeTab, setActiveTab }: NavbarProps) {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const stellarWallet = useStellarWallet();
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showStellarMenu, setShowStellarMenu] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-800/80 bg-[var(--background)]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Left: Product Name & Branding */}
        <div className="flex items-center gap-8">
          <button
            onClick={() => setActiveTab("swap")}
            className="group flex items-center gap-2.5 text-left focus:outline-none"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-950/40 text-cyan-400 shadow-sm transition-transform duration-200 group-hover:scale-105 group-hover:border-cyan-400">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-bold tracking-tight text-slate-100 text-lg">
                Conduit
              </div>
            </div>
          </button>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 rounded-lg border border-slate-800/80 bg-slate-900/60 p-1">
            <button
              onClick={() => setActiveTab("swap")}
              className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "swap"
                  ? "bg-slate-800 text-cyan-400 shadow-sm border border-slate-700/50"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m16 3 4 4-4 4" />
                <path d="M20 7H4" />
                <path d="m8 21-4-4 4-4" />
                <path d="M4 17h16" />
              </svg>
              Swap
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "history"
                  ? "bg-slate-800 text-cyan-400 shadow-sm border border-slate-700/50"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"
              }`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              History
            </button>
            <a
              href="/stats"
              className="flex items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold text-slate-400 transition-all hover:bg-slate-800/40 hover:text-slate-200"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              Stats
            </a>
          </nav>
        </div>

        {/* Mobile Navigation Pills */}
        <div className="flex md:hidden items-center gap-1 rounded-lg border border-slate-800/80 bg-slate-900/60 p-1">
          <button
            onClick={() => setActiveTab("swap")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              activeTab === "swap"
                ? "bg-slate-800 text-cyan-400"
                : "text-slate-400"
            }`}
          >
            Swap
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-all ${
              activeTab === "history"
                ? "bg-slate-800 text-cyan-400"
                : "text-slate-400"
            }`}
          >
            History
          </button>
        </div>

        {/* Right: Wallet Connect Buttons — EVM (wagmi) and Stellar (Stellar
            Wallets Kit) are independent connections, both shown so the user
            can see/manage each without needing Stellar selected as a route
            first. */}
        <div className="flex items-center gap-2">
        <div className="relative">
          {!mounted ? (
            <div className="h-9 w-32 animate-pulse rounded-xl bg-slate-800/60" />
          ) : isConnected && address ? (
            <div className="relative">
              <button
                onClick={() => setShowWalletMenu(!showWalletMenu)}
                className="flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:bg-slate-800/80 transition-all shadow-sm"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${showWalletMenu ? "rotate-180" : ""}`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {showWalletMenu && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-xl backdrop-blur-lg">
                  <div className="px-3 py-2 border-b border-slate-800/80 mb-1">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Connected Wallet</p>
                    <p className="text-xs font-mono text-slate-300 break-all">{address}</p>
                  </div>
                  <button
                    onClick={() => {
                      disconnect();
                      setShowWalletMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/30 transition-colors"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Disconnect Wallet
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              className="flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 px-4 py-2 text-xs font-bold transition-all shadow-sm active:scale-95"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="6" y1="12" x2="6" y2="12.01" />
                <line x1="18" y1="12" x2="18" y2="12.01" />
              </svg>
              Connect Wallet
            </button>
          )}
        </div>

        {/* Stellar wallet — independent of the EVM connection above. Needed
            whenever Stellar is the SOURCE chain (signs the trustline/swap/
            approve/burn steps); harmless to leave connected otherwise. */}
        <div className="relative">
          {!mounted ? (
            <div className="h-9 w-32 animate-pulse rounded-xl bg-slate-800/60" />
          ) : stellarWallet.address ? (
            <div className="relative">
              <button
                onClick={() => setShowStellarMenu(!showStellarMenu)}
                className="flex items-center gap-2 rounded-xl border border-violet-700/60 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:border-violet-500 hover:bg-slate-800/80 transition-all shadow-sm"
              >
                <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse" />
                <span className="font-mono">
                  {stellarWallet.address.slice(0, 6)}…{stellarWallet.address.slice(-4)}
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${showStellarMenu ? "rotate-180" : ""}`}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {showStellarMenu && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-xl backdrop-blur-lg">
                  <div className="px-3 py-2 border-b border-slate-800/80 mb-1">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">Stellar Wallet</p>
                    <p className="text-xs font-mono text-slate-300 break-all">{stellarWallet.address}</p>
                  </div>
                  <button
                    onClick={() => {
                      stellarWallet.disconnect();
                      setShowStellarMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/30 transition-colors"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Disconnect Stellar Wallet
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => stellarWallet.connect()}
              disabled={stellarWallet.connecting}
              className="flex items-center gap-2 rounded-xl border border-violet-500/60 bg-violet-950/30 hover:bg-violet-900/40 text-violet-300 px-4 py-2 text-xs font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 0 1 0 18M3 12h18" />
              </svg>
              {stellarWallet.connecting ? "Connecting…" : "Stellar"}
            </button>
          )}
        </div>
        </div>
      </div>
    </header>
  );
}
