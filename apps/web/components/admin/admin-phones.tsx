"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, CardHeader, Input, Select } from "@/components/ui/primitives";
import { adminAssignPhoneAction, adminBuyPhoneAction, adminReleasePhoneAction } from "@/app/[locale]/(dashboard)/admin/phone-actions";

/**
 * Wave 57 — platform admin: phone numbers for businesses from the platform's Twilio account.
 * Buy one automatically, or assign a number that already exists in the account (e.g. an Israeli number
 * that needed paperwork), or take it back.
 */
export function AdminPhones({ orgs }: { orgs: { id: string; name: string; plan: string }[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [org, setOrg] = useState(orgs.find((o) => o.plan === "business" || o.plan === "enterprise")?.id ?? orgs[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      router.refresh();
    });
  if (!orgs.length) return null;
  return (
    <Card className="mb-4" data-testid="admin-phones">
      <CardHeader title={t("phone.admin.title")} description={t("phone.admin.subtitle")} />
      <div className="grid gap-3 p-5 md:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1">
          <label htmlFor="admin-phone-org" className="text-[12px] font-medium text-muted">
            {t("phone.admin.org")}
          </label>
          <Select id="admin-phone-org" value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.plan}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="admin-phone-number" className="text-[12px] font-medium text-muted">
            {t("phone.admin.number")}
          </label>
          <Input id="admin-phone-number" dir="ltr" inputMode="tel" placeholder="+972…" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" loading={pending} disabled={!org || phone.trim().length < 8} onClick={() => run(() => adminAssignPhoneAction({ locale, orgId: org, phone }))}>
            <PhoneCall className="h-4 w-4" aria-hidden /> {t("phone.admin.assign")}
          </Button>
          <Button size="sm" variant="secondary" loading={pending} disabled={!org} onClick={() => run(() => adminBuyPhoneAction({ locale, orgId: org }))}>
            <Sparkles className="h-4 w-4" aria-hidden /> {t("phone.admin.buy")}
          </Button>
          <Button size="sm" variant="ghost" loading={pending} disabled={!org} onClick={() => run(() => adminReleasePhoneAction({ locale, orgId: org }))}>
            <Trash2 className="h-4 w-4" aria-hidden /> {t("phone.admin.release")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
