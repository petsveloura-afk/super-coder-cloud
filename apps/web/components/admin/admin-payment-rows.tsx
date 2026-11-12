"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { formatCurrency, formatDate } from "@/lib/format";
import { deletePaymentsAction, voidPaymentsAction } from "@/app/[locale]/(dashboard)/admin/payment-actions";

export interface AdminPaymentRow {
  id: string;
  provider: string;
  plan_key: string | null;
  amount: number;
  currency: string;
  receipt_number: number;
  paid_at: string;
  status: string;
  payer_email?: string | null;
  payer_name?: string | null;
  org_name?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Round 12 — the platform admin's latest payments with selection: void (recommended — kept in the books, no longer counted)
 * or delete for good (test payments — typing DELETE confirms; a copy goes to the audit log first).
 */
export function AdminPaymentRows({ rows }: { rows: AdminPaymentRow[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<null | "delete">(null);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const toggle = (id: string) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const act = (fn: () => Promise<{ error?: string; message?: string; messageParams?: Record<string, string | number> }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) return void toast.error(t(r.error, r.messageParams));
      toast.success(t(r.message ?? "common.saved", r.messageParams));
      setSel(new Set());
      setMode(null);
      setTyped("");
      router.refresh();
    });
  const ids = [...sel];
  return (
    <div className="border-t border-line" data-testid="admin-payment-rows">
      {ids.length ? (
        <div className="flex flex-wrap items-center gap-2 bg-elevated px-5 py-2.5 text-[13px]">
          <span className="font-semibold">{t("admin.payments.selected", { n: ids.length })}</span>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => voidPaymentsAction({ locale, ids }))} data-testid="payments-void">
            <Ban className="h-3.5 w-3.5" /> {t("admin.payments.void")}
          </Button>
          {mode === "delete" ? (
            <span className="flex flex-wrap items-center gap-2">
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" dir="ltr" className="h-8 w-28" aria-label={t("admin.payments.typeDelete")} />
              <Button size="sm" variant="ghost" className="text-danger" disabled={pending || typed.trim().toUpperCase() !== "DELETE"} onClick={() => act(() => deletePaymentsAction({ locale, ids, confirm: typed }))} data-testid="payments-delete-confirm">
                <Trash2 className="h-3.5 w-3.5" /> {t("admin.payments.deleteForever")}
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="text-danger" disabled={pending} onClick={() => setMode("delete")} data-testid="payments-delete">
              <Trash2 className="h-3.5 w-3.5" /> {t("admin.payments.delete")}
            </Button>
          )}
          <span className="w-full text-[11.5px] text-subtle">{t("admin.payments.deleteHint")}</span>
        </div>
      ) : null}
      <ul className="max-h-96 divide-y divide-line overflow-y-auto">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[13px] transition-colors hover:bg-surface-hover">
            <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={t("admin.payments.selectOne", { n: r.receipt_number })} className="h-4 w-4 accent-[var(--accent)]" />
            <span className="font-mono text-muted">#{r.receipt_number}</span>
            <span className="text-muted">{formatDate(locale, r.paid_at)}</span>
            <span className="min-w-0 truncate">{r.org_name ?? "—"}</span>
            <span className="text-muted">{typeof r.meta?.credits === "number" ? t("admin.payments.credits", { n: r.meta.credits as number }) : (r.plan_key ?? "—")}</span>
            {r.payer_email ? <span className="truncate text-subtle" dir="ltr">{r.payer_email}</span> : null}
            <span className="text-subtle">{t(`billing.pay.providers.${r.provider}`)}</span>
            {r.status !== "paid" ? <Badge tone={r.status === "refunded" ? "warning" : "neutral"}>{t(`admin.payments.status.${r.status}`)}</Badge> : null}
            <span className="ms-auto font-semibold tabular-nums" dir="ltr">
              {formatCurrency(locale, Number(r.amount), r.currency.toUpperCase())}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
