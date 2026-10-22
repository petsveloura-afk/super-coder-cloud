import type { CSSProperties } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { FormField, SiteBlock } from "@scc/shared/engagement";
import { PublicForm } from "@/components/public/public-form";
import type { LegalKey } from "@/lib/site/legal";
import { ProSite } from "./site-pro";

/**
 * Renders a site (blocks + theme) — shared by the public page (/s/[slug]) and the
 * members-only preview (/websites/[id]/preview). Server component; links are re-validated.
 */
export interface RenderableSite {
  name: string;
  theme: { accent?: string; mode?: "dark" | "light"; template?: string; accent2?: string; font?: string; radius?: string; animations?: boolean };
  blocks: SiteBlock[];
  // wave 13 (optional)
  slug?: string;
  settings?: Record<string, unknown> | null;
  pages?: Record<string, string> | null;
}

const CLASSIC_BLOCKS = new Set(["hero", "features", "text", "form", "booking", "cta", "faq", "contact"]);
/** wave 13: sites with a design template, settings or the new sections use the professional renderer */
export function usesProRenderer(site: RenderableSite): boolean {
  return Boolean(site.theme?.template) || Boolean(site.settings && Object.keys(site.settings).length) || site.blocks.some((b) => !CLASSIC_BLOCKS.has(b.type));
}
export type FormsMap = Map<string, { name: string; fields: FormField[]; settings: Record<string, string>; org: string }>;

