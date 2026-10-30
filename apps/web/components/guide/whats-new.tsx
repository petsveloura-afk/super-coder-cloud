"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Lightbulb, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { WHATS_NEW, type NewCard, type Scene } from "@/lib/guide/whats-new";

/**
 * Wave 57 — "what's new" in the guide: chapter chips, animated cards (a small live illustration of each
 * capability), numbered steps, a highlighted tip and a link to the screen. Motion respects
 * prefers-reduced-motion. Placed above the screenshot guide; the guide itself is unchanged.
 */
const CSS = `
.gn-scene{position:relative;height:9.5rem;overflow:hidden;border-radius:1rem;background:linear-gradient(135deg,var(--accent-soft),transparent 70%),var(--elevated)}
.gn-in{opacity:0;animation:gnIn .5s ease forwards}
@keyframes gnIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.gn-pop{opacity:0;animation:gnPop 6s ease infinite}
@keyframes gnPop{0%{opacity:0;transform:translateY(6px)}8%,80%{opacity:1;transform:none}92%,100%{opacity:0}}
.gn-bar{transform-origin:bottom;animation:gnGrow 2.4s ease-in-out infinite alternate}
@keyframes gnGrow{from{transform:scaleY(.35)}to{transform:scaleY(1)}}
.gn-ring{animation:gnRing 2s ease-out infinite}
@keyframes gnRing{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 45%,transparent)}100%{box-shadow:0 0 0 18px transparent}}
.gn-wave i{display:inline-block;width:4px;margin:0 2px;border-radius:2px;background:var(--accent-solid);animation:gnWave 1s ease-in-out infinite}
@keyframes gnWave{0%,100%{height:8px}50%{height:34px}}
.gn-fill{animation:gnFill 3s ease-in-out infinite alternate}
@keyframes gnFill{from{width:12%}to{width:92%}}
.gn-tick{opacity:0;animation:gnPop 6s ease infinite}
.gn-dots i{display:inline-block;width:6px;height:6px;margin:0 2px;border-radius:9999px;background:currentColor;animation:gnDot 1.2s infinite}
@keyframes gnDot{0%,80%,100%{opacity:.25}40%{opacity:1}}
@media (prefers-reduced-motion:reduce){.gn-in,.gn-pop,.gn-bar,.gn-ring,.gn-wave i,.gn-fill,.gn-tick,.gn-dots i{animation:none!important;opacity:1!important;transform:none!important}}
`;

function Bubble({ me, text, delay }: { me?: boolean; text: string; delay: number }) {
  return (
    <div className={cn("gn-pop flex", me ? "justify-start" : "justify-end")} style={{ animationDelay: `${delay}s` }}>
      <span className={cn("max-w-[80%] rounded-2xl px-3 py-1.5 text-[12px] shadow-sm", me ? "bg-accent-solid text-accent-fg" : "bg-surface text-fg ring-1 ring-line")}>{text}</span>
    </div>
  );
}

