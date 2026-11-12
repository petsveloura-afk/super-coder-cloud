"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { previewCompanySyncAction, runCompanySyncAction } from "@/app/[locale]/(dashboard)/companies/sync-actions";
import type { CompanySuggestion } from "@/lib/crm/companies-core";

/**
 * Round 12 — "Find companies in my contacts": shows the companies that the contacts point to (company name / business
 * e-mail domain) and creates + links them in one click. Contacts that already have a company are never changed.
 */
export function CompanySync() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [plan, setPlan] = useState<{ create: CompanySuggestion[]; link: number } | null>(null);
  const [pending, start] = useTransition();
  const preview = () =>
    start(async () => {
      const r = await previewCompanySyncAction({ locale });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      if (!r.data.create.length && !r.data.link) return void toast.success(t("companies.sync.nothing"));
      setPlan(r.data);
    });
  const runIt = () =>
    start(async () => {
      const r = await runCompanySyncAction({ locale });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved", r.messageParams));
      setPlan(null);
      router.refresh();
    });
  return (
    <div data-testid="company-sync">
      {!plan ? (
        <Button variant="secondary" loading={pending} onClick={preview} data-testid="company-sync-open">
          <Sparkles className="h-4 w-4" /> {t("companies.sync.find")}
        </Button>
      ) : (
        <div className="fade-slide mt-3 rounded-2xl border border-accent/30 bg-accent-soft/30 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-accent" />
            <p className="flex-1 text-[13px] font-semibold">{t("companies.sync.found", { n: plan.create.length, link: plan.link })}</p>
            <button type="button" className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-hover" aria-label={t("common.cancel")} onClick={() => setPlan(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {plan.create.length ? (
            <ul className="mb-3 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {plan.create.slice(0, 40).map((c) => (
                <li key={c.key} className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px]">
                  {c.name} <span className="text-subtle">· {c.contactIds.length}</span>
                </li>
              ))}
              {plan.create.length > 40 ? <li className="px-2 py-1 text-[12px] text-subtle">+{plan.create.length - 40}</li> : null}
            </ul>
          ) : null}
          <Button size="sm" loading={pending} onClick={runIt} data-testid="company-sync-run">
            {t("companies.sync.run")}
          </Button>
        </div>
      )}
    </div>
  );
}
