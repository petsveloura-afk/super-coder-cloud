import { redirect } from "next/navigation";
import { resolveLocale } from "@/lib/i18n/server";

export default async function LocaleIndex({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  redirect(`/${locale}/overview`);
}
