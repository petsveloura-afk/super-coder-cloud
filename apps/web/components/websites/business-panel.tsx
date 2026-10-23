"use client";

import { useState } from "react";
import { FileText, RotateCcw, Wand2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { LEGAL_KEYS, LEGAL_TITLES, legalText, type LegalKey } from "@/lib/site/legal";

/**
 * Wave 13 — business details shown in the site's footer and legal pages, social
 * links, site options (cookie notice, accessibility menu, WhatsApp button) and the
 * legal pages themselves (generated from the details, editable).
 */
export type SiteSettings = Partial<{
  legal_name: string;
  business_id: string;
  email: string;
  phone: string;
  address: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  linkedin: string;
  youtube: string;
  a11y_contact: string;
  cookie_banner: boolean;
  a11y_widget: boolean;
  whatsapp_button: string;
  lang: "he" | "en" | "ar";
  logo_url: string;
  tagline: string;
  gdpr: boolean;
}>;
export type SitePages = Partial<Record<LegalKey, string>>;

const TEXT_FIELDS: { key: keyof SiteSettings; ltr?: boolean; wide?: boolean }[] = [
  { key: "legal_name" },
  { key: "business_id", ltr: true },
  { key: "phone", ltr: true },
  { key: "email", ltr: true },
  { key: "address", wide: true },
  { key: "whatsapp_button", ltr: true },
  { key: "a11y_contact" },
  { key: "logo_url", ltr: true, wide: true },
  { key: "tagline", wide: true },
];
const SOCIAL: (keyof SiteSettings)[] = ["instagram", "facebook", "tiktok", "linkedin", "youtube"];

export function BusinessPanel({ siteName, settings, pages, onSettings, onPages, hasForms, hasBooking }: { siteName: string; settings: SiteSettings; pages: SitePages; onSettings: (s: SiteSettings) => void; onPages: (p: SitePages) => void; hasForms: boolean; hasBooking: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<LegalKey | null>(null);
  const set = (k: keyof SiteSettings, v: string | boolean) => onSettings({ ...settings, [k]: v });
  const lang = settings.lang ?? (locale as "he" | "en" | "ar");
  const generate = (k: LegalKey) =>
    legalText(k, lang, {
      siteName,
      legalName: settings.legal_name,
      businessId: settings.business_id,
      email: settings.email,
      phone: settings.phone,
      address: settings.address,
      a11yContact: settings.a11y_contact,
      hasForms,
      hasBooking,
      hasChat: true,
      gdpr: settings.gdpr === true,
    });
  return (
    <div className="space-y-4" data-testid="business-panel">
      <Card className="p-4 sm:p-5">
        <h2 className="font-semibold">{t("websites.business.title")}</h2>
        <p className="mb-4 text-[12.5px] text-muted">{t("websites.business.hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEXT_FIELDS.map((f) => (
            <Field key={f.key} label={t(`websites.business.fields.${f.key}`)} htmlFor={`bz-${f.key}`} className={f.wide ? "sm:col-span-2" : undefined}>
              <Input id={`bz-${f.key}`} dir={f.ltr ? "ltr" : undefined} value={String(settings[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
            </Field>
          ))}
          <Field label={t("websites.business.fields.lang")} htmlFor="bz-lang">
            <Select id="bz-lang" value={settings.lang ?? ""} onChange={(e) => set("lang", e.target.value)}>
              <option value="">{t("websites.business.langAuto")}</option>
              <option value="he">עברית</option>
              <option value="en">English</option>
              <option value="ar">العربية</option>
            </Select>
          </Field>
        </div>
        <h3 className="mb-2 mt-5 text-sm font-semibold">{t("websites.business.social")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL.map((k) => (
            <Field key={k} label={t(`websites.business.fields.${k}`)} htmlFor={`bz-${k}`}>
              <Input id={`bz-${k}`} dir="ltr" placeholder="https://" value={String(settings[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={settings.cookie_banner !== false} onChange={(e) => set("cookie_banner", e.target.checked)} />
            {t("websites.business.cookieBanner")}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={settings.a11y_widget !== false} onChange={(e) => set("a11y_widget", e.target.checked)} />
            {t("websites.business.a11yWidget")}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={settings.gdpr === true} onChange={(e) => set("gdpr", e.target.checked)} />
            {t("websites.business.gdpr")}
          </label>
        </div>
        {/* wave 17: transport security is automatic */}
        <p className="mt-3 text-[12px] text-subtle">🔒 {t("websites.business.sslNote")}</p>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <FileText className="h-4 w-4 text-accent" /> {t("websites.legal.title")}
        </h2>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">{t("websites.legal.hint")}</p>
        <ul className="divide-y divide-line rounded-xl border border-line">
          {LEGAL_KEYS.map((k) => (
            <li key={k} className="p-3" data-legal={k}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{LEGAL_TITLES[lang === "en" || lang === "ar" ? lang : "he"][k]}</span>
                <span className="text-[12px] text-subtle">{pages[k]?.trim() ? t("websites.legal.custom") : t("websites.legal.auto")}</span>
                <span className="flex-1" />
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(open === k ? null : k)}>
                  {open === k ? t("common.close") : t("websites.legal.edit")}
                </Button>
              </div>
              {open === k ? (
                <div className="mt-2 space-y-2">
                  <Textarea rows={12} value={pages[k] ?? ""} placeholder={generate(k).slice(0, 400)} aria-label={LEGAL_TITLES.he[k]} onChange={(e) => onPages({ ...pages, [k]: e.target.value })} dir="auto" />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" size="sm" onClick={() => onPages({ ...pages, [k]: generate(k) })}>
                      <Wand2 className="h-4 w-4" /> {t("websites.legal.generate")}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onPages({ ...pages, [k]: "" })}>
                      <RotateCcw className="h-4 w-4" /> {t("websites.legal.useAuto")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-subtle">{t("websites.legal.disclaimer")}</p>
      </Card>
    </div>
  );
}
