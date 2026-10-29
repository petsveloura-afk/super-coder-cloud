"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HeartHandshake, Play, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { PLUS_FIELDS, type PlusAgentKey } from "@/lib/agents/plus-core";
import { runPlusAgentNowAction, savePlusAgentAction } from "@/app/[locale]/(dashboard)/agents/plus-actions";

export interface PlusAgentView {
  key: PlusAgentKey;
  enabled: boolean;
  config: Record<string, number | boolean | string>;
  lastRunAt: string | null;
  runs: { id: number; summary: string; actions: number; created_at: string }[];
}

const ICON: Record<PlusAgentKey, typeof Star> = { reviews_requester: Star, reengage: HeartHandshake };

function PlusCard({ a, canManage }: { a: PlusAgentView; canManage: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [enabled, setEnabled] = useState(a.enabled);
  const [cfg, setCfg] = useState<Record<string, number | boolean | string>>(a.config);
  const [pending, start] = useTransition();
  const Icon = ICON[a.key];
  const save = (nextEnabled = enabled) =>
    start(async () => {
      const r = await savePlusAgentAction({ locale, agent: a.key, enabled: nextEnabled, config: cfg });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      router.refresh();
    });
  const run = () =>
    start(async () => {
      const r = await runPlusAgentNowAction({ locale, agent: a.key });
      if (r.error) return void toast.error(t(r.error));
      toast.success(r.data?.summary || t("agents.ran"));
      router.refresh();
    });
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <li className={cn("lift rounded-2xl border bg-surface p-4 shadow-sm", enabled ? "border-accent/40" : "border-line")} data-agent-plus={a.key}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", enabled ? "bg-accent-solid text-accent-fg" : "bg-accent-soft text-accent")}>
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-[12rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold">{t(`agents.plus.${a.key}.name`)}</h3>
            <Badge tone="gold">{t("agents.plus.new")}</Badge>
            {enabled ? <Badge tone="success">{t("agents.plus.on")}</Badge> : null}
          </div>
          <p className="mt-1 text-[13px] text-muted">{t(`agents.plus.${a.key}.body`)}</p>
        </div>
        {canManage ? (
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent-solid)]"
              checked={enabled}
              disabled={pending}
              onChange={(e) => {
                setEnabled(e.target.checked);
                save(e.target.checked);
              }}
              data-testid={`plus-toggle-${a.key}`}
            />
            {t("agents.plus.enable")}
          </label>
        ) : null}
      </div>
      {canManage ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLUS_FIELDS[a.key].map((f) => {
            const id = `plus-${a.key}-${f.key}`;
            return (
              <div key={f.key} className={cn("space-y-1", f.key === "review_url" && "sm:col-span-2 lg:col-span-3")}>
                <label htmlFor={id} className="text-[12px] font-medium text-muted">
                  {t(`agents.plus.field.${f.key}`)}
                </label>
                {f.type === "boolean" ? (
                  <div>
                    <input id={id} type="checkbox" className="h-4 w-4 accent-[var(--accent-solid)]" checked={Boolean(cfg[f.key])} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.checked }))} />
                  </div>
                ) : f.type === "select" ? (
                  <Select id={id} value={String(cfg[f.key] ?? "")} onChange={(e) => setCfg((c) => ({ ...c, [f.key]: e.target.value }))} className="h-9">
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {t(`agents.plus.opt.${o}`)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={id}
                    type={f.type === "number" ? "number" : "url"}
                    min={f.min}
                    max={f.max}
                    dir={f.type === "number" || f.key === "review_url" ? "ltr" : "auto"}
                    value={String(cfg[f.key] ?? "")}
                    placeholder={f.key === "review_url" ? "https://g.page/r/…" : undefined}
                    onChange={(e) => setCfg((c) => ({ ...c, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value }))}
                    className="h-9"
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canManage ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => save()} loading={pending}>
              <Save className="h-3.5 w-3.5" aria-hidden /> {t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={run} disabled={pending}>
              <Play className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden /> {t("agents.plus.runNow")}
            </Button>
          </>
        ) : null}
        <span className="ms-auto text-[11.5px] text-subtle">{a.lastRunAt ? t("agents.plus.lastRun", { when: when(a.lastRunAt) }) : t("agents.plus.neverRan")}</span>
      </div>
      {a.runs.length ? (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {a.runs.slice(0, 4).map((r) => (
            <li key={r.id} className="text-[12.5px]">
              <span className="text-subtle">{when(r.created_at)} · </span>
              <span dir="auto">{r.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Wave 54 — the new AI team members (review requests, re-engagement), next to the existing team. */
export function PlusAgents({ agents, canManage }: { agents: PlusAgentView[]; canManage: boolean }) {
  const { t } = useI18n();
  return (
    <section className="mt-4" aria-label={t("agents.plus.title")} data-testid="plus-agents">
      <h2 className="mb-1 text-[16px] font-bold">{t("agents.plus.title")}</h2>
      <p className="mb-3 text-[13px] text-muted">{t("agents.plus.subtitle")}</p>
      <ul className="stagger grid gap-3 lg:grid-cols-2">
        {agents.map((a) => (
          <PlusCard key={a.key} a={a} canManage={canManage} />
        ))}
      </ul>
    </section>
  );
}
