import type { SwapRow } from "@/lib/db";

const STYLES: Record<SwapRow["status"], { border: string; bg: string; text: string; dot: string; label: string; pulse?: boolean }> = {
  COMPLETE: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-950/40",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
    label: "Complete",
  },
  RELAYING: {
    border: "border-cyan-500/30",
    bg: "bg-cyan-950/40",
    text: "text-cyan-400",
    dot: "bg-cyan-400",
    label: "Relaying",
    pulse: true,
  },
  AWAITING_ATTESTATION: {
    border: "border-amber-500/30",
    bg: "bg-amber-950/40",
    text: "text-amber-400",
    dot: "bg-amber-400",
    label: "Attesting",
    pulse: true,
  },
  RECEIVED: {
    border: "border-amber-500/30",
    bg: "bg-amber-950/40",
    text: "text-amber-400",
    dot: "bg-amber-400",
    label: "Attesting",
    pulse: true,
  },
  FAILED: {
    border: "border-rose-500/30",
    bg: "bg-rose-950/40",
    text: "text-rose-400",
    dot: "bg-rose-400",
    label: "Failed",
  },
};

export function StatusBadge({ status }: { status: SwapRow["status"] }) {
  const s = STYLES[status] ?? {
    border: "border-slate-700",
    bg: "bg-slate-800",
    text: "text-slate-300",
    dot: "bg-slate-400",
    label: status,
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${s.border} ${s.bg} px-2.5 py-1 text-[11px] font-medium ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} />
      {s.label}
    </span>
  );
}
