import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, ArrowRight, Award, CalendarDays, Check, Clock, Gem, Heart, Leaf, Mail, MapPin, MessageCircle, Phone, Rocket, ShieldCheck, Smile, Sparkles, Star, ThumbsUp, Zap } from "lucide-react";
import type { SiteBlock } from "@scc/shared/engagement";
import { PublicForm } from "@/components/public/public-form";
import { LEGAL_TITLES, legalText, parseLegal, type LegalKey } from "@/lib/site/legal";
import { FONTS, fontsHref, onColor, resolveTheme } from "@/lib/site/templates";
import { A11yMenu, CookieBanner, SiteMotion } from "./site-client";
import type { FormsMap } from "./site-renderer";
import "./site-pro.css";

/**
 * Wave 13 — the professional website renderer (templates, rich sections, motion,
 * footer with legal pages, accessibility menu, cookie notice, WhatsApp button).
 * Server component; small client islands live in site-client.tsx.
 */
export interface ProSiteData {
  name: string;
  slug: string;
  theme: { template?: string; accent?: string; accent2?: string; mode?: "dark" | "light"; font?: string; radius?: string; animations?: boolean };
  blocks: SiteBlock[];
  settings?: Record<string, unknown> | null;
  pages?: Record<string, string> | null;
}

const ICONS = [Sparkles, ShieldCheck, Clock, Star, Heart, Zap, Award, Smile, Leaf, Gem, Rocket, ThumbsUp];
const safeHref = (h: string | undefined) => (h && /^(https:\/\/|\/|#|mailto:|tel:)/.test(h) ? h : undefined);
const digits = (s: string) => s.replace(/[^\d+]/g, "");
/** WhatsApp needs the international number: a local Israeli 05x… becomes 9725x… */
const waNumber = (s: string) => {
  const d = digits(s).replace(/^\+/, "");
  return d.startsWith("0") ? `972${d.slice(1)}` : d;
};
const sstr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const anchorFor = (b: SiteBlock, i: number) => (["contact", "form", "faq", "about", "pricing", "gallery", "testimonials"].includes(b.type) ? b.type : `s${i}`);
const initials = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

function videoEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

export function ProSite({
  site,
  forms,
  locale,
  t,
  basePath,
  branding,
  legal,
  banner,
}: {
  site: ProSiteData;
  forms: FormsMap;
  locale: string;
  t: (k: string, p?: Record<string, string | number>) => string;
  /** where legal pages live: "/he/s/my-site" on the platform domain, "" on a custom domain */
  basePath: string;
  /** "built with" badge (free plans) */
  branding: boolean;
  /** render a legal page instead of the sections */
  legal?: LegalKey;
  banner?: ReactNode;
}) {
  const th = resolveTheme(site.theme);
  const s = (site.settings ?? {}) as Record<string, unknown>;
  const lang = sstr(s.lang) || locale;
  const dir = lang === "en" ? "ltr" : "rtl";
  const Arrow = dir === "ltr" ? ArrowRight : ArrowLeft;
  const rootId = `scs-${site.slug}`;
  const fonts = fontsHref([th.display, th.body]);
  const style = {
    "--a": th.accent,
    "--a2": th.accent2,
    "--on-a": onColor(th.accent),
    "--bg": th.palette.bg,
    "--fg": th.palette.fg,
    "--mu": th.palette.muted,
    "--card": th.palette.card,
    "--line": th.palette.line,
    "--soft": th.palette.soft,
    "--fd": `"${fontFamily(th.display)}", ${fontFallback(th.display)}`,
    "--fb": `"${fontFamily(th.body)}", ${fontFallback(th.body)}`,
  } as CSSProperties;
  const home = basePath || "/";
  const link = (k: LegalKey) => `${basePath}/${k}`;
  const contactBlock = site.blocks.find((b) => b.type === "contact");
  const phone = sstr(s.phone) || (contactBlock?.type === "contact" ? contactBlock.data.phone : "");
  const email = sstr(s.email) || (contactBlock?.type === "contact" ? contactBlock.data.email : "");
  const address = sstr(s.address) || (contactBlock?.type === "contact" ? contactBlock.data.address : "");
  const wa = sstr(s.whatsapp_button) || (contactBlock?.type === "contact" ? contactBlock.data.whatsapp : "");
  const nav = site.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => ["about", "features", "pricing", "testimonials", "faq", "contact"].includes(b.type) && "title" in b.data && b.data.title)
    .slice(0, 5);
  const cta = site.blocks.find((b) => b.type === "hero");
  const ctaLabel = cta?.type === "hero" ? cta.data.cta_label : "";
  const ctaHref = cta?.type === "hero" ? safeHref(cta.data.cta_href) : undefined;
  const year = new Date().getFullYear();
  const legalName = sstr(s.legal_name) || site.name;
  const socials = (
    [
      ["instagram", "IG"],
      ["facebook", "f"],
      ["tiktok", "TT"],
      ["linkedin", "in"],
      ["youtube", "YT"],
    ] as const
  )
    .map(([k, label]) => ({ k, label, href: safeHref(sstr(s[k])) }))
    .filter((x) => x.href && x.href.startsWith("https://"));

  const sec = (key: string, id: string, inner: ReactNode, cls = "") => (
    <section key={key} id={id} className={`sec ${cls}`.trim()}>
      {inner}
    </section>
  );
  const head = (title?: string, sub?: string, center = true) =>
    title || sub ? (
      <div className={`sec-head${center ? " center" : ""}`} data-reveal>
        {title ? <h2>{title}</h2> : null}
        {sub ? <p>{sub}</p> : null}
      </div>
    ) : null;

  const renderBlock = (b: SiteBlock, i: number) => {
    const key = `${b.type}-${i}`;
    const id = anchorFor(b, i);
    switch (b.type) {
      case "hero": {
        const img = safeHref(b.data.image_url);
        const words = (
          <div className="seq">
            <h1>{b.data.title}</h1>
            {b.data.subtitle ? <p className="sub">{b.data.subtitle}</p> : null}
            <div className="btns">
              {b.data.cta_label ? (
                <a data-site-cta="" href={safeHref(b.data.cta_href) ?? "#contact"} className="btn btn-a">
                  {b.data.cta_label} <Arrow className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : null}
              {phone ? (
                <a href={`tel:${digits(phone)}`} className="btn btn-o">
                  <Phone className="h-4 w-4" aria-hidden="true" /> <span dir="ltr">{phone}</span>
                </a>
              ) : null}
            </div>
          </div>
        );
        const art = (cls: string) => (
          <div className={cls}>
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element -- customer-hosted / generated image
              <img src={img} alt="" loading="eager" fetchPriority="high" />
            ) : (
              <div className="art" aria-hidden="true">
                <span>{initials(site.name)}</span>
              </div>
            )}
          </div>
        );
        const layout = th.tpl.hero === "cover" && !img ? "centered" : th.tpl.hero;
        return (
          <section key={key} id={id} className="hero" data-hero={layout}>
            {layout === "cover" ? (
              <>
                <div className="cover-img" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element -- customer-hosted / generated image */}
                  <img src={img} alt="" loading="eager" fetchPriority="high" />
                </div>
                <div className="wrap" style={{ width: "100%" }}>
                  {words}
                </div>
              </>
            ) : layout === "split" ? (
              <div className="wrap hero-grid">
                {words}
                {art("hero-art")}
              </div>
            ) : (
              <div className="wrap">
                {words}
                {layout === "stacked" || img ? art("hero-wide") : null}
              </div>
            )}
          </section>
        );
      }
      case "features": {
        const items = b.data.items.filter((it) => it.title || it.text);
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title)}
            <div className={`grid ${items.length === 4 ? "g2" : items.length % 3 === 0 || items.length > 4 ? "g3" : "g2"}`}>
              {items.map((it, k) => {
                const Icon = ICONS[k % ICONS.length]!;
                return (
                  <div key={k} className="card" data-reveal>
                    <span className="ico">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3>{it.title}</h3>
                    {it.text ? <p>{it.text}</p> : null}
                  </div>
                );
              })}
            </div>
          </div>,
        );
      }
      case "about": {
        const img = safeHref(b.data.image_url);
        return sec(
          key,
          id,
          <div className={`wrap about${img ? " has-img" : ""}`}>
            {img ? (
              <div className="about-img" data-reveal>
                {/* eslint-disable-next-line @next/next/no-img-element -- customer-hosted image */}
                <img src={img} alt={b.data.title || site.name} loading="lazy" />
              </div>
            ) : null}
            <div data-reveal>
              {b.data.title ? <h2>{b.data.title}</h2> : null}
              <p className="prose">{b.data.body}</p>
            </div>
          </div>,
        );
      }
      case "text":
        return sec(
          key,
          id,
          <div className="narrow" data-reveal>
            {b.data.title ? <h2>{b.data.title}</h2> : null}
            <p className="prose">{b.data.body}</p>
          </div>,
        );
      case "stats": {
        const items = b.data.items.filter((it) => it.value || it.label);
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title)}
            <div className="stats" style={{ "--n": Math.min(4, Math.max(2, items.length)) } as CSSProperties} data-reveal>
              {items.map((it, k) => (
                <div key={k} className="stat">
                  <b>{it.value}</b>
                  <span>{it.label}</span>
                </div>
              ))}
            </div>
          </div>,
        );
      }
      case "steps": {
        const items = b.data.items.filter((it) => it.title || it.text);
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title)}
            <div className="steps" style={{ "--n": Math.min(4, Math.max(2, items.length)) } as CSSProperties}>
              {items.map((it, k) => (
                <div key={k} className="step" data-reveal>
                  <h3>{it.title}</h3>
                  {it.text ? <p>{it.text}</p> : null}
                </div>
              ))}
            </div>
          </div>,
        );
      }
      case "testimonials": {
        const items = b.data.items.filter((it) => it.quote);
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title)}
            <div className={`grid ${items.length >= 3 ? "g3" : "g2"}`}>
              {items.map((it, k) => {
                const stars = Math.max(1, Math.min(5, Number(it.rating || 5)));
                return (
                  <figure key={k} className="card quote" data-reveal style={{ margin: 0 }}>
                    <span className="stars" aria-label={t("websites.site.stars", { n: stars })}>
                      {"★".repeat(stars)}
                    </span>
                    <blockquote>{it.quote}</blockquote>
                    <footer>
                      <span className="avatar" aria-hidden="true">
                        {initials(it.name || "★")}
                      </span>
                      <span>
                        <b>{it.name}</b>
                        {it.role ? <span>{it.role}</span> : null}
                      </span>
                    </footer>
                  </figure>
                );
              })}
            </div>
          </div>,
        );
      }
      case "pricing": {
        const items = b.data.items.filter((it) => it.name || it.price);
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title)}
            <div className="plans" style={{ "--n": Math.min(3, Math.max(1, items.length)) } as CSSProperties}>
              {items.map((it, k) => (
                <div key={k} className={`card plan${it.highlight === "yes" ? " hl" : ""}`} data-reveal>
                  {it.highlight === "yes" ? <span className="badge">{t("websites.site.popular")}</span> : null}
                  <h3>{it.name}</h3>
                  <div className="price">
                    {it.price}
                    {it.period ? <small>{it.period}</small> : null}
                  </div>
                  {it.features ? (
                    <ul>
                      {it.features
                        .split("\n")
                        .map((f) => f.replace(/^[-•*]\s*/, "").trim())
                        .filter(Boolean)
                        .map((f, m) => (
                          <li key={m}>
                            <Check className="h-4 w-4" aria-hidden="true" /> {f}
                          </li>
                        ))}
                    </ul>
                  ) : null}
                  {it.cta_label ? (
                    <a href={safeHref(it.cta_href) ?? "#contact"} className={`btn ${it.highlight === "yes" ? "btn-a" : "btn-o"}`}>
                      {it.cta_label}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </div>,
        );
      }
      case "gallery": {
        const items = b.data.items.filter((it) => safeHref(it.url));
        if (!items.length) return null;
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title)}
            <div className="gallery">
              {items.map((it, k) => (
                <figure key={k} data-reveal>
                  {/* eslint-disable-next-line @next/next/no-img-element -- customer-hosted image */}
                  <img src={it.url} alt={it.caption || `${site.name} ${k + 1}`} loading="lazy" />
                  {it.caption ? <figcaption>{it.caption}</figcaption> : null}
                </figure>
              ))}
            </div>
          </div>,
        );
      }
      case "team": {
        const items = b.data.items.filter((it) => it.name);
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title)}
            <div className="team">
              {items.map((it, k) => (
                <div key={k} className="member" data-reveal>
                  <div className="ph">
                    {safeHref(it.image_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- customer-hosted image
                      <img src={it.image_url} alt={it.name} loading="lazy" />
                    ) : (
                      <span aria-hidden="true">{initials(it.name)}</span>
                    )}
                  </div>
                  <h3>{it.name}</h3>
                  {it.role ? <span>{it.role}</span> : null}
                </div>
              ))}
            </div>
          </div>,
        );
      }
      case "logos": {
        const items = b.data.items.filter((it) => it.name);
        if (!items.length) return null;
        return sec(
          key,
          id,
          <div className="wrap">
            {b.data.title ? (
              <p className="mu" style={{ textAlign: "center", marginBottom: "1.6rem" }}>
                {b.data.title}
              </p>
            ) : null}
            <div className="logos" aria-label={b.data.title || undefined}>
              <div className="logos-track">
                {[...items, ...items].map((it, k) => (
                  <span key={k} aria-hidden={k >= items.length ? true : undefined}>
                    {it.name}
                  </span>
                ))}
              </div>
            </div>
          </div>,
          "",
        );
      }
      case "video": {
        const src = videoEmbed(b.data.url ?? "");
        if (!src) return null;
        return sec(
          key,
          id,
          <div className="narrow" style={{ maxWidth: "60rem" }}>
            {head(b.data.title, b.data.text)}
            <div className="video" data-reveal>
              <iframe src={src} title={b.data.title || site.name} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          </div>,
        );
      }
      case "form": {
        const f = forms.get(b.data.form_slug);
        if (!f) return null;
        return sec(
          key,
          id,
          <div className="narrow" style={{ maxWidth: "36rem" }}>
            {head(b.data.title)}
            <div className="form-shell bg-bg text-fg" data-reveal>
              <PublicForm slug={b.data.form_slug} fields={f.fields} settings={f.settings} orgName={f.org} formName={f.name} />
            </div>
          </div>,
        );
      }
      case "booking":
        if (!b.data.booking_slug) return null;
        return sec(
          key,
          id,
          <div className="narrow" style={{ textAlign: "center" }} data-reveal>
            {b.data.title ? <h2>{b.data.title}</h2> : null}
            {b.data.text ? <p className="prose">{b.data.text}</p> : null}
            <div className="btns" style={{ justifyContent: "center" }}>
              <a href={`/${locale}/book/${b.data.booking_slug}`} className="btn btn-a">
                <CalendarDays className="h-5 w-5" aria-hidden="true" /> {b.data.label || t("websites.bookNow")}
              </a>
            </div>
          </div>,
        );
      case "cta":
        return sec(
          key,
          id,
          <div className="wrap">
            <div className="cta-band" data-reveal>
              {b.data.title ? <h2>{b.data.title}</h2> : null}
              {b.data.text ? <p>{b.data.text}</p> : null}
              {b.data.label ? (
                <a href={safeHref(b.data.href) ?? "#contact"} className="btn">
                  {b.data.label} <Arrow className="h-4 w-4" aria-hidden="true" />
                </a>
              ) : null}
            </div>
          </div>,
        );
      case "faq":
        return sec(
          key,
          id,
          <div className="narrow">
            {head(b.data.title, undefined, false)}
            <div className="faq" data-reveal>
              {b.data.items
                .filter((it) => it.q)
                .map((it, k) => (
                  <details key={k}>
                    <summary>
                      {it.q}
                      <i aria-hidden="true">+</i>
                    </summary>
                    <p>{it.a}</p>
                  </details>
                ))}
            </div>
          </div>,
        );
      case "contact":
        return sec(
          key,
          id,
          <div className="wrap">
            {head(b.data.title, undefined, false)}
            <div className="contact">
              {b.data.phone ? (
                <a href={`tel:${digits(b.data.phone)}`} className="card" data-reveal>
                  <Phone className="h-5 w-5" aria-hidden="true" /> <span dir="ltr">{b.data.phone}</span>
                </a>
              ) : null}
              {b.data.whatsapp ? (
                <a href={`https://wa.me/${waNumber(b.data.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="card" data-reveal>
                  <MessageCircle className="h-5 w-5" aria-hidden="true" /> WhatsApp
                </a>
              ) : null}
              {b.data.email ? (
                <a href={`mailto:${b.data.email}`} className="card" data-reveal>
                  <Mail className="h-5 w-5" aria-hidden="true" /> <span dir="ltr">{b.data.email}</span>
                </a>
              ) : null}
              {b.data.address ? (
                <p className="card" data-reveal>
                  <MapPin className="h-5 w-5" aria-hidden="true" /> {b.data.address}
                </p>
              ) : null}
            </div>
          </div>,
        );
      default:
        return null;
    }
  };

  const legalPage = legal ? (
    <article className="narrow legal" data-testid={`legal-${legal}`}>
      <h1>{LEGAL_TITLES[lang === "en" ? "en" : lang === "ar" ? "ar" : "he"][legal]}</h1>
      {parseLegal(
        (site.pages?.[legal] ?? "").trim() ||
          legalText(legal, lang, {
            siteName: site.name,
            legalName: sstr(s.legal_name),
            businessId: sstr(s.business_id),
            email,
            phone,
            address,
            a11yContact: sstr(s.a11y_contact),
            hasForms: site.blocks.some((b) => b.type === "form"),
            hasBooking: site.blocks.some((b) => b.type === "booking"),
            hasChat: true,
            gdpr: s.gdpr === true,
          }),
      ).map((p, k) => (p.kind === "h" ? <h2 key={k}>{p.text}</h2> : p.kind === "p" ? <p key={k}>{p.text}</p> : <ul key={k}>{p.items.map((it, m) => <li key={m}>{it}</li>)}</ul>))}
      <p style={{ marginTop: "2.5rem" }}>
        <a href={home} className="btn btn-o">
          {t("websites.site.backHome")}
        </a>
      </p>
    </article>
  ) : null;

  return (
    <div id={rootId} className="scs" dir={dir} lang={lang} style={style} data-tpl={th.tpl.key} data-mode={th.mode} data-radius={th.radius} data-cards={th.tpl.cards} data-bg={th.tpl.bg} data-motion={th.tpl.motion} data-anim={th.animations ? "on" : "off"} data-testid="pro-site">
      {fonts ? <link rel="stylesheet" href={fonts} /> : null}
      <div className="bgfx" aria-hidden="true" />
      {banner}
      <a href="#main" className="sr-only focus:not-sr-only">
        {t("websites.site.skip")}
      </a>
      <header className="hdr">
        <div className="wrap hdr-in">
          <a href={legal ? home : "#top"} className="brand">
            {safeHref(sstr(s.logo_url)) ? (
              // eslint-disable-next-line @next/next/no-img-element -- customer logo
              <img src={sstr(s.logo_url)} alt="" />
            ) : (
              <span className="brand-dot" aria-hidden="true" />
            )}
            {site.name}
          </a>
          {!legal ? (
            <nav className="nav" aria-label={t("websites.site.menu")}>
              {nav.map(({ b, i }) => (
                <a key={i} href={`#${anchorFor(b, i)}`}>
                  {"title" in b.data ? b.data.title : ""}
                </a>
              ))}
            </nav>
          ) : null}
          {!legal && ctaLabel ? (
            <a href={ctaHref ?? "#contact"} className="btn btn-a">
              {ctaLabel}
            </a>
          ) : null}
        </div>
      </header>
      <main id="main">{legal ? legalPage : <div id="top">{site.blocks.map(renderBlock)}</div>}</main>
      <footer className="ftr">
        <div className="wrap">
          <div className="ftr-grid">
            <div>
              <h4>{site.name}</h4>
              {sstr(s.tagline) ? <p>{sstr(s.tagline)}</p> : null}
              {socials.length ? (
                <div className="socials">
                  {socials.map((x) => (
                    <a key={x.k} href={x.href} target="_blank" rel="noopener noreferrer" aria-label={x.k}>
                      <span aria-hidden="true" style={{ fontWeight: 800, fontSize: "0.8rem" }}>
                        {x.label}
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            <div>
              <h4>{t("websites.site.contact")}</h4>
              <ul>
                {phone ? (
                  <li>
                    <a href={`tel:${digits(phone)}`} dir="ltr">
                      {phone}
                    </a>
                  </li>
                ) : null}
                {email ? (
                  <li>
                    <a href={`mailto:${email}`} dir="ltr">
                      {email}
                    </a>
                  </li>
                ) : null}
                {address ? <li>{address}</li> : null}
              </ul>
            </div>
            <div>
              <h4>{t("websites.site.info")}</h4>
              <ul>
                {(["privacy", "terms", "accessibility", "cookies"] as const).map((k) => (
                  <li key={k}>
                    <a href={link(k)}>{LEGAL_TITLES[lang === "en" ? "en" : lang === "ar" ? "ar" : "he"][k]}</a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="ftr-bottom">
            <span>
              © {year} {legalName}
              {sstr(s.business_id) ? ` · ${sstr(s.business_id)}` : ""}. {t("websites.site.rights")}
            </span>
            {branding ? (
              <a className="made" href="https://super-coder-cloud.vercel.app" target="_blank" rel="noopener">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> {t("websites.site.madeWith")}
              </a>
            ) : null}
          </div>
        </div>
      </footer>
      {wa ? (
        <a className="float-wa" href={`https://wa.me/${waNumber(wa)}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp" data-testid="float-wa">
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        </a>
      ) : null}
      {s.a11y_widget !== false ? (
        <A11yMenu
          rootId={rootId}
          statementHref={link("accessibility")}
          labels={{
            title: t("websites.site.a11y.title"),
            big: t("websites.site.a11y.big"),
            contrast: t("websites.site.a11y.contrast"),
            links: t("websites.site.a11y.links"),
            still: t("websites.site.a11y.still"),
            statement: LEGAL_TITLES[lang === "en" ? "en" : lang === "ar" ? "ar" : "he"].accessibility,
            close: t("common.close"),
          }}
        />
      ) : null}
      {s.cookie_banner !== false ? <CookieBanner text={t("websites.site.cookieText")} accept={t("websites.site.cookieOk")} more={LEGAL_TITLES[lang === "en" ? "en" : lang === "ar" ? "ar" : "he"].cookies} href={link("cookies")} /> : null}
      <SiteMotion rootId={rootId} enabled={th.animations} />
    </div>
  );
}

function fontFamily(k: keyof typeof FONTS) {
  return FONTS[k]?.family ?? "Rubik";
}
function fontFallback(k: keyof typeof FONTS) {
  return FONTS[k]?.fallback ?? "system-ui, sans-serif";
}
