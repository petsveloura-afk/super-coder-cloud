"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Lock, Sparkles, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Textarea } from "@/components/ui/primitives";
import { aiEditSiteAction } from "@/app/[locale]/(dashboard)/websites/actions";
import type { SiteValue } from "./site-builder";

/**
 * Wave 13 — "tell the agent what to change": the AI rewrites texts, adds sections,
 * restyles the site or switches the template. The result lands in the editor (not
 * saved) so the business reviews it and saves / publishes; one-click undo.
 */
const QUICK = ["modern", "testimonials", "pricing", "shorter", "luxury", "stats", "steps", "english", "faq", "seo", "cta", "trust", "arabic", "hebrew"] as const;

export function AiEditPanel({ value, onApply, allowed, proTemplates }: { value: SiteValue; onApply: (v: SiteValue) => void; allowed: boolean; proTemplates: boolean }) {
  const { t, locale } = useI18n();
  const [text, setText] = useState("");
  const [prev, setPrev] = useState<SiteValue | null>(null);
  const [pending, start] = useTransition();
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
  const run = (instruction: string) =>
    start(async () => {
      const r = await aiEditSiteAction({ locale, instruction, site: value, allowProTemplates: proTemplates });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      setPrev(value);
      onApply({ ...value, ...(r.data.site as unknown as Partial<SiteValue>), slug: value.slug, status: value.status });
      setText("");
      toast.success(t("websites.aiEdit.applied"));
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
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("websites.aiEdit.placeholder")} aria-label={t("websites.aiEdit.title")} maxLength={2000} data-testid="ai-edit-input" />
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
              }}
            >
              <Undo2 className="h-4 w-4" /> {t("websites.aiEdit.undo")}
            </Button>
          ) : null}
          <span className="text-[12px] text-subtle">{t("websites.aiEdit.note")}</span>
        </div>
      </div>
    </Card>
  );
}
