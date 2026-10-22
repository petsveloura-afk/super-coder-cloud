"use client";

import { useState, useTransition } from "react";
import { ThumbsUp } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { markArticleHelpful } from "@/app/[locale]/(public)/actions";

export function HelpfulButton({ id }: { id: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done) return <p className="mt-3 text-sm text-success">{t("kb.thanks")}</p>;
  return (
    <Button variant="secondary" size="sm" className="mt-3" loading={pending} onClick={() => start(async () => { await markArticleHelpful({ id }); setDone(true); })}>
      <ThumbsUp className="h-4 w-4" /> {t("kb.helpful")}
    </Button>
  );
}
