"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, History, Info, Lock, Minus, Palette, Pencil, Plus, Search, Sparkles, TriangleAlert, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Textarea } from "@/components/ui/primitives";
import { aiEditSiteAction } from "@/app/[locale]/(dashboard)/websites/actions";
import type { SiteValue } from "./site-builder";
import { diffSites, type SiteDiff } from "@/lib/site/diff";
import { cn } from "@/lib/utils";

/**
 * Wave 13 — "tell the agent what to change": the AI rewrites texts, adds sections,
 * restyles the site or switches the template. The result lands in the editor (not
 * saved) so the business reviews it and saves / publishes; one-click undo.
 */
const QUICK = ["modern", "testimonials", "pricing", "shorter", "luxury", "stats", "steps", "english", "faq", "seo", "cta", "trust", "arabic", "hebrew"] as const;

/** wave 33: the last instructions, remembered in this browser (a convenience — works without storage) */
const HISTORY_KEY = "scc-ai-edit-history";
const HISTORY_EVENT = "scc-ai-edit-history-change";
let memHistory = "[]"; // used when storage is blocked
const rawHistory = (): string => {
  try {
    return window.localStorage.getItem(HISTORY_KEY) ?? memHistory;
  } catch {
    return memHistory;
  }
};
const parseHistory = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
};
const writeHistory = (list: string[]) => {
  memHistory = JSON.stringify(list.slice(0, 5));
  try {
    window.localStorage.setItem(HISTORY_KEY, memHistory);
  } catch {
    /* private mode — fine */
  }
  window.dispatchEvent(new Event(HISTORY_EVENT));
};
const subscribeHistory = (cb: () => void) => {
  window.addEventListener(HISTORY_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(HISTORY_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};

export function AiEditPanel({
  value,
  onApply,
  allowed,
  proTemplates,
  onApplied,
  onFocusBlock,
  onUndone,
}: {
  value: SiteValue;
  onApply: (v: SiteValue) => void;
  allowed: boolean;
  proTemplates: boolean;
  /** wave 33: called after the agent's result landed in the editor (highlight + preview) */
  onApplied?: (diff: SiteDiff, next: SiteValue) => void;
  /** wave 33: jump to a section (editor + live preview) */
  onFocusBlock?: (index: number) => void;
  /** wave 34: the agent's edit was taken back (clear highlights) */
  onUndone?: () => void;
}) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [prev, setPrev] = useState<SiteValue | null>(null);
  const [pending, start] = useTransition();
  const [diff, setDiff] = useState<SiteDiff | null>(null);
  const [stageRaw, setStage] = useState(0);
  const recentRaw = useSyncExternalStore(subscribeHistory, rawHistory, () => "[]");
  const recent = useMemo(() => parseHistory(recentRaw), [recentRaw]);
  const [empty, setEmpty] = useState(false);
  // wave 34: the newest editor state — an answer that arrives after the owner kept typing must never silently overwrite that work
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const [conflict, setConflict] = useState<{ next: SiteValue; d: SiteDiff; instruction: string } | null>(null);
  // wave 33: while the agent works, show what it is doing (a silent button feels broken)
  useEffect(() => {
    if (!pending) return;
    const t0 = Date.now();
    const step = () => setStage(Math.min(3, Math.floor((Date.now() - t0) / 2600)));
    const first = window.setTimeout(step, 0);
    const id = window.setInterval(step, 500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [pending]);
  const stage = pending ? stageRaw : 0;
  if (!allowed) {
    return (
      <Card className="flex flex-wrap items-center gap-3 border-gold/30 p-4" data-testid="ai-edit-locked">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gold-soft text-gold">
          <Lock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{t("plans.locked.site_ai_editor.title")}</p>
          <p className="text-[12.5px] text-muted">{t("plans.locked.site_ai_editor.body", { plan: t("billing.plans.pro.name") })}</p>
        </div>
        <Link href={`/${locale}/billing`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent-solid px-3.5 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4" /> {t("plans.locked.cta", { plan: t("billing.plans.pro.name") })}
        </Link>
      </Card>
    );
  }
  const finish = (next: SiteValue, d: SiteDiff, instruction: string, base: SiteValue) => {
    setConflict(null);
    setEmpty(false);
    setPrev(base);
    onApply(next);
    setDiff(d);
    onApplied?.(d, next);
    setText("");
    writeHistory([instruction.trim(), ...parseHistory(rawHistory()).filter((x) => x !== instruction.trim())].slice(0, 5));
    toast.success(t("websites.aiEdit.applied"));
  };
  const run = (instruction: string) =>
    start(async () => {
      const base = value;
      setConflict(null);
      let r: Awaited<ReturnType<typeof aiEditSiteAction>>;
      try {
        r = await aiEditSiteAction({ locale, instruction, site: base, allowProTemplates: proTemplates });
      } catch {
        // wave 34: a dropped connection / platform time-out must never crash the editor — nothing was changed
        return void toast.error(t("websites.aiEdit.failed"));
      }
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      const next = { ...base, ...(r.data.site as unknown as Partial<SiteValue>), slug: base.slug, status: base.status } as SiteValue;
      const d = diffSites(base, next);
      // wave 33: an answer identical to the current site is reported — never a silent "success"
      if (d.empty) {
        setEmpty(true);
        setDiff(null);
        return void toast.info(t("websites.aiEdit.nothing"));
      }
      // wave 34: the owner edited while the agent was working — ask before replacing that work
      if (JSON.stringify(latest.current) !== JSON.stringify(base)) {
        setDiff(null);
        setConflict({ next, d, instruction });
        return;
      }
      finish(next, d, instruction, base);
    });
  return (
    <Card className="overflow-hidden border-accent/30" data-testid="ai-edit-panel">
      <div className="flex items-center gap-3 border-b border-line bg-accent-soft/40 px-4 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-solid text-accent-fg">
          <Wand2 className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">{t("websites.aiEdit.title")}</h2>
          <p className="text-[12.5px] text-muted">{t("websites.aiEdit.hint")}</p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} type="button" disabled={pending} onClick={() => run(t(`websites.aiEdit.quick.${q}`))} className="rounded-full border border-line px-3 py-1 text-[12.5px] hover:border-accent hover:text-accent disabled:opacity-50" data-quick={q}>
              {t(`websites.aiEdit.quickLabel.${q}`)}
            </button>
          ))}
        </div>
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !pending && text.trim().length >= 3) {
              e.preventDefault();
              run(text);
            }
          }}
          placeholder={t("websites.aiEdit.placeholder")}
          aria-label={t("websites.aiEdit.title")}
          maxLength={2000}
          data-testid="ai-edit-input"
        />
        {recent.length ? (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="ai-edit-recent">
            <span className="inline-flex items-center gap-1 text-[12px] text-subtle">
              <History className="h-3.5 w-3.5" /> {t("websites.aiEdit.recent")}
            </span>
            {recent.map((r) => (
              <button key={r} type="button" disabled={pending} onClick={() => setText(r)} title={r} className="max-w-[16rem] truncate rounded-full bg-surface-hover px-2.5 py-1 text-[12px] text-muted transition hover:text-fg disabled:opacity-50">
                {r}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button loading={pending} disabled={text.trim().length < 3} onClick={() => run(text)} data-testid="ai-edit-run">
            <Sparkles className="h-4 w-4" /> {t(pending ? "websites.aiEdit.working" : "websites.aiEdit.run")}
          </Button>
          {prev ? (
            <Button
              variant="ghost"
              onClick={() => {
                onApply(prev);
                setPrev(null);
                setDiff(null);
                setConflict(null);
                onUndone?.();
              }}
            >
              <Undo2 className="h-4 w-4" /> {t("websites.aiEdit.undo")}
            </Button>
          ) : null}
          <span className="text-[12px] text-subtle">{t("websites.aiEdit.note")}</span>
          <span className="ms-auto text-[11.5px] text-subtle" aria-hidden="true">
            {t("websites.aiEdit.shortcut")} · {text.length}/2000
          </span>
        </div>
        {pending ? (
          <div className="overflow-hidden rounded-xl border border-accent/30 bg-accent-soft/30 p-3" role="status" aria-live="polite" data-testid="ai-edit-working">
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-accent/15">
              <div className="h-full w-1/3 animate-[sccSlide_1.4s_ease-in-out_infinite] rounded-full bg-accent-solid" />
            </div>
            <ol className="space-y-1 text-[12.5px]">
              {([0, 1, 2, 3] as const).map((k) => (
                <li key={k} className={cn("flex items-center gap-2 transition-opacity", k > stage ? "opacity-35" : "opacity-100")}>
                  {k < stage ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : <span className={cn("h-3.5 w-3.5 rounded-full border border-accent/60", k === stage && "animate-pulse bg-accent/40")} />}
                  {t(`websites.aiEdit.stage${k}`)}
                </li>
              ))}
            </ol>
            <style>{`@keyframes sccSlide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}@media (prefers-reduced-motion:reduce){[data-testid="ai-edit-working"] .animate-pulse,[data-testid="ai-edit-working"] [class*="sccSlide"]{animation:none}}`}</style>
          </div>
        ) : null}
        {empty && !pending ? (
          <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-hover/50 p-3 text-[12.5px] text-muted" role="status" data-testid="ai-edit-nothing">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> {t("websites.aiEdit.nothingHint")}
          </p>
        ) : null}
        {conflict && !pending ? (
          <div className="rounded-xl border border-gold/40 bg-gold-soft/50 p-3" role="alert" data-testid="ai-edit-conflict">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold">
              <TriangleAlert className="h-4 w-4 text-gold" /> {t("websites.aiEdit.conflictTitle")}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">{t("websites.aiEdit.conflictBody")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => finish(conflict.next, conflict.d, conflict.instruction, latest.current)}>
                <Sparkles className="h-3.5 w-3.5" /> {t("websites.aiEdit.conflictApply")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConflict(null)}>
                {t("websites.aiEdit.conflictDiscard")}
              </Button>
            </div>
          </div>
        ) : null}
        {diff && !pending ? (
          <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-3" data-testid="ai-edit-changes">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold">
              <CheckCircle2 className="h-4 w-4 text-accent" /> {t("websites.aiEdit.changes")}
            </p>
            <div className="flex flex-wrap gap-1.5 text-[12px]">
              {diff.added ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-success">
                  <Plus className="h-3.5 w-3.5" /> {t("websites.aiEdit.added", { n: diff.added })}
                </span>
              ) : null}
              {diff.changed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-accent">
                  <Pencil className="h-3.5 w-3.5" /> {t("websites.aiEdit.changed", { n: diff.changed })}
                </span>
              ) : null}
              {diff.removed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2.5 py-1 text-danger">
                  <Minus className="h-3.5 w-3.5" /> {t("websites.aiEdit.removed", { n: diff.removed })}
                </span>
              ) : null}
              {diff.theme.length ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-1 text-muted">
                  <Palette className="h-3.5 w-3.5" /> {t("websites.aiEdit.design")}
                </span>
              ) : null}
              {diff.seo ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2.5 py-1 text-muted">
                  <Search className="h-3.5 w-3.5" /> SEO
                </span>
              ) : null}
            </div>
            {diff.blocks.some((c) => c.kind !== "removed") ? (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {diff.blocks
                  .filter((c) => c.kind !== "removed")
                  .map((c) => (
                    <li key={`${c.kind}-${c.index}`}>
                      <button type="button" onClick={() => onFocusBlock?.(c.index)} className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[12px] transition hover:-translate-y-px", c.kind === "added" ? "border-success/40 text-success" : "border-accent/40 text-accent")}>
                        {c.kind === "added" ? <Plus className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
                        {t(`websites.blocks.${c.type}`)} #{c.index + 1}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
            {diff.removed ? (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-danger/10 p-2 text-[12.5px] text-danger" role="alert" data-testid="ai-edit-removed-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {t("websites.aiEdit.removedWarn", { n: diff.removed })}
              </p>
            ) : null}
            {diff.blocks.some((c) => c.kind === "added") ? <p className="mt-2 text-[12px] text-subtle">{t("websites.aiEdit.fillIn")}</p> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
