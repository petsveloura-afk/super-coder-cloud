"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Globe2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { applySiteImportAction, importSiteAction } from "@/app/[locale]/(dashboard)/ai-agents/growth-actions";
import type { AgentProfile } from "@/lib/ai/autopilot-core";

const FIELD_KEYS = ["business", "services", "hours", "location", "phone", "faq", "pricing", "flow", "fields", "menu"] as const;

/**
 * Wave 59 — set the agent up from the business's website in a minute: paste the address → the agent reads the
 * site → preview what was found → "add to the agent" fills only what is still empty (nothing is overwritten).
 */
export function SiteImportCard({ agentId, website }: { agentId: string; website: string }) {
  const { t, locale } = useI18n();
  const [url, setUrl] = useState(website);
  const [found, setFound] = useState<Partial<AgentProfile> | null>(null);
  const [pending, start] = useTransition();
  const [applying, startApply] = useTransition();
  const read = () =>
    start(async () => {
      setFound(null);
      const r = await importSiteAction({ locale, agentId, url });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "siteImport.aiFailed"));
      setFound(r.data.profile);
      toast.success(t("siteImport.found", { n: String(Object.keys(r.data.profile).length), pages: String(r.data.pages) }));
    });
  const apply = () =>
    startApply(async () => {
      if (!found) return;
      const r = await applySiteImportAction({ locale, agentId, url, profile: found });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "siteImport.applied", { n: String(r.data?.filled.length ?? 0) }));
      if (r.data?.filled.length) window.location.reload();
    });
  const preview = (v: unknown) => (Array.isArray(v) ? v.join(" · ") : String(v ?? "")).replace(/\s+/g, " ").slice(0, 160);
  return (
    <div className="space-y-3 p-5" data-testid="site-import">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`site-import-${agentId}`} className="sr-only">
          {t("siteImport.urlLabel")}
        </label>
        <div className="relative flex-1">
          <Globe2 className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input id={`site-import-${agentId}`} dir="ltr" inputMode="url" placeholder="www.my-business.co.il" value={url} onChange={(e) => setUrl(e.target.value)} className="ps-9" />
        </div>
        <Button onClick={read} loading={pending} disabled={url.trim().length < 4} data-testid="site-import-read">
          <Sparkles className="h-4 w-4" aria-hidden /> {t("siteImport.read")}
        </Button>
      </div>
      <p className="text-[12.5px] text-muted">{t("siteImport.hint")}</p>
      {pending ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-xl bg-elevated" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      ) : null}
      {found ? (
        <div className="space-y-2 rounded-2xl border border-accent/30 bg-accent-soft/30 p-3" data-testid="site-import-preview">
          <ul className="stagger space-y-1.5">
            {FIELD_KEYS.filter((k) => found[k] !== undefined).map((k) => (
              <li key={k} className="flex gap-2 text-[13px]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                <span className="min-w-0">
                  <span className="font-semibold">{t(`siteImport.fields.${k}`)}: </span>
                  <span className="text-muted" dir="auto">
                    {preview(found[k])}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" onClick={apply} loading={applying} data-testid="site-import-apply">
              <Wand2 className="h-4 w-4" aria-hidden /> {t("siteImport.apply")}
            </Button>
            <span className="text-[12px] text-muted">{t("siteImport.applyHint")}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