function SceneView({ scene, demo }: { scene: Scene; demo: string[] }) {
  switch (scene) {
    case "chat":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 p-3">
          {demo.slice(0, 4).map((t, i) => (
            <Bubble key={i} me={i % 2 === 1} text={t} delay={i * 1.1} />
          ))}
        </div>
      );
    case "phone":
    case "voice":
      return (
        <div className="flex h-full items-center justify-center gap-5 p-3">
          <span className="gn-ring grid h-14 w-14 place-items-center rounded-full bg-accent-solid text-2xl text-accent-fg">{scene === "phone" ? "📞" : "🎙️"}</span>
          <div className="space-y-1.5">
            <div className="gn-wave flex h-9 items-center" aria-hidden>
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} style={{ animationDelay: `${i * 0.09}s` }} />
              ))}
            </div>
            {demo.map((t, i) => (
              <p key={i} className="gn-pop text-[12px] font-medium" style={{ animationDelay: `${i * 1.3}s` }}>
                {t}
              </p>
            ))}
          </div>
        </div>
      );
    case "plan":
      return (
        <div className="flex h-full flex-col justify-center gap-1.5 p-3">
          {demo.map((t, i) => (
            <div key={i} className="gn-pop flex items-center gap-2 rounded-xl bg-surface px-2.5 py-1.5 text-[12px] ring-1 ring-line" style={{ animationDelay: `${i * 0.9}s` }}>
              <span className="grid h-4 w-4 place-items-center rounded bg-success text-[10px] text-white">✓</span>
              <span className="truncate">{t}</span>
            </div>
          ))}
        </div>
      );
    case "funnel":
      return (
        <div className="flex h-full items-end justify-center gap-3 p-4">
          {demo.map((t, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="gn-bar w-9 rounded-t-lg bg-accent-solid" style={{ height: `${86 - i * 16}px`, animationDelay: `${i * 0.25}s`, opacity: 1 - i * 0.15 }} />
              <span className="text-[10.5px] text-muted">{t}</span>
            </div>
          ))}
        </div>
      );
    case "memory":
    case "team":
      return (
        <div className="flex h-full flex-wrap content-center items-center justify-center gap-2 p-3">
          {demo.map((t, i) => (
            <span key={i} className="gn-pop rounded-full bg-surface px-3 py-1.5 text-[12px] shadow-sm ring-1 ring-line" style={{ animationDelay: `${i * 0.8}s` }}>
              {scene === "memory" ? "🧠 " : ""}
              {t}
            </span>
          ))}
        </div>
      );
    case "lock":
      return (
        <div className="flex h-full items-center justify-center gap-3 p-3">
          {demo.map((t, i) => (
            <span key={i} className={cn("gn-pop rounded-xl px-3 py-2 text-[12px] font-semibold shadow-sm", i === 1 ? "bg-gold-soft text-gold ring-1 ring-gold/30" : i === 2 ? "bg-success-soft text-success" : "bg-surface ring-1 ring-line")} style={{ animationDelay: `${i * 1.2}s` }}>
              {t}
            </span>
          ))}
        </div>
      );
    case "calendar":
      return (
        <div className="flex h-full items-center justify-center gap-2 p-3">
          {demo.map((t, i) => (
            <div key={i} className="gn-pop w-20 overflow-hidden rounded-xl bg-surface text-center shadow-sm ring-1 ring-line" style={{ animationDelay: `${i * 0.9}s` }}>
              <div className="bg-accent-solid py-0.5 text-[10px] text-accent-fg">סגור</div>
              <div className="px-1 py-2 text-[11.5px] font-medium">{t}</div>
            </div>
          ))}
        </div>
      );
    case "post":
      return (
        <div className="flex h-full items-center justify-center p-3">
          <div className="w-52 overflow-hidden rounded-xl bg-surface shadow-sm ring-1 ring-line">
            <div className="gn-fill h-14 bg-gradient-to-l from-accent-soft to-accent-solid/40" />
            <div className="space-y-1 p-2">
              {demo.map((t, i) => (
                <p key={i} className="gn-pop text-[11.5px]" style={{ animationDelay: `${i * 1}s` }}>
                  {t}
                </p>
              ))}
            </div>
          </div>
        </div>
      );
    case "pulse":
    case "shield":
      return (
        <div className="flex h-full flex-col justify-center gap-2 p-4">
          {demo.map((t, i) => (
            <div key={i} className="gn-pop flex items-center gap-2" style={{ animationDelay: `${i * 1}s` }}>
              <span className="w-24 shrink-0 text-[11.5px]">{t}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface ring-1 ring-line">
                <span className="gn-fill block h-full rounded-full bg-accent-solid" style={{ animationDelay: `${i * 0.4}s` }} />
              </span>
            </div>
          ))}
          {scene === "shield" ? (
            <span className="gn-dots self-end text-accent" aria-hidden>
              <i />
              <i style={{ animationDelay: ".2s" }} />
              <i style={{ animationDelay: ".4s" }} />
            </span>
          ) : null}
        </div>
      );
  }
}

function CardView({ c, i, locale }: { c: NewCard; i: number; locale: string }) {
  const Arrow = locale === "en" ? ArrowRight : ArrowLeft;
  return (
    <article className="gn-in lift flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" style={{ animationDelay: `${i * 0.08}s` }} data-new-card={c.id} id={`new-${c.id}`}>
      <div className="gn-scene m-3 mb-0" aria-hidden>
        <SceneView scene={c.scene} demo={c.demo} />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-bold text-gold">חדש</span>
        </div>
        <h3 className="text-[15.5px] font-bold leading-snug">{c.title}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{c.body}</p>
        <ol className="mt-3 space-y-1.5">
          {c.steps.map((s, k) => (
            <li key={k} className="flex gap-2 text-[13px]">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">{k + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        {c.tip ? (
          <p className="mt-3 flex gap-2 rounded-xl border border-gold/30 bg-gold-soft/60 p-2.5 text-[12.5px] leading-relaxed">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
            <span>
              <b>טיפ: </b>
              {c.tip}
            </span>
          </p>
        ) : null}
        {c.screen ? (
          <Link href={`/${locale}/${c.screen}`} className="mt-auto inline-flex items-center gap-1.5 pt-3 text-[13px] font-semibold text-accent hover:underline">
            פתיחת המסך במערכת <Arrow className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function WhatsNew() {
  const { t, locale } = useI18n();
  const [ch, setCh] = useState(WHATS_NEW[0]!.id);
  const chapter = WHATS_NEW.find((c) => c.id === ch) ?? WHATS_NEW[0]!;
  return (
    <section className="mb-6" aria-labelledby="whats-new-title" data-testid="whats-new">
      <style>{CSS}</style>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="whats-new-title" className="flex items-center gap-2 text-[18px] font-bold">
            <Sparkles className="h-5 w-5 text-gold" aria-hidden /> {t("guide.newTitle")}
          </h2>
          <p className="text-[13px] text-muted">{t("guide.newSubtitle")}</p>
        </div>
      </div>
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t("guide.newTitle")}>
        {WHATS_NEW.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === ch}
            onClick={() => setCh(c.id)}
            className={cn("shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold transition", c.id === ch ? "bg-accent-solid text-accent-fg shadow-sm" : "bg-surface text-fg ring-1 ring-line hover:bg-surface-hover")}
            data-new-chapter={c.id}
          >
            {c.name} <span className="ms-1 text-[11px] font-normal opacity-80">{c.time}</span>
          </button>
        ))}
      </div>
      <div key={chapter.id} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="tabpanel">
        {chapter.cards.map((c, i) => (
          <CardView key={c.id} c={c} i={i} locale={locale} />
        ))}
      </div>
    </section>
  );
}
