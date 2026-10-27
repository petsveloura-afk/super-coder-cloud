"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormField, SiteBlock } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { SiteRenderer, type FormsMap, type RenderableSite } from "./site-renderer";

/**
 * Wave 33 — runs INSIDE the editor's preview iframe. Messages (same origin only):
 *   editor → frame  {type:"scc-site-draft", site}   the current (unsaved) site
 *                   {type:"scc-site-scroll", index, flash}  scroll to / highlight a section
 *   frame → editor  {type:"scc-site-ready"}         ask for the draft
 * Forms and links are inert here, so clicking around the preview can never submit a
 * lead or leave the page.
 */
export const LIVE_DRAFT = "scc-site-draft";
export const LIVE_SCROLL = "scc-site-scroll";
export const LIVE_READY = "scc-site-ready";

const STUB_FIELDS: FormField[] = [
  { key: "name", label: "—", type: "text", required: false },
  { key: "phone", label: "—", type: "phone", required: false },
  { key: "message", label: "—", type: "textarea", required: false },
];

export function SiteLiveFrame() {
  const { t, locale } = useI18n();
  const [site, setSite] = useState<RenderableSite | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data as { type?: string; site?: RenderableSite; index?: number; flash?: boolean } | null;
      if (!m || typeof m !== "object") return;
      if (m.type === LIVE_DRAFT && m.site && Array.isArray(m.site.blocks)) setSite(m.site);
      if (m.type === LIVE_SCROLL && typeof m.index === "number") {
        const el = rootRef.current?.querySelector<HTMLElement>(`[data-bi="${m.index}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        if (m.flash) {
          el.classList.remove("scc-flash");
          void el.offsetWidth; // restart the animation
          el.classList.add("scc-flash");
        }
      }
    };
    window.addEventListener("message", onMsg);
    window.parent?.postMessage({ type: LIVE_READY }, window.location.origin);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // inert forms + links; every section is addressable (data-bi) for "scroll to section"
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.startsWith("#")) e.preventDefault(); // keep in-page anchors working
    };
    root.addEventListener("submit", stop, true);
    root.addEventListener("click", onClick, true);
    return () => {
      root.removeEventListener("submit", stop, true);
      root.removeEventListener("click", onClick, true);
    };
  }, []);

  // after every draft: reveal new sections with their own entrance animation; the classic
  // renderer has no section markers, so tag its sections by position (the pro one tags itself)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !site) return;
    if (!root.querySelector("[data-bi]")) root.querySelectorAll<HTMLElement>("main > section").forEach((s, i) => s.setAttribute("data-bi", String(i)));
    const id = window.requestAnimationFrame(() => root.querySelectorAll<HTMLElement>("[data-reveal]:not(.in)").forEach((el) => el.classList.add("in")));
    return () => window.cancelAnimationFrame(id);
  }, [site]);

  const forms = useMemo<FormsMap>(() => {
    const map: FormsMap = new Map();
    for (const b of (site?.blocks ?? []) as SiteBlock[]) {
      if (b.type === "form" && b.data.form_slug) map.set(b.data.form_slug, { name: b.data.title || b.data.form_slug, fields: STUB_FIELDS.map((f) => ({ ...f, label: t(`websites.live.field.${f.key}`) })), settings: {}, org: "" });
    }
    return map;
  }, [site, t]);

  return (
    <div ref={rootRef} data-testid="site-live-frame">
      <style>{`.scc-flash{animation:sccFlash 1.6s ease-out 1;outline-offset:-6px}@keyframes sccFlash{0%{outline:3px solid rgba(99,102,241,.95);background-color:rgba(99,102,241,.16)}70%{outline:3px solid rgba(99,102,241,.5)}100%{outline:3px solid transparent}}@media (prefers-reduced-motion:reduce){.scc-flash{animation:none;outline:3px solid rgba(99,102,241,.7)}}`}</style>
      {site ? (
        <SiteRenderer site={site} forms={forms} locale={locale} t={t} basePath="" />
      ) : (
        <div style={{ display: "grid", placeItems: "center", minHeight: "60dvh", opacity: 0.6, fontSize: 14 }} aria-live="polite">
          {t("websites.live.loading")}
        </div>
      )}
    </div>
  );
}
