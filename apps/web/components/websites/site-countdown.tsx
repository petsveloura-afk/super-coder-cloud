"use client";

import { useEffect, useState } from "react";

/**
 * Wave 37 — offer countdown for the "countdown" section (client island of the published site).
 * Deterministic first render (dashes) so hydration never mismatches; ticks every second; once the
 * date has passed it renders nothing at all.
 */
export function SiteCountdown({ endsAt, labels }: { endsAt: string; labels: { d: string; h: string; m: string; s: string } }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const end = new Date(`${endsAt}T23:59:59`).getTime();
    if (!Number.isFinite(end)) return;
    const tick = () => setLeft(end - Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAt]);
  if (left !== null && left <= 0) return null;
  const total = left === null ? null : Math.floor(left / 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  const parts: [string, string][] =
    total === null
      ? [[labels.d, "--"], [labels.h, "--"], [labels.m, "--"], [labels.s, "--"]]
      : [[labels.d, String(Math.floor(total / 86400))], [labels.h, two(Math.floor((total % 86400) / 3600))], [labels.m, two(Math.floor((total % 3600) / 60))], [labels.s, two(total % 60)]];
  return (
    <div className="cd" role="timer" aria-live="off" dir="ltr">
      {parts.map(([l, v]) => (
        <div key={l} className="cd-c">
          <b>{v}</b>
          <span>{l}</span>
        </div>
      ))}
    </div>
  );
}
