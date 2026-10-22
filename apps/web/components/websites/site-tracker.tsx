"use client";

import { useEffect, useState } from "react";

/**
 * Wave 17 — privacy-friendly behavior tracking on a published website:
 *  - a random first-party visitor id (no IP / fingerprint), honoring "Do Not Track"
 *  - page view + time on page (sent when the tab is hidden) + button clicks
 *  - the A/B variant the visitor sees (kept in a cookie so it never flips)
 * A form submit links the visitor to the new contact → "visited 3 times" automations.
 */
const VID = "scc_vid";

function readCookie(name: string): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]!) : null;
  } catch {
    return null;
  }
}
function writeCookie(name: string, value: string) {
  try {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
  } catch {
    /* blocked cookies: tracking is simply off */
  }
}

function newId(): string {
  try {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function siteVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    if (navigator.doNotTrack === "1") return null;
    // GDPR mode (set by SiteTracker): nothing before the visitor accepted cookies
    if ((window as unknown as { __sccConsentRequired?: boolean }).__sccConsentRequired && window.localStorage.getItem("scc-cookies") !== "1") return null;
  } catch {
    /* ignore */
  }
  let id = readCookie(VID);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = newId();
    writeCookie(VID, id);
  }
  return id;
}

export function trackSite(slug: string, event: "view" | "time" | "click" | "convert", extra: { seconds?: number; variant?: string | null } = {}) {
  const visitor = siteVisitorId();
  if (!visitor) return;
  const body = JSON.stringify({ slug, visitor, event, path: location.pathname.slice(0, 300), seconds: extra.seconds ?? 0, variant: extra.variant ?? null });
  try {
    if (event === "time" && navigator.sendBeacon) {
      navigator.sendBeacon("/api/site/track", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/site/track", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => undefined);
  } catch {
    /* tracking never breaks the page */
  }
}

function consented(): boolean {
  try {
    return window.localStorage.getItem("scc-cookies") === "1";
  } catch {
    return false;
  }
}

export function SiteTracker({ slug, variant, abCookie, requireConsent = false }: { slug: string; variant: "a" | "b" | null; abCookie: string | null; requireConsent?: boolean }) {
  const [started, setStarted] = useState(0);
  useEffect(() => {
    try {
      (window as unknown as { __sccConsentRequired?: boolean }).__sccConsentRequired = requireConsent;
    } catch {
      /* ignore */
    }
    // GDPR mode: statistics only after the visitor accepted cookies
    if (requireConsent && !consented()) {
      const onAccept = () => setStarted((n) => n + 1);
      window.addEventListener("scc:cookies-accepted", onAccept);
      return () => window.removeEventListener("scc:cookies-accepted", onAccept);
    }
    return undefined;
  }, [requireConsent]);
  useEffect(() => {
    if (variant && abCookie) writeCookie(abCookie, variant);
    if (requireConsent && !consented()) return undefined;
    try {
      (window as unknown as { __sccSite?: { slug: string; variant: string | null } }).__sccSite = { slug, variant };
    } catch {
      /* ignore */
    }
    trackSite(slug, "view", { variant });
    let shownAt = Date.now();
    let sent = 0;
    const flush = () => {
      const secs = Math.round((Date.now() - shownAt) / 1000);
      if (secs >= 3 && sent < 20) {
        sent += 1;
        trackSite(slug, "time", { seconds: secs, variant });
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
      else shownAt = Date.now();
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href],button");
      if (a && a.closest("[data-site-cta]")) trackSite(slug, "click", { variant });
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("click", onClick);
    };
  }, [slug, variant, abCookie, requireConsent, started]);
  return null;
}
