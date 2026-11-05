"use client";

import { useEffect } from "react";
import { countTarget, formatCount } from "@/lib/site/effects-core";

/**
 * The effects pack of a published site (a small client island next to SiteMotion; nothing there changed).
 *   subtle: scroll progress bar, staggered reveal of cards, counting numbers in the stats section, back-to-top button
 *   rich:   + spotlight that follows the pointer on cards
 * Everything respects "reduce motion" (the visitor's system setting and the site's accessibility menu "still").
 */
export function SiteEffects({ rootId, level }: { rootId: string; level: "subtle" | "rich" }) {
  useEffect(() => {
    const root = document.getElementById(rootId);
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches || root.classList.contains("a11y-still");
    const cleanups: (() => void)[] = [];

    // 1. staggered reveal: cards in the same row appear one after the other (the delay is removed after the reveal,
    //    so hovering a card later is instant)
    if (!reduce && "MutationObserver" in window) {
      const items: HTMLElement[] = [];
      root.querySelectorAll<HTMLElement>(".grid, .steps, .gallery, .plans, .team").forEach((g) => {
        Array.from(g.children).forEach((c, i) => {
          const el = c as HTMLElement;
          if (!el.hasAttribute("data-reveal") || el.classList.contains("in")) return;
          el.style.setProperty("--i", String(i % 6));
          items.push(el);
        });
      });
      const timers: number[] = [];
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          const el = m.target as HTMLElement;
          if (!el.classList.contains("in") || el.dataset.fxStaggered) continue;
          el.dataset.fxStaggered = "1";
          const i = Number(el.style.getPropertyValue("--i") || 0);
          if (!i) continue;
          el.style.transitionDelay = `${i * 90}ms`;
          timers.push(window.setTimeout(() => (el.style.transitionDelay = ""), i * 90 + 900));
        }
      });
      items.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ["class"] }));
      cleanups.push(() => {
        mo.disconnect();
        timers.forEach((t) => clearTimeout(t));
      });
    }

    // 2. scroll progress bar + back to top
    const bar = document.createElement("div");
    bar.className = "fx-progress";
    bar.setAttribute("aria-hidden", "true");
    root.appendChild(bar);
    const top = document.createElement("button");
    top.type = "button";
    top.className = "fx-top";
    top.setAttribute("aria-label", root.getAttribute("lang") === "en" ? "Back to top" : root.getAttribute("lang") === "ar" ? "العودة إلى الأعلى" : "חזרה למעלה");
    top.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }));
    root.appendChild(top);
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const h = document.documentElement.scrollHeight - window.innerHeight;
        const p = h > 0 ? Math.min(1, Math.max(0, window.scrollY / h)) : 0;
        bar.style.setProperty("--p", p.toFixed(4));
        top.classList.toggle("on", window.scrollY > window.innerHeight * 0.9);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    cleanups.push(() => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      bar.remove();
      top.remove();
    });

    // 3. counting numbers ("1,200+" counts up from 0 when it comes into view; text without a number stays as it is)
    const stats = Array.from(root.querySelectorAll<HTMLElement>(".stat b"));
    if (stats.length && !reduce && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            io.unobserve(e.target);
            const el = e.target as HTMLElement;
            const original = el.dataset.fxText ?? el.textContent ?? "";
            el.dataset.fxText = original;
            const t = countTarget(original);
            if (!t) continue;
            const start = performance.now();
            const dur = 1400;
            const step = (now: number) => {
              const k = Math.min(1, (now - start) / dur);
              const eased = 1 - Math.pow(1 - k, 3);
              el.textContent = formatCount(t, t.value * eased);
              if (k < 1) requestAnimationFrame(step);
              else el.textContent = original;
            };
            requestAnimationFrame(step);
          }
        },
        { threshold: 0.4 },
      );
      stats.forEach((s) => io.observe(s));
      cleanups.push(() => io.disconnect());
    }

    // 4. rich: a soft spotlight follows the pointer over cards (desktop pointers only)
    if (level === "rich" && !reduce && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      const onMove = (ev: PointerEvent) => {
        const card = (ev.target as HTMLElement | null)?.closest?.(".card") as HTMLElement | null;
        if (!card || !root.contains(card)) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${ev.clientX - r.left}px`);
        card.style.setProperty("--my", `${ev.clientY - r.top}px`);
      };
      root.addEventListener("pointermove", onMove, { passive: true });
      cleanups.push(() => root.removeEventListener("pointermove", onMove));
    }

    return () => cleanups.forEach((f) => f());
  }, [rootId, level]);
  return null;
}
