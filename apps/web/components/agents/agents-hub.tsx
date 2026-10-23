"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Megaphone, Play, Receipt, Target, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { runAgentNowAction, saveAgentAction } from "@/app/[locale]/(dashboard)/agents/actions";

/**
 * Wave 19 — the AI team hub: one card per agent with what it does, an on/off switch,
 * its few settings, a "run now" button and its recent work log.
 */
export interface AgentView {
  key: "marketing" | "sales_manager" | "analyst" | "collections";
  enabled: boolean;
  config: Record<string, number | boolean | string>;
  lastRunAt: string | null;
  runs: { id: number; summary: string; actions: number; created_at: string }[];
}

const ICONS: Record<AgentView["key"], LucideIcon> = { marketing: Megaphone, sales_manager: Target, analyst: BarChart3, collections: Receipt };
const TONES: Record<AgentView["key"], string> = {
  marketing: "from-fuchsia-500/20 to-pink-500/10 text-fuchsia-500",
  sales_manager: "from-emerald-500/20 to-teal-500/10 text-emerald-500",
  analyst: "from-sky-500/20 to-indigo-500/10 text-sky-500",
  collections: "from-amber-500/20 to-orange-500/10 text-amber-500",
};

/** The settings each agent shows (number / toggle). */
const FIELDS: Record<AgentView["key"], { key: string; type: "number" | "boolean"; min?: number; max?: number }[]> = {
  marketing: [
    { key: "posts", type: "number", min: 1, max: 14 },
    { key: "auto_publish", type: "boolean" },
  ],
  sales_manager: [
    { key: "quiet_days", type: "number", min: 2, max: 60 },
    { key: "max_tasks", type: "number", min: 1, max: 20 },
  ],
  analyst: [{ key: "email", type: "boolean" }],
  collections: [
    { key: "gap_days", type: "number", min: 1, max: 30 },
    { key: "max_reminders", type: "number", min: 1, max: 5 },
    { key: "carts", type: "boolean" },
  ],
};

function AgentCard({ a, canManage }: { a: AgentView; canManage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [enabled, setEnabled] = useState(a.enabled);
  const [cfg, setCfg] = useState(a.config);
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(false);
  const Icon = ICONS[a.key];

  const save = (next: { enabled?: boolean; config?: Record<string, number | boolean | string> }) =>
    start(async () => {
      const r = await saveAgentAction({ locale, agent: a.key, enabled: next.enabled ?? enabled, config: next.config ?? cfg });
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        router.refresh();
      }
    });

  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-sm" data-agent={a.key}>
      <div className={cn("flex items-start gap-3 bg-gradient-to-br p-5", TONES[a.key])}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface/80 shadow-sm backdrop-blur">
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1 text-fg">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="me-auto text-base font-bold">{t(`agents.${a.key}.title`)}</h3>
            <Badge tone={enabled ? "success" : "neutral"}>{t(enabled ? "agents.on" : "agents.off")}</Badge>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(`agents.${a.key}.body`)}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">
        <ul className="space-y-1.5 text-[13px] text-muted">
          {[1, 2, 3].map((i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{t(`agents.${a.key}.does${i}`)}</span>
            </li>
          ))}
        </ul>
        {canManage ? (
          <div className="space-y-3 rounded-2xl bg-elevated p-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
              <span>{t("agents.switch")}</span>
              <input
                type="checkbox"
                role="switch"
                className="h-5 w-9 cursor-pointer accent-[var(--color-accent,#3366e6)]"
                checked={enabled}
                disabled={pending}
                data-testid={`agent-toggle-${a.key}`}
                onChange={(e) => {
                  setEnabled(e.target.checked);
                  save({ enabled: e.target.checked });
                }}
              />
            </label>
            {FIELDS[a.key].map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="text-muted">{t(`agents.${a.key}.fields.${f.key}`)}</span>
                {f.type === "boolean" ? (
                  <input type="checkbox" checked={Boolean(cfg[f.key])} disabled={pending} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.checked })} />
                ) : (
                  <Input type="number" min={f.min} max={f.max} className="h-9 w-20 text-center" value={Number(cfg[f.key] ?? f.min ?? 1)} onChange={(e) => setCfg({ ...cfg, [f.key]: Math.max(f.min ?? 0, Math.min(f.max ?? 1000, Number(e.target.value) || 0)) })} />
                )}
              </label>
            ))}
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="secondary" loading={pending} onClick={() => save({ config: cfg })}>
                {t("common.save")}
              </Button>
              <Button
                size="sm"
                loading={running}
                data-testid={`agent-run-${a.key}`}
                onClick={async () => {
                  setRunning(true);
                  const r = await runAgentNowAction({ locale, agent: a.key });
                  setRunning(false);
                  if (r.error) toast.error(t(r.error));
                  else {
                    toast.success(r.data?.summary ? r.data.summary.slice(0, 160) : t("agents.ran"));
                    router.refresh();
                  }
                }}
              >
                <Play className="h-3.5 w-3.5 rtl:-scale-x-100" /> {t("agents.runNow")}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="min-w-0">
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-subtle">{t("agents.log")}</h4>
          {a.runs.length ? (
            <ol className="space-y-2" data-testid={`agent-log-${a.key}`}>
              {a.runs.map((r) => (
                <li key={r.id} className="rounded-xl border border-line/70 p-2.5">
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed" dir="auto">
                    {r.summary}
                  </p>
                  <p className="mt-1 text-[11px] text-subtle">{new Date(r.created_at).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { dateStyle: "short", timeStyle: "short" })}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12.5px] text-subtle">{t("agents.noRuns")}</p>
          )}
        </div>
      </div>
    </li>
  );
}

export function AgentsHub({ agents, canManage }: { agents: AgentView[]; canManage: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0" data-testid="agents-hub">
      {agents.map((a) => (
        <AgentCard key={a.key} a={a} canManage={canManage} />
      ))}
    </ul>
  );
}
