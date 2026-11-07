"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";

/**
 * The digital team at work (additive) — the same animated scene family as the site agent's "building your site", themed for
 * an AI employee thinking: a brain with orbiting work tools (data, search, writing, checking, calendar, ideas), a plan that
 * ticks itself off line by line, the current stage and a progress bar. Shown while a goal is planned or a task runs from the
 * screen; it celebrates when the work is done and says plainly when it will be retried. Reuses the site loader's CSS
 * (transform / opacity only, layered, respects "reduce motion"); can be closed at any time — the work continues.
 */
export type TeamPhase = "idle" | "working" | "done" | "error";

const ORBIT = ["📊", "🔎", "✍️", "✅", "📅", "💡"] as const;

export function TeamAgentLoader({ phase, mode, name, message, onClose, live, note, onRetry }: { phase: TeamPhase; mode: "goal" | "task"; name?: string | null; message?: string | null; onClose: () => void; /** the employee's latest real step (from the activity log) */ live?: string | null; /** e.g. "the engines were busy — trying again (2/3)" */ note?: string | null; onRetry?: () => void }) {
  const { t, dir } = useI18n();
  const stages = (mode === "goal" ? ["understand", "team", "split", "order", "check"] : ["understand", "context", "plan", "work", "selfcheck", "deliver"]).map((k) => t(`aiTeam.loader.stage.${k}`));
  const [stage, setStage] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (phase !== "working") return;
    const t0 = Date.now();
    const tick = () => setStage(Math.min(stages.length - 1, Math.floor((Date.now() - t0) / 5500)));
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [phase, stages.length]);
  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);
  if (phase === "idle" || !mounted) return null;
  const pct = phase === "done" ? 100 : Math.round(((stage + 0.6) / stages.length) * 92);
  return createPortal(
    <div className="sal-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-live="polite" dir={dir} data-testid="team-agent-loader" data-phase={phase}>
      <div className="sal-card relative w-full max-w-md overflow-hidden rounded-3xl border border-line bg-elevated p-6 text-center shadow-2xl">
        <button type="button" onClick={onClose} className="absolute end-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface-hover hover:text-fg" aria-label={t("common.close")} data-testid="team-agent-loader-close">
          <X className="h-4 w-4" />
        </button>
        <div className="sal-glow pointer-events-none absolute -top-24 start-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-accent/30 blur-3xl rtl:translate-x-1/2" aria-hidden />

        <div className="relative mx-auto mb-4 grid h-36 w-36 place-items-center" aria-hidden>
          {phase === "working"
            ? ORBIT.map((e, i) => (
                <span key={e} className="sal-orbit absolute inset-0" style={{ animationDelay: `${(-i * 6) / ORBIT.length}s` }}>
                  <span className="sal-orbit-item absolute start-1/2 top-0 grid h-9 w-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-lg shadow-md rtl:translate-x-1/2" style={{ animationDelay: `${(-i * 6) / ORBIT.length}s` }}>
                    {e}
                  </span>
                </span>
              ))
            : null}
          <span className={phase === "error" ? "sal-shake text-6xl" : phase === "done" ? "sal-pop text-6xl" : "sal-bob text-6xl"}>{phase === "error" ? "⏳" : phase === "done" ? "🥳" : "🧠"}</span>
          {phase === "done" ? (
            <span className="pointer-events-none absolute inset-0" aria-hidden>
              {["🎉", "✨", "⭐", "🎊", "💫", "✨"].map((e, i) => (
                <span key={i} className="sal-burst absolute start-1/2 top-1/2 text-xl" style={{ ["--a" as string]: `${i * 60}deg` }}>
                  {e}
                </span>
              ))}
            </span>
          ) : null}
        </div>

        <h2 className="text-lg font-bold">
          {phase === "error" ? t("aiTeam.loader.retryTitle") : phase === "done" ? t("aiTeam.loader.doneTitle") : t(mode === "goal" ? "aiTeam.loader.titleGoal" : "aiTeam.loader.titleTask", { name: name ?? "" })}
        </h2>
        <p className="mt-1 min-h-[1.5rem] text-[13px] text-muted" data-testid="team-agent-loader-stage">
          {phase === "error" ? (message ?? t("aiTeam.loader.retryBody")) : phase === "done" ? (message ?? t("aiTeam.loader.doneBody")) : stages[stage]}
        </p>

        {phase === "working" && live ? (
          <p className="mx-auto mt-2 max-w-xs truncate rounded-full bg-surface px-3 py-1 text-[11.5px] text-muted" data-testid="team-agent-loader-live" title={live}>
            {live}
          </p>
        ) : null}
        {note ? <p className="mt-2 text-[12px] font-medium text-warning" data-testid="team-agent-loader-note">{note}</p> : null}
        {phase !== "error" ? (
          // the plan ticking itself off
          <ul className="mx-auto mt-4 w-60 space-y-1.5 rounded-xl border border-line bg-surface p-2.5 text-start text-[12px]" aria-hidden>
            {stages.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${i < stage || phase === "done" ? "bg-accent-solid text-accent-fg" : i === stage ? "sal-glow bg-accent/40" : "bg-line"}`}>{i < stage || phase === "done" ? "✓" : ""}</span>
                <span className={i <= stage || phase === "done" ? "text-fg" : "text-subtle"}>{s}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="sal-bar h-full rounded-full bg-accent-solid transition-[width] duration-700" style={{ width: `${phase === "error" ? 100 : pct}%` }} />
        </div>
        {phase === "error" && onRetry ? (
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={onRetry} data-testid="team-agent-loader-retry">
              <RotateCcw className="h-4 w-4" /> {t("aiTeam.board.retryNow")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("common.close")}
            </Button>
          </div>
        ) : null}
        {phase === "working" ? <p className="mt-3 text-[11.5px] text-subtle">{t("aiTeam.loader.hint")}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

/** a small "thinking…" pulse for a task card while its employee works on it */
export function ThinkingDots({ label }: { label: string }) {
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent" data-testid="task-thinking">
      <span className="team-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      {label}
    </span>
  );
}