const safeHref = (h: string | undefined) => (h && /^(https:\/\/|\/|#|mailto:|tel:)/.test(h) ? h : undefined);
const digits = (s: string) => s.replace(/[^\d+]/g, "");
const anchorFor = (b: SiteBlock, i: number) => (b.type === "contact" ? "contact" : b.type === "form" ? "form" : b.type === "faq" ? "faq" : `s${i}`);

export function SiteRenderer({
  site,
  forms,
  locale,
  t,
  banner,
  basePath,
  branding = false,
  legal,
}: {
  site: RenderableSite;
  forms: FormsMap;
  locale: string;
  t: (k: string, p?: Record<string, string | number>) => string;
  banner?: React.ReactNode;
  /** wave 13 */
  basePath?: string;
  branding?: boolean;
  legal?: LegalKey;
}) {
  if (legal || usesProRenderer(site)) {
    return <ProSite site={{ ...site, slug: site.slug ?? "site" }} forms={forms} locale={locale} t={t} banner={banner} basePath={basePath ?? ""} branding={branding} legal={legal} />;
  }
  const accent = /^#[0-9a-fA-F]{6}$/.test(site.theme?.accent ?? "") ? site.theme.accent! : "#3366E6";
  const dark = site.theme?.mode !== "light";
  const style = {
    "--site-accent": accent,
    "--site-bg": dark ? "#0b1020" : "#ffffff",
    "--site-fg": dark ? "#e8ecf5" : "#0f172a",
    "--site-muted": dark ? "#9aa4b8" : "#475569",
    "--site-card": dark ? "#121a2e" : "#f5f7fb",
    "--site-line": dark ? "#24304a" : "#e2e8f0",
    background: "var(--site-bg)",
    color: "var(--site-fg)",
  } as CSSProperties;
  const Arrow = locale === "en" ? ArrowRight : ArrowLeft;
  const btn = "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-white shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:opacity-95";
  const card = { background: "var(--site-card)", borderColor: "var(--site-line)" } as CSSProperties;
  const nav = site.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => ["features", "faq", "contact", "form"].includes(b.type) && "title" in b.data && b.data.title)
    .slice(0, 4);

  return (
    <div style={style} className="min-h-dvh scroll-smooth">
      {banner}
      <header className="sticky top-0 z-20 border-b backdrop-blur" style={{ borderColor: "var(--site-line)", background: dark ? "rgba(11,16,32,.8)" : "rgba(255,255,255,.85)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <a href="#top" className="flex items-center gap-2 text-lg font-extrabold">
            <span className="h-3 w-3 rounded-full" style={{ background: accent }} />
            {site.name}
          </a>
          <nav className="hidden items-center gap-6 text-sm md:flex" style={{ color: "var(--site-muted)" }}>
            {nav.map(({ b, i }) => (
              <a key={i} href={`#${anchorFor(b, i)}`} className="hover:opacity-80">
                {"title" in b.data ? b.data.title : ""}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main id="top">
        {site.blocks.map((b, i) => {
          const key = `${b.type}-${i}`;
          const id = anchorFor(b, i);
          switch (b.type) {
            case "hero":
              return (
                <section key={key} id={id} className="relative overflow-hidden">
                  <div className="pointer-events-none absolute inset-0 opacity-40" style={{ background: `radial-gradient(60% 60% at 20% 10%, ${accent}55, transparent 70%)` }} />
                  <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-5 py-16 md:grid-cols-2 md:py-24">
                    <div>
                      <h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">{b.data.title}</h1>
                      {b.data.subtitle ? <p className="mt-5 whitespace-pre-wrap text-lg leading-8" style={{ color: "var(--site-muted)" }}>{b.data.subtitle}</p> : null}
                      {b.data.cta_label ? (
                        <a data-site-cta="" href={safeHref(b.data.cta_href) ?? "#contact"} className={`${btn} mt-8`} style={{ background: accent }}>
                          {b.data.cta_label} <Arrow className="h-4 w-4" />
                        </a>
                      ) : null}
                    </div>
                    {safeHref(b.data.image_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary customer-hosted / generated image
                      <img src={b.data.image_url} alt="" className="aspect-[4/3] w-full rounded-3xl object-cover shadow-2xl ring-1 ring-white/10" loading="eager" />
                    ) : (
                      <div className="hidden aspect-[4/3] rounded-3xl md:block" style={{ background: `linear-gradient(135deg, ${accent}, transparent)` }} />
                    )}
                  </div>
                </section>
              );
            case "features":
              return (
                <section key={key} id={id} className="mx-auto max-w-6xl px-5 py-14">
                  {b.data.title ? <h2 className="mb-10 text-center text-3xl font-bold md:text-4xl">{b.data.title}</h2> : null}
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {b.data.items.filter((it) => it.title || it.text).map((it, k) => (
                      <div key={k} className="rounded-2xl border p-6 transition hover:-translate-y-1" style={card}>
                        <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: accent }}>
                          <Check className="h-5 w-5" />
                        </span>
                        <h3 className="text-lg font-semibold">{it.title}</h3>
                        {it.text ? <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7" style={{ color: "var(--site-muted)" }}>{it.text}</p> : null}
                      </div>
                    ))}
                  </div>
                </section>
              );
            case "text":
              return (
                <section key={key} id={id} className="mx-auto max-w-3xl px-5 py-14">
                  {b.data.title ? <h2 className="mb-4 text-3xl font-bold">{b.data.title}</h2> : null}
                  <p className="whitespace-pre-wrap text-[16px] leading-8" style={{ color: "var(--site-muted)" }}>{b.data.body}</p>
                </section>
              );
            case "form": {
              const f = forms.get(b.data.form_slug);
              if (!f) return null;
              return (
                <section key={key} id={id} className="mx-auto max-w-xl px-5 py-14">
                  {b.data.title ? <h2 className="mb-6 text-center text-3xl font-bold">{b.data.title}</h2> : null}
                  <div className="rounded-3xl bg-bg text-fg shadow-xl">
                    <PublicForm slug={b.data.form_slug} fields={f.fields} settings={f.settings} orgName={f.org} formName={f.name} />
                  </div>
                </section>
              );
            }
            case "booking":
              if (!b.data.booking_slug) return null;
              return (
                <section key={key} id={id} className="mx-auto max-w-3xl px-5 py-14 text-center">
                  {b.data.title ? <h2 className="text-3xl font-bold">{b.data.title}</h2> : null}
                  {b.data.text ? <p className="mx-auto mt-3 max-w-xl whitespace-pre-wrap" style={{ color: "var(--site-muted)" }}>{b.data.text}</p> : null}
                  <a href={`/${locale}/book/${b.data.booking_slug}`} className={`${btn} mt-6`} style={{ background: accent }}>
                    <CalendarDays className="h-5 w-5" /> {b.data.label || t("websites.bookNow")}
                  </a>
                </section>
              );
            case "cta":
              return (
                <section key={key} id={id} className="mx-auto max-w-6xl px-5 py-14">
                  <div className="relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-2xl" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
                    {b.data.title ? <h2 className="text-3xl font-bold md:text-4xl">{b.data.title}</h2> : null}
                    {b.data.text ? <p className="mx-auto mt-3 max-w-xl whitespace-pre-wrap text-lg opacity-90">{b.data.text}</p> : null}
                    {b.data.label ? (
                      <a href={safeHref(b.data.href) ?? "#contact"} className="mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-7 font-semibold shadow-lg transition hover:-translate-y-0.5" style={{ color: accent }}>
                        {b.data.label} <Arrow className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                </section>
              );
            case "faq":
              return (
                <section key={key} id={id} className="mx-auto max-w-3xl px-5 py-14">
                  {b.data.title ? <h2 className="mb-6 text-3xl font-bold">{b.data.title}</h2> : null}
                  <div className="space-y-3">
                    {b.data.items.filter((it) => it.q).map((it, k) => (
                      <details key={k} className="group rounded-2xl border p-5" style={card}>
                        <summary className="cursor-pointer list-none font-semibold marker:hidden">
                          <span className="flex items-center justify-between gap-3">
                            {it.q}
                            <span className="text-xl leading-none transition group-open:rotate-45" style={{ color: accent }}>+</span>
                          </span>
                        </summary>
                        <p className="mt-3 whitespace-pre-wrap leading-7" style={{ color: "var(--site-muted)" }}>{it.a}</p>
                      </details>
                    ))}
                  </div>
                </section>
              );
            case "contact":
              return (
                <section key={key} id={id} className="mx-auto max-w-6xl px-5 py-14">
                  {b.data.title ? <h2 className="mb-6 text-3xl font-bold">{b.data.title}</h2> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {b.data.phone ? (
                      <a href={`tel:${digits(b.data.phone)}`} className="flex items-center gap-3 rounded-2xl border p-5" style={card}>
                        <Phone className="h-5 w-5" style={{ color: accent }} /> <span dir="ltr">{b.data.phone}</span>
                      </a>
                    ) : null}
                    {b.data.whatsapp ? (
                      <a href={`https://wa.me/${digits(b.data.whatsapp).replace(/^\+/, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border p-5" style={card}>
                        <MessageCircle className="h-5 w-5" style={{ color: accent }} /> WhatsApp
                      </a>
                    ) : null}
                    {b.data.email ? (
                      <a href={`mailto:${b.data.email}`} className="flex items-center gap-3 rounded-2xl border p-5" style={card}>
                        <Mail className="h-5 w-5" style={{ color: accent }} /> <span dir="ltr">{b.data.email}</span>
                      </a>
                    ) : null}
                    {b.data.address ? (
                      <p className="flex items-center gap-3 rounded-2xl border p-5" style={card}>
                        <MapPin className="h-5 w-5" style={{ color: accent }} /> {b.data.address}
                      </p>
                    ) : null}
                  </div>
                </section>
              );
            default:
              return null;
          }
        })}
      </main>
      <footer className="mx-auto max-w-6xl border-t px-5 py-10 text-center text-[12px]" style={{ color: "var(--site-muted)", borderColor: "var(--site-line)" }}>
        © {new Date().getFullYear()} {site.name} · {t("public.poweredBy")}
      </footer>
    </div>
  );
}
