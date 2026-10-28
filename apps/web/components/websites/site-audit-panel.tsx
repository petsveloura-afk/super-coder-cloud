"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, Sparkles, Undo2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { aiEditSiteAction } from "@/app/[locale]/(dashboard)/websites/actions";
import { auditSite, combinedInstruction, type AuditCheck, type AuditTab } from "@/lib/site/audit-core";
import { applyQuickFix, quickFixReady, type QuickValues } from "@/lib/site/quick-fix";
import { diffSites, type SiteDiff } from "@/lib/site/diff";
import type { SiteValue } from "./site-builder";

/**
 * Wave 31 — "site health": a free score with concrete fixes. Each fix runs through the same
 * agent-edit engine as the quick actions (result lands in the editor, nothing is saved until
 * the owner saves; one-click undo).
 * Wave 37 — the items the agent cannot know (phone, e-mail, logo, legal name, hero image, a form)
 * are fixed right here: type the detail, press apply, done. No more hunting for the right tab.
 */
export function SiteAuditPanel({ value, onApply, onGoTab, allowed, proTemplates, onApplied, forms = [], bookings = [] }: { value: SiteValue; onApply: (v: SiteValue) => void; onGoTab: (tab: AuditTab) => void; allowed: boolean; proTemplates: boolean; /** wave 34: highlight + live preview, exactly like the agent panel */ onApplied?: (diff: SiteDiff, next: SiteValue) => void; forms?: { slug: string; name: string }[]; bookings?: { slug: string; name: string }[] }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [prev, setPrev] = useState<SiteValue | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [qv, setQv] = useState<QuickValues>({});
  const [pending, start] = useTransition();
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  const result = useMemo(() => auditSite(value as never), [value]);
  const tone = result.score >= 80 ? "success" : result.score >= 55 ? "warning" : "danger";
  const run = (key: string, instruction: string) => {
    setBusy(key);
    start(async () => {
      const base = value;
      let r: Awaited<ReturnType<typeof aiEditSiteAction>>;
      try {
        r = await aiEditSiteAction({ locale, instruction, site: base, allowProTemplates: proTemplates });
      } catch {
        setBusy(null);
        return void toast.error(t("websites.aiEdit.failed"));
      }
      setBusy(null);
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      const next = { ...base, ...(r.data.site as unknown as Partial<SiteValue>), slug: base.slug, status: base.status } as SiteValue;
      const d = diffSites(base, next);
      if (d.empty) return void toast.info(t("websites.aiEdit.nothing"));
      // the owner kept editing while the agent worked — never overwrite that silently
      if (JSON.stringify(latest.current) !== JSON.stringify(base)) return void toast.error(t("websites.aiEdit.conflictTitle"), { description: t("websites.aiEdit.conflictBody") });
      setPrev(base);
      onApply(next);
      onApplied?.(d, next);
      toast.success(t("websites.aiEdit.applied"));
    });
  };
  /** wave 37: the manual fix, done here — pure function builds the new site, same highlight + undo as the agent */
  const quick = (c: AuditCheck) => {
    if (!c.quick) return;
    const r = applyQuickFix(value as never, c.quick, qv, { forms, bookings });
    if (!r.ok) return void toast.error(t(`websites.pro37.quick.err.${r.error}`));
    const next = r.site as unknown as SiteValue;
    setPrev(value);
    onApply(next);
    const d = diffSites(value, next);
    if (!d.empty) onApplied?.(d, next);
    setQv({});
    toast.success(t("websites.pro37.quick.applied"));
  };
  /** the "go there" button now also scrolls to the exact field */
  const goFix = (c: AuditCheck) => {
    onGoTab(c.tab!);
    if (c.id === "hero_image") {
      const i = value.blocks.findIndex((b) => b.type === "hero");
      window.setTimeout(() => {
        const el = document.getElementById(`bl-${i}-image_url`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        (el as HTMLInputElement | null)?.focus({ preventScroll: true });
      }, 120);
    }
  };
  const all = combinedInstruction(result);
  const circ = 2 * Math.PI * 22;
  const set = (k: string, v: string) => setQv((x) => ({ ...x, [k]: v }));
  const field = (k: string, label: string, opts: { ltr?: boolean; type?: string; placeholder?: string } = {}) => (
    <label key={k} className="block min-w-[10rem] flex-1 text-[12px] text-muted">
      {label}
      <Input value={qv[k] ?? ""} onChange={(e) => set(k, e.target.value)} dir={opts.ltr ? "ltr" : undefined} type={opts.type} placeholder={opts.placeholder} className="mt-1 h-9" data-quick={k} />
    </label>
  );
  const quickForm = (c: AuditCheck) => {
    const kind = c.quick!;
    const noOptions = kind === "lead" && !forms.length && !bookings.length;
    return (
      <div className="mt-2 flex w-full flex-wrap items-end gap-2 rounded-xl bg-elevated p-3" data-quickfix={kind}>
        {kind === "contact" ? (
          <>
            {field("phone", t("websites.pro37.quick.phone"), { ltr: true, type: "tel" })}
            {field("email", t("websites.pro37.quick.email"), { ltr: true, type: "email" })}
          </>
        ) : null}
        {kind === "brand" ? (
          <>
            {field("tagline", t("websites.pro37.quick.tagline"))}
            {field("logo_url", t("websites.pro37.quick.logo"), { ltr: true, placeholder: "https://" })}
          </>
        ) : null}
        {kind === "legal" ? (
          <>
            {field("legal_name", t("websites.pro37.quick.legalName"))}
            {!(value.settings?.phone || value.settings?.email) ? field("phone", t("websites.pro37.quick.phone"), { ltr: true, type: "tel" }) : null}
          </>
        ) : null}
        {kind === "hero_image" ? field("image_url", t("websites.pro37.quick.imageUrl"), { ltr: true, placeholder: "https://" }) : null}
        {kind === "lead" ? (
          noOptions ? (
            <p className="flex-1 text-[12.5px] text-muted">
              {t("websites.pro37.quick.noForms")}{" "}
              <a href={`/${locale}/forms`} className="font-semibold text-accent hover:underline">
                {t("websites.pro37.quick.createForm")}
              </a>
            </p>
          ) : (
            <label className="block min-w-[12rem] flex-1 text-[12px] text-muted">
              {t("websites.pro37.quick.pickLead")}
              <Select value={qv.lead ?? ""} onChange={(e) => set("lead", e.target.value)} className="mt-1 h-9" data-quick="lead">
                <option value="">{t("websites.pickForm")}</option>
                {forms.map((f) => (
                  <option key={`f:${f.slug}`} value={`form:${f.slug}`}>
                    {f.name}
                  </option>
                ))}
                {bookings.map((b) => (
                  <option key={`b:${b.slug}`} value={`booking:${b.slug}`}>
                    {t("websites.blocks.booking")}: {b.name}
                  </option>
                ))}
              </Select>
            </label>
          )
        ) : null}
        {!noOptions ? (
          <Button size="sm" disabled={!quickFixReady(kind, qv, { hasContactInfo: Boolean(value.settings?.phone || value.settings?.email) })} onClick={() => quick(c)} data-testid={`quick-apply-${kind}`}>
            <Wrench className="h-3.5 w-3.5" /> {t("websites.pro37.quick.apply")}
          </Button>
        ) : null}
      </div>
    );
  };
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
        <Button size="sm" variant="ghost" onClick={() => goFix(c)}>
          {t("websites.audit.goFix")}
        </Button>
      ) : null}
      {!c.ok && c.fix === "manual" && c.quick ? quickForm(c) : null}
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
          <ul className="space-y-2">{[...result.failing, ...result.checks.filter((x) => x.ok)].map(row)}</ul>
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
