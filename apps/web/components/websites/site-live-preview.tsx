"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, RefreshCw, Smartphone, Tablet, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { LIVE_DRAFT, LIVE_READY, LIVE_SCROLL } from "./site-live-frame";

/**
 * Wave 33 — live preview of the site INSIDE the editor.
 * An iframe (a real viewport, so the site's responsive layout and sticky header behave exactly
 * like for visitors) shows the editor's current — unsaved — state, so whatever the agent or the
 * owner changes is visible at once. Desktop / tablet / phone widths, reload, and "scroll to
 * section" with a highlight (used after an agent edit).
 */
type Device = "desktop" | "tablet" | "phone";
/** the virtual viewport width of each device — the frame is scaled down to fit narrow panes */
const VIEWPORT: Record<Device, number> = { desktop: 1280, tablet: 820, phone: 390 };

export interface LiveDraft {
  name: string;
  slug: string;
  theme: Record<string, unknown>;
  blocks: unknown[];
  settings?: unknown;
  pages?: unknown;
}

export function SiteLivePreview({ draft, scrollTo, onClose, className }: { draft: LiveDraft; scrollTo?: { index: number; nonce: number } | null; onClose?: () => void; className?: string }) {
  const { t, locale } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [device, setDevice] = useState<Device>("desktop");
  const [syncing, setSyncing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const framed = device !== "desktop";
  const availW = Math.max(0, size.w - (framed ? 36 : 0));
  const availH = Math.max(0, size.h - (framed ? 36 : 0));
  const vw = VIEWPORT[device];
  const scale = availW > 0 ? Math.min(1, availW / vw) : 1;
  const latest = useRef(draft);
  useEffect(() => {
    latest.current = draft;
  }, [draft]);

  const post = useCallback((msg: unknown) => {
    frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if ((e.data as { type?: string } | null)?.type === LIVE_READY) {
        setReady(true);
        post({ type: LIVE_DRAFT, site: latest.current });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [post]);

  // push every change (debounced) — typing stays smooth
  useEffect(() => {
    if (!ready) return;
    let done: number | undefined;
    const id = window.setTimeout(() => {
      setSyncing(true);
      post({ type: LIVE_DRAFT, site: draft });
      done = window.setTimeout(() => setSyncing(false), 350);
    }, 140);
    return () => {
      window.clearTimeout(id);
      if (done) window.clearTimeout(done);
    };
  }, [draft, ready, post]);

  // scroll + flash a section (after the draft reached the frame)
  useEffect(() => {
    if (!ready || !scrollTo) return;
    const id = window.setTimeout(() => post({ type: LIVE_SCROLL, index: scrollTo.index, flash: true }), 600);
    return () => window.clearTimeout(id);
  }, [scrollTo, ready, post]);

  const devices: { k: Device; icon: typeof Monitor; label: string }[] = [
    { k: "desktop", icon: Monitor, label: t("websites.live.desktop") },
    { k: "tablet", icon: Tablet, label: t("websites.live.tablet") },
    { k: "phone", icon: Smartphone, label: t("websites.live.phone") },
  ];
  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card", className)} data-testid="site-live-preview">
      <div className="flex items-center gap-1.5 border-b border-line bg-surface-hover/40 px-3 py-2">
        <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
          <span className={cn("absolute inline-flex h-full w-full rounded-full bg-accent opacity-60", syncing && "animate-ping")} />
          <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", ready ? "bg-accent" : "bg-subtle")} />
        </span>
        <span className="text-[12.5px] font-semibold">{t("websites.live.title")}</span>
        <span className="hidden text-[12px] text-subtle sm:inline" aria-live="polite">
          {syncing ? t("websites.live.updating") : t("websites.live.unsaved")}
        </span>
        <span className="flex-1" />
        <div role="group" aria-label={t("websites.live.device")} className="flex rounded-lg border border-line p-0.5">
          {devices.map((d) => (
            <button key={d.k} type="button" aria-pressed={device === d.k} aria-label={d.label} title={d.label} onClick={() => setDevice(d.k)} className={cn("grid h-7 w-8 place-items-center rounded-md transition", device === d.k ? "bg-accent-solid text-accent-fg" : "text-muted hover:text-fg")}>
              <d.icon className="h-4 w-4" />
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={t("websites.live.reload")}
          title={t("websites.live.reload")}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-fg"
          onClick={() => {
            setReady(false);
            frame.current?.contentWindow?.location.reload();
          }}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        {onClose ? (
          <button type="button" aria-label={t("common.close")} className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-fg" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden bg-[repeating-linear-gradient(45deg,transparent,transparent_10px,rgba(127,127,127,.05)_10px,rgba(127,127,127,.05)_20px)]">
        <div
          dir="ltr" className={cn("absolute overflow-hidden transition-[width,left,top,height] duration-300 ease-out", framed ? "rounded-[1.6rem] border-[6px] border-line bg-bg shadow-card" : "")}
          style={{ width: vw * scale + (framed ? 12 : 0), height: framed ? availH : "100%", left: Math.max(0, (size.w - (vw * scale + (framed ? 12 : 0))) / 2), top: framed ? 18 : 0 }}
        >
          <iframe
            ref={frame}
            src={`/${locale}/site-live`}
            title={t("websites.live.title")}
            className="border-0 bg-white"
            style={{ position: "absolute", left: 0, top: 0, width: vw, height: (framed ? availH - 12 : size.h || 600) / scale, transform: `scale(${scale})`, transformOrigin: "0 0" }}
            data-testid="site-live-iframe"
            onLoad={() => post({ type: LIVE_DRAFT, site: latest.current })}
          />
        </div>
        {!ready ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-surface/70 text-[13px] text-muted backdrop-blur-[1px]">
            <span className="animate-pulse">{t("websites.live.loading")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
