import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveLocale } from "@/lib/i18n/server";
import { publicEnv } from "@/lib/env";
import { LEGAL_DOCS, LEGAL_UPDATED, legalContent, legalVars, type LegalDoc } from "@/lib/legal/platform";

/**
 * Wave 21 — the platform's privacy policy, terms of use and data-deletion instructions:
 *   /he/legal/privacy · /he/legal/terms · /he/legal/data-deletion  (English under /en/…)
 * Public (no login) — Meta, Google and Shopify app reviews link here.
 */
type Params = { params: Promise<{ locale: string; doc: string }> };

function pick(doc: string): LegalDoc | null {
  return (LEGAL_DOCS as string[]).includes(doc) ? (doc as LegalDoc) : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { doc } = await params;
  const locale = await resolveLocale(params);
  const d = pick(doc);
  if (!d) return {};
  const c = legalContent(d, locale === "he" ? "he" : "en", legalVars(process.env, publicEnv.appUrl));
  return { title: c.title, robots: { index: true } };
}

export default async function LegalPage({ params }: Params) {
  const { doc } = await params;
  const locale = await resolveLocale(params);
  const d = pick(doc);
  if (!d) notFound();
  const lang = locale === "he" ? "he" : "en";
  const c = legalContent(d, lang, legalVars(process.env, publicEnv.appUrl));
  const names: Record<LegalDoc, string> = lang === "he" ? { privacy: "מדיניות פרטיות", terms: "תנאי שימוש", "data-deletion": "מחיקת נתונים" } : { privacy: "Privacy", terms: "Terms", "data-deletion": "Data deletion" };
  return (
    <article dir={lang === "he" ? "rtl" : "ltr"} lang={lang} className="rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-7" data-testid={`legal-${d}`}>
      <nav className="mb-5 flex flex-wrap gap-1.5" aria-label={lang === "he" ? "מסמכים" : "Documents"}>
        {LEGAL_DOCS.map((x) => (
          <Link key={x} href={`/${lang}/legal/${x}`} aria-current={x === d ? "page" : undefined} className={x === d ? "rounded-full bg-accent-soft px-3 py-1 text-[12.5px] font-semibold text-accent" : "rounded-full px-3 py-1 text-[12.5px] text-muted hover:bg-surface-hover"}>
            {names[x]}
          </Link>
        ))}
      </nav>
      <h1 className="text-[24px] font-bold leading-tight">{c.title}</h1>
      <p className="mt-1 text-[12.5px] text-subtle">
        {lang === "he" ? "עודכן לאחרונה: " : "Last updated: "}
        <time dateTime={LEGAL_UPDATED}>{LEGAL_UPDATED}</time>
      </p>
      <p className="mt-4 text-[14.5px] leading-relaxed">{c.intro}</p>
      {c.sections.map((s) => (
        <section key={s.h} className="mt-6">
          <h2 className="text-[16px] font-semibold">{s.h}</h2>
          {s.p.length > 1 ? (
            <ul className="mt-2 list-disc space-y-1.5 ps-5 text-[14px] leading-relaxed text-muted">
              {s.p.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14px] leading-relaxed text-muted">{s.p[0]}</p>
          )}
        </section>
      ))}
    </article>
  );
}
