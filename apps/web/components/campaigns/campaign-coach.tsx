"use client";

import { useState, useTransition } from "react";
import { GraduationCap, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { aiCampaignCoachAction } from "@/app/[locale]/(dashboard)/campaigns/actions";

/** Wave 39 — AI results coach: 3 concrete tips for the next campaign, from the real numbers and real errors. */
export function CampaignCoach({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const [res, setRes] = useState<{ summary: string; tips: string[] } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="mb-4" data-testid="campaign-coach">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-accent" /> {t("campaigns.coach.title")}
          </span>
        }
        description={t("campaigns.coach.hint")}
        action={
          <Button
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await aiCampaignCoachAction({ locale, id });
                if (r.error || !r.data) toast.error(t(r.error ?? "errors.generic"));
                else setRes(r.data);
              })
            }
          >
            <Sparkles className="h-4 w-4" /> {t(res ? "campaigns.coach.again" : "campaigns.coach.run")}
          </Button>
        }
      />
      {res ? (
        <div className="fade-slide space-y-2 px-5 pb-5">
          {res.summary ? <p className="text-sm font-medium">{res.summary}</p> : null}
          <ul className="space-y-1.5">
            {res.tips.map((x, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-muted">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-solid" aria-hidden />
                {x}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
