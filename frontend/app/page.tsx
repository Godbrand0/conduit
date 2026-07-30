"use client";

import { useState } from "react";
import { Navbar } from "./components/Navbar";
import { HistoryView } from "./components/HistoryView";
import { SwapCard } from "./components/SwapCard";
import { StatusTracker } from "./components/StatusTracker";
import { useSwapFlow } from "./hooks/useSwap";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"swap" | "history">("swap");
  const flow = useSwapFlow();

  return (
    <div className="min-h-screen bg-[var(--background)] text-slate-100">
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="mx-auto flex w-full flex-col items-center px-4 py-10">
        {activeTab === "swap" ? (
          <div className="w-full max-w-md">
            <SwapCard
              from={flow.from}
              to={flow.to}
              amount={flow.amount}
              setFrom={flow.setFrom}
              setTo={flow.setTo}
              setAmount={flow.setAmount}
              reverse={flow.reverse}
              maxFee={flow.maxFee}
              usdcEstimate={flow.usdcEstimate}
              receiveEstimate={flow.receiveEstimate}
              balance={flow.balance}
              onSwap={flow.swap}
              signing={flow.signing}
              busy={flow.busy}
              isConnected={flow.isConnected}
              error={flow.error}
            />

            {flow.tracked && (
              <StatusTracker
                steps={flow.steps}
                serverSwap={flow.serverSwap}
                destLabel={flow.trackedDest.label}
              />
            )}

            <p className="mt-6 text-center text-xs text-slate-600">
              <span className="text-amber-400">Testnet</span> MVP · native
              burn-and-mint · no wrapped tokens · <span className="text-amber-400">Arc Testnet</span> support coming soon ·{" "}
              <a
                className="underline hover:text-slate-400"
                href="https://github.com/Godbrand0/conduit"
                target="_blank"
                rel="noreferrer"
              >
                source &amp; proofs
              </a>
            </p>
          </div>
        ) : (
          <HistoryView
            onSelectSwap={(hash, from, to) => {
              flow.track(hash as `0x${string}`, from, to);
              setActiveTab("swap");
            }}
          />
        )}
      </main>
    </div>
  );
}
