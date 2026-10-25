import type { Metadata } from "next";
import { ShoppingBag } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { ShopifyContinue } from "@/components/integrations/shopify-continue";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { validShopDomain } from "@/lib/stores/core";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("integrations.shopifyInstall.title") };
}

/** Wave 24 — after an install from Shopify (and sign-in), continue into Shopify's approval screen. */
export default async function ShopifyConnectPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ shop?: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  const shop = validShopDomain((await searchParams).shop);
  const target = shop ? `/api/stores/shopify/start?shop=${encodeURIComponent(shop)}&locale=${locale}` : `/${locale}/integrations#stores`;
  return (
    <Card className="mx-auto mt-10 max-w-md p-6 text-center" data-testid="shopify-install">
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent">
        <ShoppingBag className="h-6 w-6" />
      </span>
      <h1 className="mt-3 text-lg font-bold">{t("integrations.shopifyInstall.title")}</h1>
      <p className="mt-1 text-sm text-muted">
        {shop ? t("integrations.shopifyInstall.body", { shop, org: ctx.org.name }) : t("integrations.shopifyInstall.noShop")}
      </p>
      <ShopifyContinue href={target} auto={Boolean(shop) && ctx.can("integrations.manage")} label={t("integrations.shopifyInstall.go")} />
      {!ctx.can("integrations.manage") ? <p className="mt-3 text-[13px] text-warning">{t("errors.forbidden")}</p> : null}
    </Card>
  );
}
