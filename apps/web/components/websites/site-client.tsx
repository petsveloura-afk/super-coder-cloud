"use client";

import { useEffect, useState } from "react";
import { Accessibility, X } from "lucide-react";

/**
 * Wave 13 — small client islands for published websites:
 *   SiteMotion  scroll reveal (IntersectionObserver) + header shadow; content is never
 *               hidden unless JS runs (the .motion class is added here)
 *   CookieBanner / A11yMenu  remembered per visitor in localStorage (wrapped in try/catch)
 */
const store = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* private mode — fine */
    }
  },
};

export function SiteMotion({ rootId, enabled }: { rootId: string; enabled: boolean }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const hdr = root.querySelector<HTMLElement>(".hdr");
    const onScroll = () => hdr?.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    let io: IntersectionObserver | null = null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (enabled && !reduce && "IntersectionObserver" in window) {
      const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
      // already on screen → no flash
      const vh = window.innerHeight;
      for (const el of els) if (el.getBoundingClientRect().top < vh * 0.92) el.classList.add("in");
      root.classList.add("motion");
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries)
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io?.unobserve(e.target);
            }
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
      );
      for (const el of els) if (!el.classList.contains("in")) io.observe(el);
    }
    // accessibility preferences saved by the visitor
    for (const m of ["big", "contrast", "links", "still"]) if (store.get(`scc-a11y-${m}`) === "1") root.classList.add(`a11y-${m}`);
    return () => {
      window.removeEventListener("scroll", onScroll);
      io?.disconnect();
    };
  }, [rootId, enabled]);
  return null;
}

export function CookieBanner({ text, accept, more, href }: { text: string; accept: string; more: string; href: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShow(store.get("scc-cookies") !== "1"), 900);
    return () => window.clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <div className="cookie" role="region" aria-label={more} data-testid="cookie-banner">
      <p>
        {text}{" "}
        <a href={href} style={{ textDecoration: "underline" }}>
          {more}
        </a>
      </p>
      <button
        type="button"
        className="btn btn-a"
        onClick={() => {
          store.set("scc-cookies", "1");
          setShow(false);
        }}
      >
        {accept}
      </button>
    </div>
  );
}

export function A11yMenu({ rootId, labels, statementHref }: { rootId: string; labels: Record<"title" | "big" | "contrast" | "links" | "still" | "statement" | "close", string>; statementHref: string }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const toggle = (m: string) => {
    const root = document.getElementById(rootId);
    const next = !root?.classList.contains(`a11y-${m}`);
    root?.classList.toggle(`a11y-${m}`, next);
    store.set(`scc-a11y-${m}`, next ? "1" : "0");
    setOn((x) => ({ ...x, [m]: next }));
  };
  return (
    <>
      <button type="button" className="a11y-btn" aria-label={labels.title} aria-expanded={open} onClick={() => {
          if (!open) {
            const root = document.getElementById(rootId);
            setOn(Object.fromEntries(["big", "contrast", "links", "still"].map((m) => [m, Boolean(root?.classList.contains(`a11y-${m}`))])));
          }
          setOpen((o) => !o);
        }} data-testid="a11y-button">
        <Accessibility className="h-6 w-6" aria-hidden="true" />
      </button>
      {open ? (
        <div className="a11y-panel" role="dialog" aria-label={labels.title} data-testid="a11y-panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>{labels.title}</h2>
            <button type="button" aria-label={labels.close} onClick={() => setOpen(false)} style={{ width: "auto", marginTop: 0, border: 0, padding: 4 }}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {(["big", "contrast", "links", "still"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={Boolean(on[m])} onClick={() => toggle(m)}>
              {labels[m]}
            </button>
          ))}
          <a href={statementHref}>{labels.statement}</a>
        </div>
      ) : null}
    </>
  );
}
