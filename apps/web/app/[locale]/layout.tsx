import "../globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n/client";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { getDictionary, resolveLocale } from "@/lib/i18n/server";
import { ServiceWorkerRegistrar } from "@/components/layout/sw-registrar";
import { InstallAppCapture } from "@/components/layout/install-app";
import { THEME_COOKIE } from "@/lib/theme";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const dict = await getDictionary(locale);
  return {
    title: { default: dict.app.name, template: `%s · ${dict.app.name}` },
    description: dict.app.tagline,
    applicationName: dict.app.name,
    appleWebApp: { capable: true, title: "Super Coder", statusBarStyle: "black-translucent" },
    icons: {
      icon: [{ url: "/icons/icon.svg", type: "image/svg+xml" }, { url: "/icons/icon-192.png", sizes: "192x192" }],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#080D19" },
    { media: "(prefers-color-scheme: light)", color: "#F4F6FB" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = await resolveLocale(params);
  const dict = await getDictionary(locale);
  const theme = (await cookies()).get(THEME_COOKIE)?.value === "light" ? "light" : "dark";
  const { dir } = LOCALE_META[locale];

  return (
    <html lang={locale} dir={dir} data-theme={theme} translate="no" className="notranslate" suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body className="app-backdrop">
        <I18nProvider locale={locale} dict={dict}>
          {children}
          <Toaster
            position={dir === "rtl" ? "top-left" : "top-right"}
            dir={dir}
            theme={theme}
            toastOptions={{ className: "!rounded-xl !border-line !bg-elevated !text-fg" }}
          />
          <InstallAppCapture />
        </I18nProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
