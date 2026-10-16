import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { CalendarDays, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { FormField, SiteBlock } from "@scc/shared/engagement";
import { PublicForm } from "@/components/public/public-form";
import { createAnonClient } from "@/lib/supabase/anon";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { visitorHash } from "@/lib/visitor";

type Params = Promise<{ locale: string; slug: string }>;

interface PublicSite {
  name: string;
  theme: { accent?: string; mode?: "dark" | "light" };
  seo: { title?: string; description?: string };
  blocks: SiteBlock[];
  org: string;
  org_slug: string;
}

async function load(slug: string): Promise<PublicSite | null> {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return null;
  const { data } = await createAnonClient().rpc("get_public_site", { p_slug: slug });
  return (data as PublicSite | null) ?? null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const s = await load((await params).slug);
  if (!s) return { title: "404" };
  return { title: s.seo?.title || s.name, description: s.seo?.description || undefined };
}

/** Only allow safe link targets (validated on save too). */
const safeHref = (h: string | undefined) => (h && /^(https:\/\/|\/|#|mailto:|tel:)/.test(h) ? h : undefined);
const digits = (s: string) => s.replace(/[^\d+]/g, "");

export default async function PublicSitePage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { slug } = await params;
  const site = await load(slug);
  if (!site) notFound();
  const { t } = await getT(locale);
  // one visit per visitor per day (rate-limited in the database)
  await createAnonClient().rpc("track_site_visit", { p_slug: slug, p_meta: { ip_hash: await visitorHash() } });

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

  // forms embedded in blocks are loaded once each
  const formSlugs = [...new Set(site.blocks.filter((b) => b.type === "form").map((b) => (b.type === "form" ? b.data.form_slug : "")).filter(Boolean))];
  const forms = new Map<string, { name: string; fields: FormField[]; settings: Record<string, string>; org: string }>();
  await Promise.all(
    formSlugs.map(async (fs) => {
      const { data } = await createAnonClient().rpc("get_public_form", { p_slug: fs });
      if (data) forms.set(fs, data as { name: string; fields: FormField[]; settings: Record<string, string>; org: string });
    }),
  );
  const btn = "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-white shadow-lg transition-opacity hover:opacity-90";

  return (
    <div style={style} className="min-h-dvh" data-site={slug}>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <span className="text-lg font-bold">{site.name}</span>
      </header>
      <main>
        {site.blocks.map((b, i) => {
          const key = `${b.type}-${i}`;
          switch (b.type) {
            case "hero":
              return (
                <section key={key} className="mx-auto grid max-w-5xl items-center gap-10 px-5 py-14 md:grid-cols-2 md:py-24">
                  <div>
                    <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">{b.data.title}</h1>
                    {b.data.subtitle ? <p className="mt-5 whitespace-pre-wrap text-lg" style={{ color: "var(--site-muted)" }}>{b.data.subtitle}</p> : null}
                    {b.data.cta_label ? (
                      <a href={safeHref(b.data.cta_href) ?? "#"} className={`${btn} mt-8`} style={{ background: "var(--site-accent)" }}>
                        {b.data.cta_label}
                      </a>
                    ) : null}
                  </div>
                  {safeHref(b.data.image_url) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary customer-hosted image
                    <img src={b.data.image_url} alt="" className="w-full rounded-3xl object-cover shadow-2xl" loading="lazy" />
                  ) : (
                    <div className="hidden aspect-[4/3] rounded-3xl md:block" style={{ background: "linear-gradient(135deg, var(--site-accent), transparent)" }} />
                  )}
                </section>
              );
            case "features":
              return (
                <section key={key} className="mx-auto max-w-5xl px-5 py-12">
                  {b.data.title ? <h2 className="mb-8 text-center text-3xl font-bold">{b.data.title}</h2> : null}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {b.data.items.filter((it) => it.title || it.text).map((it, k) => (
                      <div key={k} className="rounded-2xl border p-6" style={{ background: "var(--site-card)", borderColor: "var(--site-line)" }}>
                        <div className="mb-3 h-1.5 w-10 rounded-full" style={{ background: "var(--site-accent)" }} />
                        <h3 className="text-lg font-semibold">{it.title}</h3>
                        {it.text ? <p className="mt-2 whitespace-pre-wrap text-[15px]" style={{ color: "var(--site-muted)" }}>{it.text}</p> : null}
                      </div>
                    ))}
                  </div>
                </section>
              );
            case "text":
              return (
                <section key={key} className="mx-auto max-w-3xl px-5 py-12">
                  {b.data.title ? <h2 className="mb-4 text-3xl font-bold">{b.data.title}</h2> : null}
                  <p className="whitespace-pre-wrap text-[16px] leading-8" style={{ color: "var(--site-muted)" }}>{b.data.body}</p>
                </section>
              );
            case "form": {
              const f = forms.get(b.data.form_slug);
              if (!f) return null;
              return (
                <section key={key} id="form" className="mx-auto max-w-xl px-5 py-12">
                  {b.data.title ? <h2 className="mb-6 text-center text-3xl font-bold">{b.data.title}</h2> : null}
                  <div className="rounded-3xl bg-bg text-fg">
                    <PublicForm slug={b.data.form_slug} fields={f.fields} settings={f.settings} orgName={f.org} formName={f.name} />
                  </div>
                </section>
              );
            }
            case "booking":
              if (!b.data.booking_slug) return null;
              return (
                <section key={key} className="mx-auto max-w-3xl px-5 py-12 text-center">
                  {b.data.title ? <h2 className="text-3xl font-bold">{b.data.title}</h2> : null}
                  {b.data.text ? <p className="mx-auto mt-3 max-w-xl whitespace-pre-wrap" style={{ color: "var(--site-muted)" }}>{b.data.text}</p> : null}
                  <a href={`/${locale}/book/${b.data.booking_slug}`} className={`${btn} mt-6`} style={{ background: "var(--site-accent)" }}>
                    <CalendarDays className="h-5 w-5" /> {b.data.label || t("websites.bookNow")}
                  </a>
                </section>
              );
            case "cta":
              return (
                <section key={key} className="mx-auto max-w-5xl px-5 py-12">
                  <div className="rounded-3xl px-6 py-12 text-center text-white" style={{ background: "var(--site-accent)" }}>
                    {b.data.title ? <h2 className="text-3xl font-bold">{b.data.title}</h2> : null}
                    {b.data.text ? <p className="mx-auto mt-3 max-w-xl whitespace-pre-wrap opacity-90">{b.data.text}</p> : null}
                    {b.data.label ? (
                      <a href={safeHref(b.data.href) ?? "#"} className="mt-6 inline-flex h-12 items-center rounded-xl bg-white px-6 font-semibold" style={{ color: accent }}>
                        {b.data.label}
                      </a>
                    ) : null}
                  </div>
                </section>
              );
            case "faq":
              return (
                <section key={key} className="mx-auto max-w-3xl px-5 py-12">
                  {b.data.title ? <h2 className="mb-6 text-3xl font-bold">{b.data.title}</h2> : null}
                  <div className="space-y-3">
                    {b.data.items.filter((it) => it.q).map((it, k) => (
                      <details key={k} className="rounded-2xl border p-5" style={{ background: "var(--site-card)", borderColor: "var(--site-line)" }}>
                        <summary className="cursor-pointer font-semibold">{it.q}</summary>
                        <p className="mt-3 whitespace-pre-wrap" style={{ color: "var(--site-muted)" }}>{it.a}</p>
                      </details>
                    ))}
                  </div>
                </section>
              );
            case "contact":
              return (
                <section key={key} id="contact" className="mx-auto max-w-5xl px-5 py-12">
                  {b.data.title ? <h2 className="mb-6 text-3xl font-bold">{b.data.title}</h2> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {b.data.phone ? (
                      <a href={`tel:${digits(b.data.phone)}`} className="flex items-center gap-3 rounded-2xl border p-5" style={{ background: "var(--site-card)", borderColor: "var(--site-line)" }}>
                        <Phone className="h-5 w-5" style={{ color: accent }} /> <span dir="ltr">{b.data.phone}</span>
                      </a>
                    ) : null}
                    {b.data.whatsapp ? (
                      <a href={`https://wa.me/${digits(b.data.whatsapp).replace(/^\+/, "")}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border p-5" style={{ background: "var(--site-card)", borderColor: "var(--site-line)" }}>
                        <MessageCircle className="h-5 w-5" style={{ color: accent }} /> WhatsApp
                      </a>
                    ) : null}
                    {b.data.email ? (
                      <a href={`mailto:${b.data.email}`} className="flex items-center gap-3 rounded-2xl border p-5" style={{ background: "var(--site-card)", borderColor: "var(--site-line)" }}>
                        <Mail className="h-5 w-5" style={{ color: accent }} /> <span dir="ltr">{b.data.email}</span>
                      </a>
                    ) : null}
                    {b.data.address ? (
                      <p className="flex items-center gap-3 rounded-2xl border p-5" style={{ background: "var(--site-card)", borderColor: "var(--site-line)" }}>
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
      <footer className="mx-auto max-w-5xl px-5 py-10 text-center text-[12px]" style={{ color: "var(--site-muted)" }}>
        © {new Date().getFullYear()} {site.name} · {t("public.poweredBy")}
      </footer>
    </div>
  );
}
