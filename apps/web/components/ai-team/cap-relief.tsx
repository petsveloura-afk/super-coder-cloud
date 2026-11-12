"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { raiseDayCapAction } from "@/app/[locale]/(dashboard)/ai-team/cap-actions";
import type { TeamPageData } from "./types";

/**
 * Round 13 — under a task held by the daily credit cap: WHEN it resumes by itself, and (for people who manage the team, on the
 * first held task only) one click that raises the cap and puts the held tasks back to work now.
 */
export function CapRelief({ data, showButton }: { data: TeamPageData; showButton: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const r = data.capRelief;
  if (!r) return null;
  const at = r.resumeAt ? new Date(r.resumeAt) : null;
  const soon = Boolean(r.soon);
  const when = at ? at.toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="mt-1" data-testid="cap-relief">
      <p className="text-muted">{soon ? t("aiTeam.cap.resumeSoon") : when ? t("aiTeam.cap.resumeAt", { when }) : t("aiTeam.cap.resumeUnknown")}</p>
      {showButton && data.canManage ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-1.5"
          loading={busy}
          data-testid="cap-raise"
          onClick={async () => {
            setBusy(true);
            const res = await raiseDayCapAction({ locale });
            setBusy(false);
            if (res.error) toast.error(t(res.error));
            else {
              toast.success(t("aiTeam.cap.raised", { cap: res.data?.cap ?? r.suggested, n: res.data?.resumed ?? 0 }));
              router.refresh();
            }
          }}
        >
          <Zap className="h-3.5 w-3.5" /> {t("aiTeam.cap.raise", { cap: r.suggested })}
        </Button>
      ) : null}
    </div>
  );
}
