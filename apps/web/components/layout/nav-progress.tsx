"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Navigation progress (additive): a thin brand-gradient bar at the very top of the screen from the moment a link to another
 * screen is tapped until that screen has arrived — on every screen, phone and desktop. The tap is acknowledged at once, a
 * slow server never looks frozen, and the bar never gets stuck: it finishes when the new page shows, and hides by itself
 * after 12 seconds whatever happens. No layout shift (fixed, pointer-events: none); off for "reduce motion" (a still bar).
 */
export function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const from = useRef<string | null>(null);

  // a new page has arrived → complete and fade out
  useEffect(() => {
    if (from.current !== null && from.current !== pathname) {
      from.current = null;
      if (safety.current) clearTimeout(safety.current);
      setState("done");
      if (hide.current) clearTimeout(hide.current);
      hide.current = setTimeout(() => setState("idle"), 380);
    }
  }, [pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return; // same screen (a tab / hash / filter) — nothing to wait for
      from.current = window.location.pathname;
      if (hide.current) clearTimeout(hide.current);
      setState("loading");
      if (safety.current) clearTimeout(safety.current);
      safety.current = setTimeout(() => {
        from.current = null;
        setState("idle");
      }, 12_000);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (safety.current) clearTimeout(safety.current);
      if (hide.current) clearTimeout(hide.current);
    };
  }, []);

  if (state === "idle") return null;
  return (
    <div className="nav-progress" data-state={state} data-testid="nav-progress" role="progressbar" aria-label="loading" aria-busy={state === "loading"}>
      <span className="nav-progress-bar" />
    </div>
  );
}
