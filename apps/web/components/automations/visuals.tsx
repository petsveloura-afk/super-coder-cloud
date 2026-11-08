import type { ReactNode } from "react";

/** Small, dependency-free visuals for the automations area (server- and client-safe). */

const scoreColor = (score: number) => (score >= 92 ? "var(--success)" : score >= 75 ? "var(--accent)" : score >= 55 ? "var(--warning)" : "var(--danger)");

/** Circular quality score (0–100). */
export function ScoreRing({ score, size = 72, label }: { score: number; size?: number; label?: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label ? `${label}: ${pct}` : String(pct)}>
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--line)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={scoreColor(pct)} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: "stroke-dashoffset .5s ease" }} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[15px] font-bold tabular-nums">{pct}</span>
    </div>
  );
}

/** Tiny bar sparkline: green = succeeded, red = problems, one bar per day. */
export function Sparkline({ data, height = 28, label }: { data: { day: string; ok: number; bad: number }[]; height?: number; label?: string }) {
  const max = Math.max(1, ...data.map((d) => d.ok + d.bad));
  const w = 4;
  const gap = 2;
  const width = data.length * (w + gap) - gap;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="max-w-full" role="img" aria-label={label} preserveAspectRatio="none">
      {data.map((d, i) => {
        const total = d.ok + d.bad;
        const h = total === 0 ? 1.5 : Math.max(3, (total / max) * height);
        const badH = total === 0 ? 0 : (d.bad / total) * h;
        const x = i * (w + gap);
        return (
          <g key={d.day}>
            <title>{`${d.day}: ${d.ok}${d.bad ? ` / ${d.bad}` : ""}`}</title>
            <rect x={x} y={height - h} width={w} height={h - badH} rx="1" fill={total === 0 ? "var(--line)" : "var(--success)"} opacity={total === 0 ? 1 : 0.85} />
            {badH > 0 ? <rect x={x} y={height - badH} width={w} height={badH} rx="1" fill="var(--danger)" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

/** KPI tile. The label is deliberately NOT a heading (the page has a single h1 + card h2s). */
export function KpiTile({ icon, label, value, hint, tone = "neutral" }: { icon?: ReactNode; label: string; value: ReactNode; hint?: string; tone?: "neutral" | "success" | "warning" | "danger" | "accent" }) {
  const toneText = { neutral: "text-fg", success: "text-success", warning: "text-warning", danger: "text-danger", accent: "text-accent" }[tone];
  return (
    <div className="card-premium rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        {icon ? <span className="text-subtle">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${toneText}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-[12px] text-subtle">{hint}</div> : null}
    </div>
  );
}
