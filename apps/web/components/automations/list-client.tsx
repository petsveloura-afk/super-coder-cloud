"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { toggleAutomationAction } from "@/app/[locale]/(dashboard)/automations/actions";

/** Accessible on/off switch for an automation (optimistic). */
export function AutomationToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [prev, setPrev] = useState(enabled);
  if (enabled !== prev) {
    setPrev(enabled);
    setOn(enabled);
  }
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t("automations.enabled")}
      disabled={pending}
      onClick={() => {
        const next = !on;
        setOn(next);
        start(async () => {
          const fd = new FormData();
          fd.set("locale", locale);
          fd.set("id", id);
          fd.set("enabled", String(next));
          const res = await toggleAutomationAction(fd);
          if (res.error) {
            setOn(!next);
            toast.error(t(res.error));
          } else toast.success(t(res.message ?? "common.saved"));
          router.refresh();
        });
      }}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "bg-accent-solid" : "bg-line-strong"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[22px] rtl:-translate-x-[22px]" : "translate-x-0.5 rtl:-translate-x-0.5"}`} />
    </button>
  );
}
