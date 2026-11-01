"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { setTeamFlagAction } from "@/app/[locale]/(dashboard)/ai-team/actions";

/** platform admins only: turn the digital team's flag on for this business (one click, audited) */
export function FlagEnable() {
  const { t, locale } = useI18n();
  const router = useRouter();
  return (
    <Button
      onClick={async () => {
        const r = await setTeamFlagAction({ locale, scope: "org", enabled: true });
        if (r.error) return toast.error(t(r.error));
        toast.success(t("aiTeam.flagOff.enabled"));
        router.refresh();
      }}
      data-testid="team-flag-enable"
    >
      {t("aiTeam.flagOff.enable")}
    </Button>
  );
}
