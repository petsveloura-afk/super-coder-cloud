"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PLAN_KEYS } from "@scc/shared/billing";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input, Select } from "@/components/ui/primitives";
import { setFlagAction, setPlanAction } from "@/app/[locale]/(dashboard)/admin/actions";

function useRun() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: (fd: FormData) => Promise<{ error?: string; message?: string }>, values: Record<string, string>) =>
    start(async () => {
      const fd = new FormData();
      fd.set("locale", locale);
      for (const [k, v] of Object.entries(values)) fd.set(k, v);
      const r = await action(fd);
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        router.refresh();
      }
    });
  return { pending, run, t };
}

export function PlanControl({ orgId, plan }: { orgId: string; plan: string }) {
  const { pending, run, t } = useRun();
  const [value, setValue] = useState(plan);
  return (
    <div className="flex items-center gap-1.5">
      <Select aria-label={t("admin.plan")} value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-28 text-[13px]">
        {PLAN_KEYS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="secondary" disabled={value === plan} loading={pending} onClick={() => run(setPlanAction, { org: orgId, plan: value })}>
        {t("common.save")}
      </Button>
    </div>
  );
}

export function FlagToggle({ flagKey, orgId, enabled }: { flagKey: string; orgId: string | null; enabled: boolean }) {
  const { pending, run, t } = useRun();
  return (
    <Button size="sm" variant={enabled ? "secondary" : "ghost"} loading={pending} onClick={() => run(setFlagAction, { key: flagKey, org: orgId ?? "", enabled: String(!enabled) })}>
      {t(enabled ? "admin.disable" : "admin.enable")}
    </Button>
  );
}

export function NewFlagForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const { pending, run, t } = useRun();
  const [key, setKey] = useState("");
  const [org, setOrg] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        run(setFlagAction, { key, org, enabled: "true" });
        setKey("");
      }}
    >
      <Input aria-label={t("admin.flagKey")} placeholder="new_feature" dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} className="sm:w-56" />
      <Select aria-label={t("admin.scope")} value={org} onChange={(e) => setOrg(e.target.value)} className="sm:w-64">
        <option value="">{t("admin.global")}</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
      <Button type="submit" loading={pending} disabled={!key}>
        {t("admin.enableFlag")}
      </Button>
    </form>
  );
}
