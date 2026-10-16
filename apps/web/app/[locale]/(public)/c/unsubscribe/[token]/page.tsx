import { TokenAction } from "@/components/public/token-action";
import { resolveLocale } from "@/lib/i18n/server";

export const metadata = { robots: { index: false } };

export default async function UnsubscribePage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  await resolveLocale(params);
  const { token } = await params;
  return <TokenAction kind="unsubscribe" token={token} />;
}
