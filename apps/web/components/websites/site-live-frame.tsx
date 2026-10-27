"use client";

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FormField, SiteBlock } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { safeDraft } from "@/lib/site/live-draft";
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
/** frame → editor: "draft #seq is on screen" (the editor re-sends until it gets this) */
export const LIVE_ACK = "scc-site-ack";

/** inert stand-in fields so a form section looks right in the preview (labels come from websites.live.field.*) */
const STUB_FIELDS: Array<Pick<FormField, "key" | "type" | "required">> = [
  { key: "name", type: "text", required: true },
  { key: "phone", type: "phone", required: true },
  { key: "message", type: "textarea", required: false },
];

/** frame inside the editor → parent; opened as its own tab → opener */
const host = (): Window | null => (window.parent !== window ? window.parent : (window.opener as Window | null));

/** keeps the last good picture on screen if one draft cannot be drawn; the next draft clears the error */
class FrameBoundary extends Component<{ resetKey: unknown; onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  private last: ReactNode = null;
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidMount() {
    this.last = this.props.children;
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override componentDidUpdate(prev: { resetKey: unknown }) {
    if (!this.state.failed) this.last = this.props.children;
    if (prev.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  override render() {
    return this.state.failed ? this.last : this.props.children;
  }
}

export function SiteLiveFrame() {
  const { t, locale } = useI18n();
  const [site, setSite] = useState<RenderableSite | null>(null);
  const [broken, setBroken] = useState(false);
  const seqRef = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const m = e.data as { type?: string; site?: RenderableSite; index?: number; flash?: boolean } | null;
      if (!m || typeof m !== "object") return;
      if (m.type === LIVE_DRAFT && m.site && Array.isArray(m.site.blocks)) {
        seqRef.current = typeof (m as { seq?: number }).seq === "number" ? ((m as { seq?: number }).seq as number) : seqRef.current;
        setBroken(false);
        setSite(safeDraft(m.site));
      }
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
    // inside the editor's iframe the parent asks; opened as its own tab (wave 34) the opener does
    host()?.postMessage({ type: LIVE_READY }, window.location.origin);
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
    const id = window.requestAnimationFrame(() => {
      root.querySelectorAll<HTMLElement>("[data-reveal]:not(.in)").forEach((el) => el.classList.add("in"));
      // tell the editor this draft is really on screen (it re-sends until it hears this)
      host()?.postMessage({ type: LIVE_ACK, seq: seqRef.current, blocks: site.blocks.length }, window.location.origin);
    });
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
      {broken ? (
        <div role="alert" style={{ position: "fixed", insetInline: 12, top: 12, zIndex: 50, padding: "8px 12px", borderRadius: 10, background: "rgba(245,158,11,.95)", color: "#1f1300", fontSize: 13, fontWeight: 600 }}>
          {t("websites.live.broken")}
        </div>
      ) : null}
      <style>{`.scc-flash{animation:sccFlash 1.6s ease-out 1;outline-offset:-6px}@keyframes sccFlash{0%{outline:3px solid rgba(99,102,241,.95);background-color:rgba(99,102,241,.16)}70%{outline:3px solid rgba(99,102,241,.5)}100%{outline:3px solid transparent}}@media (prefers-reduced-motion:reduce){.scc-flash{animation:none;outline:3px solid rgba(99,102,241,.7)}}`}</style>
      {site ? (
        <FrameBoundary
          resetKey={site}
          onError={() => {
            setBroken(true);
            host()?.postMessage({ type: LIVE_ACK, seq: seqRef.current, blocks: 0, error: true }, window.location.origin);
          }}
        >
          <SiteRenderer site={site} forms={forms} locale={locale} t={t} basePath="" />
        </FrameBoundary>
      ) : (
        <div style={{ display: "grid", placeItems: "center", minHeight: "60dvh", opacity: 0.6, fontSize: 14 }} aria-live="polite">
          {t("websites.live.loading")}
        </div>
      )}
    </div>
  );
}
