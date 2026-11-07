"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";

/**
 * Live campaign progress (additive). While a campaign is being sent, the page refreshes its numbers by itself every few
 * seconds (sent / failed / pending / the progress bar — all real counts from the server), with a small "live" mark.
 *
 * Why not a WebSocket: the platform runs on serverless functions, which cannot hold a socket open; a light server refresh
 * while the tab is VISIBLE gives the same experience with no extra infrastructure. It stops by itself when the send is done,
 * when the tab is hidden (and resumes when it is shown again), and after 30 minutes on the same page.
 */
export function CampaignLive({ status, pending, intervalMs = 4000 }: { status: string; pending: number; intervalMs?: number }) {
  const { t } = useI18n();
  const router = useRouter();
  const active = status === "sending" || (status === "scheduled" && pending > 0);
  const [ticks, setTicks] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!active) return;
    startedAt.current = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = () => {
      timer = setTimeout(() => {
        if (Date.now() - startedAt.current > 30 * 60_000) return;
        if (document.visibilityState === "visible") {
          router.refresh();
          setTicks((n) => n + 1);
        }
        loop();
      }, intervalMs);
    };
    loop();
    const onShow = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [active, intervalMs, router]);

  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-success" data-testid="campaign-live" data-ticks={ticks} aria-live="polite">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      {t("campaigns.live")}
    </span>
  );
}
