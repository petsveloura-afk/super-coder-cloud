"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { aiEditSiteAction } from "@/app/[locale]/(dashboard)/websites/actions";
import { auditSite, combinedInstruction, type AuditCheck, type AuditTab } from "@/lib/site/audit-core";
import type { SiteValue } from "./site-builder";

/**
 * Wave 31 — "site health": a free score with concrete fixes. Each fix runs through the same
 * agent-edit engine as the quick actions (result lands in the editor, nothing is saved until
 * the owner saves; one-click undo). Manual items jump to the right tab.
 */
export function SiteAuditPanel({ value, onApply, onGoTab, allowed, proTemplates }: { value: SiteValue; onApply: (v: SiteValue) => void; onGoTab: (tab: AuditTab) => void; allowed: boolean; proTemplates: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [prev, setPrev] = useState<SiteValue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const result = useMemo(() => auditSite(value as never), [value]);
  const tone = result.score >= 80 ? "success" : result.score >= 55 ? "warning" : "danger";
  const run = (key: string, instruction: string) => {
    setBusy(key);
    start(async () => {
      const r = await aiEditSiteAction({ locale, instruction, site: value, allowProTemplates: proTemplates });
      setBusy(null);
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      setPrev(value);
      onApply({ ...value, ...(r.data.site as unknown as Partial<SiteValue>), slug: value.slug, status: value.status });
      toast.success(t("websites.aiEdit.applied"));
    });
  };
  const all = combinedInstruction(result);
  const circ = 2 * Math.PI * 22;
  const row = (c: AuditCheck) => (
    <li key={c.id} className="flex flex-wrap items-start gap-2 rounded-xl border border-line px-3 py-2" data-audit={c.id} data-ok={c.ok}>
      {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t(`websites.audit.checks.${c.id}.label`)}</p>
        {!c.ok ? <p className="text-[12.5px] text-muted">{t(`websites.audit.checks.${c.id}.hint`)}</p> : null}
      </div>
      {!c.ok && c.fix === "ai" && allowed && c.instruction ? (
        <Button size="sm" variant="secondary" loading={pending && busy === c.id} disabled={pending} onClick={() => run(c.id, c.instruction!)}>
          <Sparkles className="h-3.5 w-3.5" /> {t("websites.audit.fix")}
        </Button>
      ) : null}
      {!c.ok && c.fix === "manual" && c.tab ? (
        <Button size="sm" variant="ghost" onClick={() => onGoTab(c.tab!)}>
          {t("websites.audit.goFix")}
        </Button>
      ) : null}
    </li>
  );
  return (
    <Card className="overflow-hidden" data-testid="site-audit">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-start">
        <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true" className="shrink-0">
          <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="5" />
          <circle cx="26" cy="26" r="22" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(result.score / 100) * circ} ${circ}`} transform="rotate(-90 26 26)" className={tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger"} />
          <text x="26" y="30" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
            {result.score}
          </text>
        </svg>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{t("websites.audit.title")}</h2>
          <p className="text-[12.5px] text-muted">{result.failing.length ? t("websites.audit.summary", { count: result.failing.length }) : t("websites.audit.allGood")}</p>
        </div>
        <Badge tone={tone}>{t(`websites.audit.level.${tone}`)}</Badge>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-line p-4">
          <ul className="space-y-2">
            {[...result.failing, ...result.checks.filter((x) => x.ok)].map(row)}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {all && allowed ? (
              <Button loading={pending && busy === "all"} disabled={pending} onClick={() => run("all", all)} data-testid="audit-fix-all">
                <Sparkles className="h-4 w-4" /> {t("websites.audit.fixAll")}
              </Button>
            ) : null}
            {prev ? (
              <Button
                variant="ghost"
                onClick={() => {
                  onApply(prev);
                  setPrev(null);
                }}
              >
                <Undo2 className="h-4 w-4" /> {t("websites.aiEdit.undo")}
              </Button>
            ) : null}
            <span className="text-[12px] text-subtle">{t("websites.aiEdit.note")}</span>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
