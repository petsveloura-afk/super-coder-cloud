"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImageIcon, Lock, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Select, Textarea } from "@/components/ui/primitives";
import { ALL_TEMPLATES } from "@/lib/site/templates";
import { SECTION_KEYS, STYLE_KEYS, type SectionKey, type StyleKey } from "@/lib/ai/site-build-rules";
import { cn } from "@/lib/utils";
import { buildSiteWithAIAction } from "@/app/[locale]/(dashboard)/websites/actions";

/** what the site agent is doing right now — its tools in order (shown while it builds, ~every 7 seconds) */
const BUILD_STAGES = ["facts", "copy", "design", "quality", "images", "save"] as const;
function BuildStages() {
  const { t } = useI18n();
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStage((s) => Math.min(BUILD_STAGES.length - 1, s + 1)), 7000);
    return () => clearInterval(id);
  }, []);
  return (
    <ol className="grid gap-1.5 rounded-2xl border border-accent/25 bg-accent-soft/30 p-3 sm:grid-cols-2" aria-live="polite" data-testid="site-build-stages">
      {BUILD_STAGES.map((k, i) => (
        <li key={k} className={cn("flex items-center gap-2 text-[12.5px] transition", i < stage ? "text-success" : i === stage ? "font-semibold text-fg" : "text-subtle")}>
          {i < stage ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className={cn("h-2 w-2 rounded-full", i === stage ? "animate-pulse bg-accent" : "bg-line-strong")} />}
          {t(`websites.buildStages.${k}`)}
        </li>
      ))}
    </ol>
  );
}

/** "Describe your business → get a professional site" (draft). Full sites + AI images on paid plans. */
export function AiSiteCard({ caps }: { caps: { full: boolean; images: boolean; proTemplates?: boolean } }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [full, setFull] = useState(caps.full);
  const [template, setTemplate] = useState("");
  // wave 36: tell the agent exactly what you want (written to the brief as a structured block it follows)
  const [style, setStyle] = useState<StyleKey | "">("");
  const [must, setMust] = useState<SectionKey[]>([]);
  const [mode, setMode] = useState<"" | "dark" | "light">("");
  const [anim, setAnim] = useState(true);
  const prefs = [style ? `Style: ${style}` : "", must.length ? `Must include: ${must.join(", ")}` : "", mode ? `Mode: ${mode}` : "", `Animations: ${anim ? "yes" : "no"}`].filter(Boolean).join("\n");
  const chip = (on: boolean) => cn("min-h-10 rounded-full border px-3.5 text-[13px] transition", on ? "border-accent bg-accent-soft font-medium text-accent" : "border-line text-muted hover:border-accent");
  const [pending, start] = useTransition();
  return (
    <Card className="shine-border mb-4 overflow-hidden border-accent/30" data-testid="ai-site-card">
      <div className="hero-mesh flex items-center gap-3 border-b border-line px-5 py-3">
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
            {ALL_TEMPLATES.map((x) => (
              <option key={x.key} value={x.key} disabled={x.pro && !caps.proTemplates}>
                {(locale === "he" ? x.he : x.en).name}
                {x.pro && !caps.proTemplates ? " · Pro" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <details className="rounded-xl border border-line p-3" data-testid="ai-prefs">
          <summary className="cursor-pointer text-sm font-medium">{t("websites.aiPrefs.title")}</summary>
          <div className="mt-3 space-y-3">
            <div>
              <p className="mb-1.5 text-[12.5px] text-muted">{t("websites.aiPrefs.style")}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("websites.aiPrefs.style")}>
                {STYLE_KEYS.map((k) => (
                  <button key={k} type="button" aria-pressed={style === k} className={chip(style === k)} onClick={() => setStyle(style === k ? "" : k)}>
                    {t(`websites.aiPrefs.styles.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[12.5px] text-muted">{t("websites.aiPrefs.sections")}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("websites.aiPrefs.sections")}>
                {SECTION_KEYS.map((k) => (
                  <button key={k} type="button" aria-pressed={must.includes(k)} className={chip(must.includes(k))} onClick={() => setMust(must.includes(k) ? must.filter((x) => x !== k) : [...must, k])}>
                    {t(`websites.aiPrefs.secs.${k}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(["", "dark", "light"] as const).map((m) => (
                <button key={m || "auto"} type="button" aria-pressed={mode === m} className={chip(mode === m)} onClick={() => setMode(m)}>
                  {t(m === "" ? "websites.aiPrefs.modeAuto" : m === "dark" ? "common.dark" : "common.light")}
                </button>
              ))}
              <button type="button" aria-pressed={anim} className={chip(anim)} onClick={() => setAnim(!anim)}>
                {t("websites.aiPrefs.animated")}
              </button>
            </div>
          </div>
        </details>
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
                const r = await buildSiteWithAIAction({ locale, brief: `${brief.trim().slice(0, 2700)}\n\nPreferences:\n${prefs}`, full, template: template || undefined });
                if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
                toast.success(t(r.message ?? "ai.siteBuilt", r.messageParams));
                router.push(`/${locale}/websites/${r.data.id}/preview`);
              })
            }
          >
            <Sparkles className="h-4 w-4" /> {t(pending ? "websites.aiBuilding" : "websites.aiBuild")}
          </Button>
        </div>
        {pending ? <BuildStages /> : null}
      </div>
    </Card>
  );
}
