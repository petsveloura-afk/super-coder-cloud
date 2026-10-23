"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { grantCreditsAction, loadOrgOverridesAction, saveOverridesAction, type OrgOverrides } from "@/app/[locale]/(dashboard)/admin/growth-actions";

const LIMIT_KEYS = ["contacts", "members", "ai_credits_monthly", "ai_agents", "notify_recipients"] as const;
const PRICE_KEYS = ["month", "year", "month_usd", "year_usd"] as const;

/** Wave 18 — per-organization quotas, custom price and AI credits (platform admin). */
export function AdminOverrides() {
  const { t, locale } = useI18n();
  const [key, setKey] = useState("");
  const [o, setO] = useState<OrgOverrides | null>(null);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, Record<string, string>>>({});
  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await loadOrgOverridesAction({ locale, org: key });
      if (r.error || !r.data) {
        toast.error(t(r.error ?? "errors.notFound"));
        return;
      }
      setO(r.data);
      setLimits(Object.fromEntries(LIMIT_KEYS.map((k) => [k, r.data!.limit_overrides[k] !== undefined ? String(r.data!.limit_overrides[k]) : ""])));
      setPrices(Object.fromEntries((["pro", "business"] as const).map((p) => [p, Object.fromEntries(PRICE_KEYS.map((iv) => [iv, r.data!.price_overrides[p]?.[iv] !== undefined ? String(r.data!.price_overrides[p]![iv]) : ""]))])));
    });

  return (
    <Card className="mb-4 space-y-4 p-5" data-testid="admin-overrides">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-accent" /> {t("admin.overridesTitle")}
        </h2>
        <p className="mt-1 text-[13px] text-muted">{t("admin.overridesHint")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("admin.orgSlugOrId")} htmlFor="ov-org" className="min-w-[240px] flex-1">
          <Input id="ov-org" dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} placeholder="my-business" />
        </Field>
        <Button variant="secondary" onClick={load} loading={pending} disabled={!key.trim()}>
          {t("admin.load")}
        </Button>
      </div>
      {o ? (
        <div className="space-y-4">
          <p className="text-[13px]">
            <strong>{o.name}</strong> · <span dir="ltr">{o.slug}</span> · {t("admin.plan")}: {o.plan} · {t("credits.balance", { n: o.balance })}
          </p>
          <div>
            <p className="mb-2 text-[13px] font-medium">{t("admin.limitOverrides")}</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {LIMIT_KEYS.map((k) => (
                <Field key={k} label={t(`admin.limits.${k}`)} htmlFor={`ov-l-${k}`}>
                  <Input id={`ov-l-${k}`} type="number" min={-1} value={limits[k] ?? ""} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} placeholder={t("admin.fromPlan")} />
                </Field>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-subtle">{t("admin.limitOverridesHint")}</p>
          </div>
          <div>
            <p className="mb-2 text-[13px] font-medium">{t("admin.priceOverrides")}</p>
            {(["pro", "business"] as const).map((p) => (
              <div key={p} className="mb-2 grid gap-3 sm:grid-cols-5">
                <span className="self-center text-[13px] font-medium">{t(`billing.plans.${p}.name`)}</span>
                {PRICE_KEYS.map((iv) => (
                  <Field key={iv} label={t(`admin.priceKeys.${iv}`)} htmlFor={`ov-p-${p}-${iv}`}>
                    <Input id={`ov-p-${p}-${iv}`} type="number" min={0} step="0.01" value={prices[p]?.[iv] ?? ""} onChange={(e) => setPrices({ ...prices, [p]: { ...(prices[p] ?? {}), [iv]: e.target.value } })} placeholder={t("admin.fromPlan")} />
                  </Field>
                ))}
              </div>
            ))}
            <p className="text-[12px] text-subtle">{t("admin.priceOverridesHint")}</p>
          </div>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await saveOverridesAction({ locale, org: o.id, limits, prices });
                if (r.error) toast.error(t(r.error));
                else toast.success(t(r.message ?? "common.saved"));
              })
            }
          >
            {t("common.save")}
          </Button>
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <Field label={t("admin.grantCredits")} htmlFor="ov-cr" className="w-40">
              <Input id="ov-cr" type="number" value={credits} onChange={(e) => setCredits(e.target.value)} placeholder="500" />
            </Field>
            <Field label={t("admin.note")} htmlFor="ov-note" className="min-w-[200px] flex-1">
              <Input id="ov-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} />
            </Field>
            <Button
              variant="secondary"
              loading={pending}
              disabled={!Number(credits)}
              onClick={() =>
                start(async () => {
                  const r = await grantCreditsAction({ locale, org: o.id, credits: Number(credits), note });
                  if (r.error) toast.error(t(r.error));
                  else {
                    toast.success(t(r.message ?? "common.saved"));
                    setO({ ...o, balance: r.data?.balance ?? o.balance });
                    setCredits("");
                    setNote("");
                  }
                })
              }
            >
              {t("admin.grant")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
