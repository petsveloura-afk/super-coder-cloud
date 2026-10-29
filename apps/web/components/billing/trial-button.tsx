"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Gift } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { startTrialAction } from "@/app/[locale]/(dashboard)/billing/trial-actions";

/** Wave 55 — "try it free for 7 days" (one trial per feature per business). */
export function TrialButton({ feature }: { feature: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      loading={pending}
      data-testid={`trial-${feature}`}
      onClick={() =>
        start(async () => {
          const r = await startTrialAction({ locale, feature, path });
          if (r.error) return void toast.error(t(r.error));
          toast.success(t("trial.started"));
          router.refresh();
        })
      }
    >
      <Gift className="h-4 w-4" aria-hidden /> {t("trial.start")}
    </Button>
  );
}
