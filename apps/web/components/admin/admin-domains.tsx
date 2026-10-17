import { Globe } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { getT } from "@/lib/i18n/server";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/lib/i18n/config";

/** Wave 13 — platform admin: domains bought through the platform, with cost, price and commission. */
export async function AdminDomains({ locale }: { locale: Locale }) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { t } = await getT(locale);
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { domainsConfigured } = await import("@/lib/site/domains");
  const { pricingFromEnv } = await import("@/lib/site/domain-core");
  const { data } = await createAdminClient().from("domain_orders").select("id, domain, status, cost, price, currency, error, created_at, organization_id").order("created_at", { ascending: false }).limit(30);
  const rows = (data ?? []) as { id: string; domain: string; status: string; cost: number; price: number; currency: string; error: string | null; created_at: string }[];
  const active = rows.filter((r) => r.status === "active");
  const profit = active.reduce((s, r) => s + Number(r.price) - Number(r.cost), 0);
  const p = pricingFromEnv();
  const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
  return (
    <Card className="mb-4 overflow-hidden" data-testid="admin-domains">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <Globe className="h-5 w-5 text-accent" />
        <h2 className="font-semibold">{t("admin.domains.title")}</h2>
        <Badge tone={domainsConfigured() ? "success" : "warning"}>{t(domainsConfigured() ? "admin.domains.on" : "admin.domains.off")}</Badge>
        <span className="flex-1" />
        <span className="text-[13px] text-muted">
          {t("admin.domains.summary", { count: active.length, profit: usd(profit), markup: p.markupPercent, min: usd(p.minFee) })}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-subtle">{t("admin.domains.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[13px]">
            <thead className="bg-surface-hover text-muted">
              <tr>
                <th className="px-4 py-2 text-start font-medium">{t("admin.domains.domain")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.domains.status")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("admin.domains.cost")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("admin.domains.price")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("admin.domains.profit")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.domains.date")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-4 py-2 font-medium" dir="ltr">
                    {r.domain}
                    {r.error ? <span className="block text-[11px] text-danger">{r.error}</span> : null}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={r.status === "active" ? "success" : r.status === "failed" ? "danger" : "neutral"}>{t(`websites.domain.orderStatus.${r.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums">{usd(Number(r.cost))}</td>
                  <td className="px-4 py-2 text-end tabular-nums">{usd(Number(r.price))}</td>
                  <td className="px-4 py-2 text-end font-semibold tabular-nums">{r.status === "active" ? usd(Number(r.price) - Number(r.cost)) : "—"}</td>
                  <td className="px-4 py-2 text-muted">{formatDate(locale, r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
