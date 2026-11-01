"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Pencil, Play, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { Badge, Button } from "@/components/ui/primitives";
import { AgentAvatar } from "./avatar";
import type { TeamMemberView } from "./types";

/**
 * The team as a 3D presentation: the employees stand on a rotating ring (CSS 3D — perspective, preserve-3d,
 * reflections, a glowing floor). Navigate with the arrows, the keyboard (← / →, Home / End, Enter to edit),
 * drag / swipe, or a click on a card. It spins by itself until touched (never under reduced motion).
 * The last card on the ring is "Hire an employee".
 */
export function Presentation3D({ members, onEdit, onAdd, canManage }: { members: TeamMemberView[]; onEdit: (m: TeamMemberView) => void; onAdd: () => void; canManage: boolean }) {
  const { t, dir } = useI18n();
  const slots = useMemo(() => [...members.map((m) => ({ kind: "member" as const, m })), ...(canManage ? [{ kind: "add" as const, m: null }] : [])], [members, canManage]);
  const n = Math.max(slots.length, 1);
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ x: number; delta: number } | null>(null);
  const [auto, setAuto] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);
  // a drag must not also count as a click on the card under the pointer
  const moved = useRef(false);

  useEffect(() => {
    try {
      reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduced.current = false;
    }
  }, []);

  // auto-rotation (stops on any interaction and never runs under reduced motion)
  useEffect(() => {
    if (!auto || n < 2) return;
    const id = setInterval(() => {
      if (!reduced.current) setIndex((i) => (i + 1) % n);
    }, 4200);
    return () => clearInterval(id);
  }, [auto, n]);

  const go = useCallback((d: number) => {
    setAuto(false);
    setIndex((i) => (((i + d) % n) + n) % n);
  }, [n]);

  const angle = 360 / n;
  const cardW = 230;
  const radius = Math.max(280, Math.round(cardW / 2 / Math.tan(Math.PI / Math.max(n, 3))) + 60);
  const sign = dir === "rtl" ? -1 : 1;
  const dragTurn = drag ? (drag.delta / cardW) * angle * sign : 0;
  const rotation = -index * angle + dragTurn;

  const onKey = (e: React.KeyboardEvent) => {
    const fwd = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
    const back = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
    if (e.key === fwd) {
      e.preventDefault();
      go(1);
    } else if (e.key === back) {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Home") {
      setAuto(false);
      setIndex(0);
    } else if (e.key === "End") {
      setAuto(false);
      setIndex(n - 1);
    } else if (e.key === "Enter") {
      const s = slots[index];
      if (s?.kind === "member") onEdit(s.m);
      else if (s?.kind === "add") onAdd();
    }
  };

  const front = slots[index];

  return (
    <section className="relative" aria-roledescription="carousel" aria-label={t("aiTeam.views.presentation")} data-testid="team-presentation">
      <div
        ref={stage}
        className="team-stage relative mx-auto h-[440px] w-full select-none overflow-hidden rounded-[32px] border border-line bg-gradient-to-b from-surface via-bg to-bg outline-none focus-visible:ring-2 focus-visible:ring-accent sm:h-[480px]"
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          setAuto(false);
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          setDrag({ x: e.clientX, delta: 0 });
        }}
        onPointerMove={(e) => drag && setDrag({ x: drag.x, delta: e.clientX - drag.x })}
        onPointerUp={() => {
          moved.current = Boolean(drag && Math.abs(drag.delta) > 8);
          if (drag && Math.abs(drag.delta) > 30) go(Math.round((-drag.delta * sign) / cardW) || (drag.delta * sign < 0 ? 1 : -1));
          setDrag(null);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <div className="team-floor pointer-events-none absolute inset-x-[-20%] bottom-[-120px] h-[340px]" aria-hidden />
        <div className={cn("team-ring absolute inset-0", drag && "dragging")} style={{ transform: `translateZ(${-radius}px) rotateY(${rotation}deg)` }}>
          {slots.map((s, i) => {
            const isFront = i === index;
            const style = { width: cardW, height: 320, transform: `rotateY(${i * angle}deg) translateZ(${radius}px)` } as const;
            const dist = Math.min(Math.abs(i - index), n - Math.abs(i - index));
            return (
              <div key={s.kind === "member" ? s.m.id : "add"} className="team-card3d" style={{ ...style, filter: isFront ? "none" : `brightness(${Math.max(0.55, 1 - dist * 0.16)}) saturate(${Math.max(0.6, 1 - dist * 0.12)})`, opacity: dist > 3 ? 0.35 : 1 }} aria-hidden={!isFront}>
                <button
                  type="button"
                  tabIndex={isFront ? 0 : -1}
                  onClick={() => {
                    if (moved.current) {
                      moved.current = false;
                      return;
                    }
                    if (!isFront) {
                      setAuto(false);
                      setIndex(i);
                      return;
                    }
                    if (s.kind === "member") onEdit(s.m);
                    else onAdd();
                  }}
                  className={cn("group relative flex h-full w-full flex-col items-center justify-center gap-3 rounded-[28px] border p-5 text-center shadow-2xl transition", isFront ? "team-front border-accent/50 bg-elevated ring-2 ring-accent/25" : "border-line bg-surface", s.kind === "add" && "border-dashed")}
                  data-testid={s.kind === "member" ? `card-${s.m.role_key}` : "card-add"}
                >
                  {s.kind === "member" ? (
                    <>
                      <span className="absolute inset-x-6 top-0 h-1 rounded-b-full" style={{ background: `hsl(${s.m.avatar.hue ?? 222} 85% 55%)` }} />
                      <AgentAvatar spec={s.m.avatar} state={s.m.status === "paused" ? "paused" : s.m.live} size={isFront ? 132 : 110} label={s.m.name} />
                      <span className="text-[17px] font-bold leading-tight">{s.m.name}</span>
                      <span className="text-[12.5px] text-muted">{s.m.title || t(`aiTeam.roles.${s.m.role_key}`)}</span>
                      <Badge tone={s.m.status === "paused" ? "neutral" : s.m.live === "working" ? "accent" : s.m.live === "waiting" ? "warning" : s.m.live === "error" ? "danger" : "success"}>{t(`aiTeam.live.${s.m.status === "paused" ? "paused" : s.m.live}`)}</Badge>
                      {isFront && s.m.working_on ? <span className="line-clamp-2 text-[12px] text-subtle">{t("aiTeam.card.workingOn")}: {s.m.working_on}</span> : null}
                      {isFront && canManage ? (
                        <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                          <Pencil className="h-3.5 w-3.5" /> {t("aiTeam.card.edit")}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="grid h-24 w-24 place-items-center rounded-full border-2 border-dashed border-accent/50 bg-accent-soft text-accent">
                        <Plus className="h-10 w-10" />
                      </span>
                      <span className="text-[16px] font-bold">{t("aiTeam.hire.title")}</span>
                      <span className="text-[12.5px] text-muted">{t("aiTeam.hire.short")}</span>
                    </>
                  )}
                </button>
                <div className="team-reflect rounded-[28px] bg-gradient-to-b from-accent/40 to-transparent" aria-hidden />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => go(-1)} aria-label={t("aiTeam.pres.prev")}>
          {dir === "rtl" ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
        <div className="flex items-center gap-1.5" role="tablist" aria-label={t("aiTeam.pres.slides")}>
          {slots.map((s, i) => (
            <button
              key={s.kind === "member" ? s.m.id : "add-dot"}
              role="tab"
              aria-selected={i === index}
              aria-label={s.kind === "member" ? s.m.name : t("aiTeam.hire.title")}
              onClick={() => {
                setAuto(false);
                setIndex(i);
              }}
              className={cn("h-2.5 rounded-full transition-all", i === index ? "w-7 bg-accent" : "w-2.5 bg-line-strong hover:bg-accent/60")}
            />
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => go(1)} aria-label={t("aiTeam.pres.next")}>
          {dir === "rtl" ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAuto(!auto)} aria-pressed={auto} aria-label={t(auto ? "aiTeam.pres.pause" : "aiTeam.pres.play")}>
          {auto ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      </div>
      <p className="sr-only" aria-live="polite">
        {front?.kind === "member" ? `${front.m.name} — ${t(`aiTeam.roles.${front.m.role_key}`)}` : t("aiTeam.hire.title")}
      </p>
    </section>
  );
}
