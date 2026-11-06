"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { FolderOpen, ShieldCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Input } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { AUTO_FIXABLE, summarize, type BillingFlag, type BillingHealthRow } from "@/lib/billing/integrity-core";
import { billingFileAction, billingIntegrityAction } from "@/app/[locale]/(dashboard)/admin/actions";
import type { Locale } from "@/lib/i18n/config";

const TONE: Record<BillingFlag, "danger" | "warning" | "neutral"> = { paid_no_access: "danger", access_no_payment: "warning", past_due: "warning", period_passed: "warning", no_receipts: "neutral", over_limit: "neutral" };

interface FileData {
  organization?: { name?: string; plan?: string; created_at?: string };
  subscription?: { plan_key?: string; status?: string; provider?: string; current_period_end?: string | null; billing_interval?: string | null; cancel_at_period_end?: boolean } | null;
  payments?: { id: string; receipt_number: number; provider: string; plan_key: string | null; amount: number; currency: string; status: string; paid_at: string; meta?: { credit_pack?: string; credits?: number; domain?: string } }[];
  packs?: { id: string; pack: string; credits: number; amount: number; currency: string; status: string; created_at: string }[];
  usage?: { month: string; credits: number; calls: number }[];
  history?: { at: string; action: string; metadata?: Record<string, unknown> }[];
  pack_balance?: number;
  credits_month?: number;
  monthly_limit?: number | null;
}

