"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";

/**
 * The site agent at work — a full-screen, animated "building your site" scene shown while the agent builds a new site or
 * edits one: a robot with orbiting tool emojis, a page that assembles itself block by block, the current stage and a
 * progress bar. When the agent finishes it celebrates for a moment and the site is shown exactly as before (the editor /
 * the preview); when something fails it says so and offers "try again". Pure CSS (transform / opacity only, layered so it
 * never fights the page), respects "reduce motion", and can be closed at any time (the work continues).
 */
export type AgentPhase = "idle" | "working" | "done" | "error";

const ORBIT = ["🎨", "✍️", "🧩", "🖼️", "✨", "🚀"] as const;

export function SiteAgentLoader({ phase, mode, stages, error, onClose, onRetry }: { phase: AgentPhase; mode: "build" | "edit"; stages: string[]; error?: string | null; onClose: () => void; onRetry?: () => void }) {
  const { t, dir } = useI18n();
  const [stage, setStage] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (phase !== "working") return;
    const t0 = Date.now();
    const per = mode === "build" ? 7000 : 2600;
    const tick = () => setStage(Math.min(stages.length - 1, Math.floor((Date.now() - t0) / per)));
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 400);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [phase, mode, stages.length]);
  useEffect(() => {
    if (phase === "idle") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onClose]);
  if (phase === "idle" || !mounted) return null;
  const pct = phase === "done" ? 100 : Math.round(((stage + 0.6) / stages.length) * 92);
  return createPortal(
    <div className="sal-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-live="polite" dir={dir} data-testid="site-agent-loader" data-phase={phase}>
      <div className="sal-card relative w-full max-w-md overflow-hidden rounded-3xl border border-line bg-elevated p-6 text-center shadow-2xl">
        <button type="button" onClick={onClose} className="absolute end-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted transition hover:bg-surface-hover hover:text-fg" aria-label={t("websites.agentLoader.close")} data-testid="site-agent-loader-close">
          <X className="h-4 w-4" />
        </button>
        <div className="sal-glow pointer-events-none absolute -top-24 start-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-accent/30 blur-3xl rtl:translate-x-1/2" aria-hidden />

        {/* the robot + its orbiting tools */}
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
          <span className={phase === "error" ? "sal-shake text-6xl" : phase === "done" ? "sal-pop text-6xl" : "sal-bob text-6xl"}>{phase === "error" ? "😕" : phase === "done" ? "🥳" : "🤖"}</span>
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
          {phase === "error" ? t("websites.agentLoader.errorTitle") : phase === "done" ? t(mode === "build" ? "websites.agentLoader.doneBuild" : "websites.agentLoader.doneEdit") : t(mode === "build" ? "websites.agentLoader.titleBuild" : "websites.agentLoader.titleEdit")}
        </h2>
        <p className="mt-1 min-h-[1.5rem] text-[13px] text-muted" data-testid="site-agent-loader-stage">
          {phase === "error" ? (error ?? t("websites.agentLoader.errorBody")) : phase === "done" ? t("websites.agentLoader.showing") : stages[stage]}
        </p>

        {/* the page assembling itself */}
        {phase !== "error" ? (
          <div className="mx-auto mt-4 w-56 space-y-1.5 rounded-xl border border-line bg-surface p-2.5 text-start" aria-hidden>
            <div className="sal-block h-2.5 rounded bg-accent/60" style={{ animationDelay: "0s" }} />
            <div className="sal-block h-9 rounded-md bg-gradient-to-l from-accent/30 to-accent/5" style={{ animationDelay: ".35s" }} />
            <div className="grid grid-cols-3 gap-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="sal-block h-6 rounded bg-line-strong/60" style={{ animationDelay: `${0.7 + i * 0.2}s` }} />
              ))}
            </div>
            <div className="sal-block h-2 w-2/3 rounded bg-line-strong/60" style={{ animationDelay: "1.4s" }} />
            <div className="sal-block mx-auto h-4 w-1/3 rounded-full bg-accent/70" style={{ animationDelay: "1.7s" }} />
          </div>
        ) : null}

        {phase !== "error" ? (
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="sal-bar h-full rounded-full bg-accent-solid transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
        ) : (
          <div className="mt-5 flex justify-center gap-2">
            {onRetry ? (
              <Button onClick={onRetry} data-testid="site-agent-loader-retry">
                <RotateCcw className="h-4 w-4" /> {t("websites.agentLoader.retry")}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose}>
              {t("websites.agentLoader.close")}
            </Button>
          </div>
        )}
        {phase === "working" ? <p className="mt-3 text-[11.5px] text-subtle">{t("websites.agentLoader.hint")}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
