import Link from "next/link";
import { LEGS } from "@/lib/legs";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-cyan-400">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-[var(--card)] p-5">{children}</div>
  );
}

const TOC = [
  ["overview", "Overview"],
  ["how-it-works", "How it works"],
  ["raw-usdc", "Raw USDC mode"],
  ["chains", "Supported chains"],
  ["fees", "Fees"],
  ["security", "Security model"],
  ["roadmap", "Roadmap"],
] as const;

export default function DocsPage() {
  const legRows = Object.values(LEGS);

  return (
    <div className="min-h-screen bg-[var(--background)] text-slate-100">
      <header className="border-b border-white/5">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <h1 className="text-lg font-bold tracking-tight">Conduit · Docs</h1>
          <Link
            href="/"
            className="rounded-lg border border-white/5 bg-[var(--card)] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-white/10 hover:text-white"
          >
            ← Back to swap
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="grid gap-8 md:grid-cols-[160px_1fr]">
          {/* Table of contents */}
          <nav className="hidden md:block">
            <ul className="sticky top-20 space-y-2 text-xs text-slate-500">
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="transition-colors hover:text-cyan-400">
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-10">
            <Section id="overview" title="Overview">
              <p>
                Conduit lets a user hold native ETH (or another chain&apos;s native gas token) on
                one chain and receive native ETH on another — in a single wallet signature. No
                wrapped tokens, no manual &ldquo;swap, bridge, swap again, claim&rdquo; dance, no
                liquidity-pool bridge risk. USDC is the invisible settlement layer in between,
                moved entirely through Circle&apos;s CCTP V2 burn-and-mint — never a wrapped
                asset, never a third-party vault.
              </p>
              <Card>
                <pre className="overflow-x-auto whitespace-pre text-xs text-slate-400">
{`User sees:      ETH (Base)  ──────────────────→  ETH (Arbitrum)
What happens:   ETH → USDC → [CCTP V2 burn] → [CCTP V2 mint] → USDC → ETH
Bridge:         Circle burn-and-mint only
Trust model:    Circle's attestation service (Iris) — nothing else
Output:         Native ETH, not wrapped`}
                </pre>
              </Card>
            </Section>

            <Section id="how-it-works" title="How it works">
              <p>
                Two contracts make this possible: <code className="text-cyan-300">SwapAndBurn</code>{" "}
                on the source chain (swap-then-burn in one transaction) and{" "}
                <code className="text-cyan-300">ReceiveAndSwap</code> on the destination chain (a
                permissionless hook executor that mints and swaps back atomically).
              </p>
              <Card>
                <pre className="overflow-x-auto whitespace-pre text-xs text-slate-400">
{`1. Source chain, one signature
   User's native ETH
     → SwapAndBurn.swapAndBurnNative()
     → Uniswap: ETH → USDC (0.05% Conduit fee skimmed here)
     → CCTP V2 depositForBurnWithHook — burns USDC, embeds the
       destination swap instructions in the attested message

2. Circle attestation (Iris) — ~15-20 seconds on Fast Transfer

3. Destination chain, no signature needed
   ReceiveAndSwap.relayAndExecute() — callable by anyone
     → CCTP mints USDC, hook fires atomically
     → Uniswap: USDC → native ETH, delivered to the user`}
                </pre>
              </Card>
              <p>
                <code className="text-cyan-300">ReceiveAndSwap</code> is trustless by construction:
                the swap instructions (recipient, pool, minimum output) are cryptographically bound
                inside Circle&apos;s attestation. Conduit&apos;s relayer only submits the
                transaction and pays gas — it has no ability to redirect funds, because it never
                controls what the hook does. Anyone could run the relayer.
              </p>
            </Section>

            <Section id="raw-usdc" title="Raw USDC mode">
              <p>
                Every leg also supports a second mode: a plain CCTP transfer with no swap on either
                end — USDC in, USDC out, at the destination&apos;s own address, with no{" "}
                <code className="text-cyan-300">SwapAndBurn</code>/<code className="text-cyan-300">ReceiveAndSwap</code>{" "}
                contract involved and no Conduit fee. This is the same no-swap path Arc Testnet has
                always used (its native gas token already is USDC), generalized as a toggle
                available on any chain — useful when the sender already holds USDC and just wants
                it on another chain without round-tripping through native currency.
              </p>
            </Section>

            <Section id="chains" title="Supported chains">
              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-[var(--card)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3 font-medium">Chain</th>
                      <th className="px-4 py-3 font-medium">Native asset</th>
                      <th className="px-4 py-3 font-medium">Architecture</th>
                    </tr>
                  </thead>
                  <tbody>
                    {legRows.map((leg) => (
                      <tr key={leg.key} className="border-b border-white/5 last:border-0">
                        <td className="px-4 py-3 text-slate-200">{leg.label}</td>
                        <td className="px-4 py-3 text-slate-400">
                          {leg.isStellar ? "XLM" : leg.nativeIsUsdc ? "USDC" : leg.chain?.nativeCurrency.symbol}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {leg.isStellar
                            ? "Non-EVM (Soroban) — swap_and_deliver re-parses the attested message"
                            : leg.nativeIsUsdc
                              ? "Native gas token is USDC — plain CCTP, no swap contracts"
                              : leg.dex === "v2"
                                ? "SwapAndBurnUniV2 / ReceiveAndSwapUniV2 (Uniswap V2-style router)"
                                : "SwapAndBurn / ReceiveAndSwap (Uniswap V3)"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500">
                Every route has a real, verifiable proof transaction — see{" "}
                <a
                  className="underline hover:text-slate-400"
                  href="https://github.com/Godbrand0/conduit/blob/main/DEPLOYMENTS.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  DEPLOYMENTS.md
                </a>
                .
              </p>
            </Section>

            <Section id="fees" title="Fees">
              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-[var(--card)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3 font-medium">Component</th>
                      <th className="px-4 py-3 font-medium">Amount</th>
                      <th className="px-4 py-3 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    <tr className="border-b border-white/5">
                      <td className="px-4 py-3">Source DEX swap</td>
                      <td className="px-4 py-3">~0.05–0.3%</td>
                      <td className="px-4 py-3 text-slate-500">Uniswap pool fee — skipped in raw USDC mode</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-4 py-3">Conduit fee</td>
                      <td className="px-4 py-3">0.05%</td>
                      <td className="px-4 py-3 text-slate-500">Skimmed pre-burn — 0% in raw USDC mode or from Arc</td>
                    </tr>
                    <tr className="border-b border-white/5">
                      <td className="px-4 py-3">Circle fast fee</td>
                      <td className="px-4 py-3">variable</td>
                      <td className="px-4 py-3 text-slate-500">Quoted live, shown before signing</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3">Destination DEX swap</td>
                      <td className="px-4 py-3">~0.05–0.3%</td>
                      <td className="px-4 py-3 text-slate-500">Uniswap pool fee — skipped in raw USDC mode</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                All fees are shown in the swap details panel before the user signs — no surprises
                after the fact.
              </p>
            </Section>

            <Section id="security" title="Security model">
              <ul className="list-inside list-disc space-y-1.5">
                <li>
                  <span className="text-slate-200">Single trust dependency:</span> Circle&apos;s
                  attestation service. Using native USDC on any chain already implies trusting
                  Circle — Conduit adds no additional party.
                </li>
                <li>
                  <span className="text-slate-200">No custody at rest:</span>{" "}
                  <code className="text-cyan-300">ReceiveAndSwap</code> only ever holds USDC for
                  the duration of one transaction — the atomic mint-then-swap.
                </li>
                <li>
                  <span className="text-slate-200">Trustless relaying:</span> the destination
                  swap&apos;s parameters are bound inside Circle&apos;s cryptographic attestation.
                  The relayer wallet can pay gas; it cannot redirect funds. Anyone can run it.
                </li>
                <li>
                  <span className="text-slate-200">Slippage floors</span> enforced on-chain on
                  both the source and destination swap.
                </li>
              </ul>
              <p>
                Contracts are intentionally simple — two contracts, no proxy/upgrade pattern, no
                token custody beyond a single atomic transaction — to keep the eventual audit
                surface small.
              </p>
            </Section>

            <Section id="roadmap" title="Roadmap">
              <ul className="list-inside list-disc space-y-1.5">
                <li>Mainnet migration, gated on a security audit.</li>
                <li>
                  Generalized token↔USDC swaps — any ERC20 with a verified pool as a source or
                  destination asset, not just each chain&apos;s native currency or raw USDC.
                </li>
                <li>Stellar wired into the frontend as a selectable source, not just destination.</li>
              </ul>
            </Section>

            <p className="border-t border-white/5 pt-6 text-center text-xs text-slate-600">
              <a
                className="underline hover:text-slate-400"
                href="https://github.com/Godbrand0/conduit"
                target="_blank"
                rel="noreferrer"
              >
                Source on GitHub
              </a>{" "}
              ·{" "}
              <a
                className="underline hover:text-slate-400"
                href="https://github.com/Godbrand0/conduit/blob/main/DEPLOYMENTS.md"
                target="_blank"
                rel="noreferrer"
              >
                Deployment proofs
              </a>{" "}
              ·{" "}
              <a
                className="underline hover:text-slate-400"
                href="https://www.npmjs.com/package/@cctp-sdk/core"
                target="_blank"
                rel="noreferrer"
              >
                @cctp-sdk/core on npm
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
