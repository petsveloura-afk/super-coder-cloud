import type { ReactNode } from "react";
import { getT, resolveLocale } from "@/lib/i18n/server";

/** Public pages (forms, booking, unsubscribe): no app chrome, embeddable. */
export default async function PublicLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const { t } = await getT(locale);
  return (
    <div className="flex min-h-dvh flex-col pt-safe pb-safe">
      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-[560px]">{children}</div>
      </main>
      <footer className="pb-5 text-center text-[11.5px] text-subtle">{t("public.poweredBy")}</footer>
    </div>
  );
}
