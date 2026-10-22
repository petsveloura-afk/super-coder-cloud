import type { Metadata } from "next";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { verifyAct } from "@/lib/act-links";
import { Card } from "@/components/ui/primitives";
import { ActConfirm } from "@/components/public/act-confirm";

type Params = Promise<{ locale: string; token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("act.title"), robots: { index: false, follow: false } };
}

/**
 * Wave 15 — one-tap action from a reminder (task done / snooze, meeting confirm / cancel).
 * Opening the link only shows this confirmation; the action runs on the button press.
 */
export default async function ActPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  const { t } = await getT(locale);
  const p = verifyAct(token);
  return (
    <Card className="p-6 text-center" data-testid="act-page">
      <h1 className="text-xl font-bold">{t("act.title")}</h1>
      {!p ? (
        <p className="mt-3 text-sm text-danger">{t("act.invalid")}</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">{t(`act.ask.${p.k}_${p.a}`)}</p>
          <ActConfirm token={token} label={t(`act.buttons.${p.k}_${p.a}`)} danger={p.a === "cancel"} />
        </>
      )}
    </Card>
  );
}
