"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, CreditCard, Flame, PhoneCall, Radio } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Card, CardHeader } from "@/components/ui/primitives";
import { liveFeedAction } from "@/app/[locale]/(dashboard)/overview/actions";
import type { FeedItem } from "@/lib/dashboard/live-feed";

const ICON = { reply: Bot, lead: Flame, call: PhoneCall, paid: CreditCard } as const;
const TONE = { reply: "bg-gold-soft text-gold", lead: "bg-danger-soft text-danger", call: "bg-accent-soft text-accent", paid: "bg-success-soft text-success" } as const;

/**
 * Wave 59 — "what the agent is doing right now": the latest AI replies, leads, calls and payments, refreshed
 * every 20 seconds while the tab is visible; new rows slide in.
 */
export function LiveFeed({ initial }: { initial: FeedItem[] }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const r = await liveFeedAction({ locale });
        const next = r.data?.items;
        if (!stop && next) {
          setItems((prev) => {
            const known = new Set(prev.map((x) => x.id));
            setFresh(new Set(next.filter((x) => !known.has(x.id)).map((x) => x.id)));
            return next;
          });
        }
      } catch {
        /* offline: try again later */
      }
    };
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => {
      setNow(Date.now());
      void tick();
    }, 20_000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [locale]);
  const ago = (iso: string) => {
    if (now === null) return "";
    const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
    return m < 1 ? t("liveFeed.now") : m < 60 ? t("liveFeed.minutes", { n: String(m) }) : m < 1440 ? t("liveFeed.hours", { n: String(Math.round(m / 60)) }) : t("liveFeed.days", { n: String(Math.round(m / 1440)) });
  };
  return (
    <Card className="mb-4 overflow-hidden bento-glow" data-testid="live-feed">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
            </span>
            {t("liveFeed.title")}
          </span>
        }
        description={t("liveFeed.subtitle")}
      />
      {items.length ? (
        <ul className="divide-y divide-line" aria-live="polite">
          {items.map((it, i) => {
            const Icon = ICON[it.kind];
            return (
              <li key={it.id} className={fresh.has(it.id) || i < 6 ? "feed-in" : undefined} style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}>
                <Link href={`/${locale}${it.href}`} className="flex items-center gap-3 px-5 py-3 transition hover:bg-surface-hover">
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${TONE[it.kind]}`}>
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {t(`liveFeed.kind.${it.kind}`)}
                      {it.title ? <bdi className="ms-1 font-normal text-muted">{it.title}</bdi> : null}
                    </span>
                    {it.detail ? (
                      <span className="block truncate text-[12px] text-muted" dir="auto">
                        {it.detail}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted">{ago(it.at)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-2 px-5 pb-5 text-[13px] text-muted">
          <Radio className="h-4 w-4" aria-hidden /> {t("liveFeed.empty")}
        </p>
      )}
    </Card>
  );
}
