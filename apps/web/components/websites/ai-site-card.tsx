"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Lock, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Select, Textarea } from "@/components/ui/primitives";
import { TEMPLATES } from "@/lib/site/templates";
import { buildSiteWithAIAction } from "@/app/[locale]/(dashboard)/websites/actions";

/** "Describe your business → get a professional site" (draft). Full sites + AI images on paid plans. */
export function AiSiteCard({ caps }: { caps: { full: boolean; images: boolean; proTemplates?: boolean } }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [full, setFull] = useState(caps.full);
  const [template, setTemplate] = useState("");
  const [pending, start] = useTransition();
  return (
    <Card className="mb-4 overflow-hidden border-accent/30" data-testid="ai-site-card">
      <div className="flex items-center gap-3 border-b border-line bg-accent-soft/40 px-5 py-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-solid text-accent-fg">
          <Wand2 className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-semibold">{t("websites.aiTitle")}</h2>
          <p className="text-[12.5px] text-muted">{t("websites.aiHint")}</p>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <Field label={t("websites.aiBrief")} htmlFor="ai-brief" hint={t("websites.aiBriefHint")}>
          <Textarea id="ai-brief" rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={t("websites.aiBriefPlaceholder")} />
        </Field>
        <Field label={t("websites.design.pickForAi")} htmlFor="ai-template">
          <Select id="ai-template" value={template} onChange={(e) => setTemplate(e.target.value)} data-testid="ai-template">
            <option value="">{t("websites.design.aiChooses")}</option>
            {TEMPLATES.map((x) => (
              <option key={x.key} value={x.key} disabled={x.pro && !caps.proTemplates}>
                {(locale === "he" ? x.he : x.en).name}
                {x.pro && !caps.proTemplates ? " · Pro" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <label className={`flex items-center gap-2 ${caps.full ? "" : "opacity-60"}`}>
            <input type="checkbox" checked={full && caps.full} disabled={!caps.full} onChange={(e) => setFull(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            {t("websites.aiFull")}
            {!caps.full ? <Lock className="h-3.5 w-3.5" /> : null}
          </label>
          <span className="inline-flex items-center gap-1 text-muted">
            <ImageIcon className="h-3.5 w-3.5" /> {t(caps.images ? "websites.aiWithImage" : "websites.aiImagesPaid")}
          </span>
          <span className="flex-1" />
          <Button
            loading={pending}
            disabled={brief.trim().length < 10}
            onClick={() =>
              start(async () => {
                const r = await buildSiteWithAIAction({ locale, brief, full, template: template || undefined });
                if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
                toast.success(t("ai.siteBuilt"));
                router.push(`/${locale}/websites/${r.data.id}/preview`);
              })
            }
          >
            <Sparkles className="h-4 w-4" /> {t(pending ? "websites.aiBuilding" : "websites.aiBuild")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
