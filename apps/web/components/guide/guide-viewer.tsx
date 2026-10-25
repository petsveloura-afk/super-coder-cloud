"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { guideLinks } from "@/lib/guide/map";

/**
 * Wave 23 — the user guide inside the app: a row of pages (one step each), real screenshots with
 * numbered markers, labels and arrows, chapter chips and search. The guide engine is a small
 * self-contained script + scoped stylesheet in /public/guide (also used by the marketing site).
 */
declare global {
  interface Window {
    SCCGuide?: { mount: (root: HTMLElement, opts?: { links?: Record<string, string | null> }) => () => void };
    SCC_GUIDE?: unknown;
  }
}

const VERSION = "23";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const found = document.querySelector<HTMLScriptElement>(`script[data-scc-guide="${src}"]`);
    if (found) {
      if (found.dataset.ready === "1") return resolve();
      found.addEventListener("load", () => resolve());
      found.addEventListener("error", () => reject(new Error(src)));
      return;
    }
    const s = document.createElement("script");
    s.src = `${src}?v=${VERSION}`;
    s.async = false;
    s.dataset.sccGuide = src;
    s.addEventListener("load", () => {
      s.dataset.ready = "1";
      resolve();
    });
    s.addEventListener("error", () => reject(new Error(src)));
    document.head.appendChild(s);
  });
}

export function GuideViewer() {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!document.querySelector("link[data-scc-guide]")) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = `/guide/scc-guide.css?v=${VERSION}`;
      l.dataset.sccGuide = "1";
      document.head.appendChild(l);
    }
    let destroy: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        await loadScript("/guide/guide-data.js");
        await loadScript("/guide/scc-guide.js");
        if (cancelled || !ref.current || !window.SCCGuide) return;
        destroy = window.SCCGuide.mount(ref.current, { links: guideLinks(locale) });
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [locale]);

  return (
    <div className="scc-guide" dir="rtl" lang="he" data-testid="guide">
      {state === "loading" ? <p className="py-10 text-center text-[14px]" style={{ color: "#9aa8c4" }}>{t("guide.loading")}</p> : null}
      {state === "error" ? <p className="py-10 text-center text-[14px]" style={{ color: "#ff8a7f" }} role="alert">{t("common.error")}</p> : null}
      <div ref={ref} />
    </div>
  );
}