export function AdminBillingHealthClient({ locale, rows, now }: { locale: Locale; rows: BillingHealthRow[]; now: number }) {
  const { t } = useI18n();
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [file, setFile] = useState<{ name: string; data: FileData | null } | null>(null);
  const s = useMemo(() => summarize(rows, now), [rows, now]);
  const shown = s.flagged.filter((f) => (!onlyIssues || f.flags.length > 0) && (!q || `${f.row.name} ${f.row.owner_email ?? ""}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 120);

  const openFile = (id: string, name: string) => {
    setFile({ name, data: null });
    start(async () => {
      const r = await billingFileAction(locale, id);
      if (r.error) {
        toast.error(t(r.error));
        setFile(null);
        return;
      }
      setFile({ name, data: (r.data?.file ?? {}) as FileData });
    });
  };

  return (
    <Card className="mb-4 overflow-hidden" data-testid="admin-billing-health">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldCheck className="h-4.5 w-4.5 text-accent" /> {t("admin.billingHealth.title")}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("admin.billingHealth.subtitle")}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
            <Badge>{t("admin.billingHealth.total", { n: s.total })}</Badge>
            <Badge tone="success">{t("admin.billingHealth.paying", { n: s.paying })}</Badge>
            <Badge tone={s.issues ? "warning" : "success"}>{t("admin.billingHealth.issues", { n: s.issues })}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.billingHealth.search")} className="h-9 w-48" aria-label={t("admin.billingHealth.search")} />
          <Button size="sm" variant="secondary" onClick={() => setOnlyIssues((v) => !v)} data-testid="billing-health-toggle">
            {t(onlyIssues ? "admin.billingHealth.showAll" : "admin.billingHealth.showIssues")}
          </Button>
          <Button
            size="sm"
            loading={pending && !file}
            data-testid="billing-health-fix"
            onClick={() =>
              start(async () => {
                const r = await billingIntegrityAction(locale);
                if (r.error) return void toast.error(t(r.error));
                const d = r.data!;
                toast.success(t("admin.billingHealth.fixed", { restored: d.restored, ended: d.manual_expired + d.past_due_expired + d.period_ended }));
              })
            }
          >
            <Wrench className="h-4 w-4" /> {t("admin.billingHealth.fix")}
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="p-4 text-[13px] text-subtle">{t(onlyIssues ? "admin.billingHealth.allGood" : "analytics.noData")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-[12.5px] text-muted">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-start font-medium">{t("admin.org")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.billingHealth.plan")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.billingHealth.subscription")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("admin.billingHealth.paid")}</th>
                <th className="px-4 py-2 text-end font-medium">{t("admin.billingHealth.credits")}</th>
                <th className="px-4 py-2 text-start font-medium">{t("admin.billingHealth.flags")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ row: r, flags }) => (
                <tr key={r.organization_id} className="border-b border-line/60 align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.owner_email ? (
                      <div className="text-[12px] text-subtle" dir="ltr">
                        {r.owner_email}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">{r.plan}</td>
                  <td className="px-4 py-2 text-[12.5px]">
                    {r.sub_status ? (
                      <>
                        {r.sub_plan} · {t(`admin.billingHealth.status.${r.sub_status}`)} · {r.sub_provider}
                        {r.period_end ? <div className="text-subtle">{t("admin.billingHealth.until", { date: formatDate(locale, r.period_end) })}</div> : null}
                      </>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums">
                    {r.payments > 0 && r.paid_currency ? formatCurrency(locale, r.paid_total, r.paid_currency) : "—"}
                    <div className="text-[12px] text-subtle">{t("admin.billingHealth.receipts", { n: r.payments })}</div>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums">
                    {formatNumber(locale, r.credits_month)} / {r.monthly_limit === null ? "∞" : formatNumber(locale, r.monthly_limit)}
                    {r.pack_balance > 0 ? <div className="text-[12px] text-subtle">+{formatNumber(locale, r.pack_balance)}</div> : null}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {flags.length === 0 ? <Badge tone="success">{t("admin.billingHealth.ok")}</Badge> : flags.map((f) => <Badge key={f} tone={TONE[f]}>{t(`admin.billingHealth.flag.${f}`)}{AUTO_FIXABLE.includes(f) ? " ⚙" : ""}</Badge>)}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-end">
                    <Button size="sm" variant="ghost" onClick={() => openFile(r.organization_id, r.name)} data-testid={`billing-file-${r.organization_id}`}>
                      <FolderOpen className="h-4 w-4" /> {t("admin.billingHealth.file")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!file} onOpenChange={(o) => !o && setFile(null)} title={t("admin.billingHealth.fileTitle", { name: file?.name ?? "" })} className="sm:max-w-2xl">
        {!file?.data ? (
          <p className="p-2 text-[13px] text-muted">{t("common.loading")}</p>
        ) : (
          <div className="space-y-4 text-[13px]" data-testid="billing-file">
            <section>
              <h3 className="mb-1 font-semibold">{t("admin.billingHealth.subscription")}</h3>
              {file.data.subscription ? (
                <p>
                  {file.data.subscription.plan_key} · {t(`admin.billingHealth.status.${file.data.subscription.status ?? "canceled"}`)} · {file.data.subscription.provider}
                  {file.data.subscription.billing_interval ? ` · ${t(file.data.subscription.billing_interval === "year" ? "billing.yearly" : "billing.monthly")}` : ""}
                  {file.data.subscription.current_period_end ? ` · ${t("admin.billingHealth.until", { date: formatDate(locale, file.data.subscription.current_period_end) })}` : ""}
                </p>
              ) : (
                <p className="text-subtle">{t("admin.billingHealth.noSubscription")}</p>
              )}
              <p className="mt-1 text-muted">
                {t("admin.billingHealth.creditsLine", { used: formatNumber(locale, Number(file.data.credits_month ?? 0)), limit: file.data.monthly_limit === null || file.data.monthly_limit === undefined ? "∞" : formatNumber(locale, Number(file.data.monthly_limit)), packs: formatNumber(locale, Number(file.data.pack_balance ?? 0)) })}
              </p>
            </section>
            <section>
              <h3 className="mb-1 font-semibold">{t("admin.billingHealth.payments")}</h3>
              {(file.data.payments ?? []).length === 0 ? (
                <p className="text-subtle">{t("admin.billingHealth.noPayments")}</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {(file.data.payments ?? []).map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>
                        #{p.receipt_number} · {formatDate(locale, p.paid_at)} · {p.meta?.credit_pack ? t("billing.pay.itemCredits", { n: formatNumber(locale, Number(p.meta.credits ?? 0)) }) : p.meta?.domain ? t("billing.pay.itemDomain", { domain: p.meta.domain }) : (p.plan_key ?? "—")} · {p.provider}
                        {p.status !== "paid" ? <Badge tone="warning" className="ms-1">{p.status}</Badge> : null}
                      </span>
                      <span className="flex items-center gap-3">
                        <b className="tabular-nums" dir="ltr">
                          {formatCurrency(locale, Number(p.amount), String(p.currency).toUpperCase())}
                        </b>
                        <Link href={`/${locale}/receipt/${p.id}`} target="_blank" className="text-accent hover:underline">
                          {t("admin.billingHealth.receipt")}
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {(file.data.packs ?? []).length ? (
              <section>
                <h3 className="mb-1 font-semibold">{t("admin.billingHealth.packs")}</h3>
                <ul className="space-y-1">
                  {(file.data.packs ?? []).map((c) => (
                    <li key={c.id}>
                      {formatDate(locale, c.created_at)} · {c.pack} · {formatNumber(locale, Number(c.credits))} · {formatCurrency(locale, Number(c.amount), String(c.currency).trim())} · {c.status}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {(file.data.usage ?? []).length ? (
              <section>
                <h3 className="mb-1 font-semibold">{t("admin.billingHealth.usage")}</h3>
                <div className="flex flex-wrap gap-2">
                  {(file.data.usage ?? []).map((u) => (
                    <Badge key={u.month}>
                      {u.month}: {formatNumber(locale, Number(u.credits))}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}
            {(file.data.history ?? []).length ? (
              <section>
                <h3 className="mb-1 font-semibold">{t("admin.billingHealth.history")}</h3>
                <ul className="space-y-1 text-muted">
                  {(file.data.history ?? []).slice(0, 15).map((h, i) => (
                    <li key={i}>
                      {formatDate(locale, h.at)} · {t(`admin.billingHealth.action.${h.action.replace("billing.", "")}`)} {h.metadata && typeof h.metadata.plan === "string" ? `· ${h.metadata.plan}` : ""}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
