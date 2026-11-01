"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { AvatarSpec, LiveState } from "./types";

/**
 * An animated employee avatar (pure SVG + CSS, no extra libraries). The look is the person's choice (colour, hair,
 * skin, expression, accessory); the motion shows what the employee is doing:
 *   idle → breathing · working → busy (bobbing, typing dots) · waiting → amber pulse with "?" · success → green check
 *   pop · error → shake with "!" · paused → greyed. All motion stops under prefers-reduced-motion (see globals.css).
 */
const SKIN: Record<NonNullable<AvatarSpec["skin"]>, string> = { light: "#f6d7c3", tan: "#e3b38f", brown: "#b47b55", dark: "#7a4a2c" };

function Accessory({ kind, hue }: { kind: string; hue: number }) {
  const c = `hsl(${hue} 80% 45%)`;
  switch (kind) {
    case "tie":
      return <path d="M50 66 l-4 6 4 16 4 -16 z" fill={c} />;
    case "headset":
      return (
        <g fill="none" stroke="#1f2937" strokeWidth="3" strokeLinecap="round">
          <path d="M28 44 a22 22 0 0 1 44 0" />
          <rect x="24" y="42" width="7" height="12" rx="3" fill="#1f2937" />
          <rect x="69" y="42" width="7" height="12" rx="3" fill="#1f2937" />
          <path d="M71 54 q0 10 -12 11" />
        </g>
      );
    case "pen":
      return <path d="M70 78 l10 -16 3 2 -10 16 -4 2 z" fill={c} />;
    case "chart":
      return (
        <g transform="translate(64 70)">
          <rect width="20" height="16" rx="3" fill="#fff" opacity=".92" />
          <path d="M3 13 v-4 M8 13 v-8 M13 13 v-6 M18 13 v-10" stroke={c} strokeWidth="2.5" strokeLinecap="round" />
        </g>
      );
    case "brush":
      return <path d="M68 80 q6 -10 14 -16 l2 2 q-6 8 -16 14 z" fill={c} />;
    case "clipboard":
      return (
        <g transform="translate(64 68)">
          <rect width="18" height="22" rx="3" fill="#fff" opacity=".95" />
          <rect x="5" y="-2" width="8" height="5" rx="2" fill={c} />
          <path d="M4 9 h10 M4 13 h10 M4 17 h6" stroke={c} strokeWidth="1.8" />
        </g>
      );
    case "shield":
      return <path d="M72 66 l9 3 v7 q0 7 -9 11 q-9 -4 -9 -11 v-7 z" fill={c} />;
    case "coin":
      return (
        <g>
          <circle cx="74" cy="76" r="8" fill="#f5c542" stroke="#c99a1d" strokeWidth="2" />
          <text x="74" y="80" textAnchor="middle" fontSize="9" fontWeight="700" fill="#8a6510">₪</text>
        </g>
      );
    case "star":
      return <path d="M74 64 l3 6 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1 z" fill="#f5c542" />;
    case "megaphone":
      return <path d="M64 72 l14 -6 v18 l-14 -6 z M60 72 h4 v6 h-4 z" fill={c} />;
    case "laptop":
      return (
        <g transform="translate(60 72)">
          <rect width="24" height="14" rx="2" fill="#334155" />
          <rect x="-3" y="14" width="30" height="3" rx="1.5" fill="#64748b" />
        </g>
      );
    case "spark":
      return <path d="M76 62 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z" fill={c} />;
    default:
      return null;
  }
}

function Hair({ kind, hue }: { kind: NonNullable<AvatarSpec["hair"]>; hue: number }) {
  const c = `hsl(${(hue + 200) % 360} 30% 22%)`;
  switch (kind) {
    case "long":
      return <path d="M30 40 q2 -20 20 -21 q18 1 20 21 v22 q-4 -6 -6 -14 q-8 -14 -14 -14 q-6 0 -14 14 q-2 8 -6 14 z" fill={c} />;
    case "curly":
      return <path d="M31 38 q-2 -8 6 -12 q2 -8 13 -7 q11 -1 13 7 q8 4 6 12 q-3 -4 -7 -4 q-2 -5 -12 -5 q-10 0 -12 5 q-4 0 -7 4 z" fill={c} />;
    case "bun":
      return (
        <g fill={c}>
          <circle cx="50" cy="16" r="7" />
          <path d="M31 38 q2 -18 19 -18 q17 0 19 18 q-6 -8 -19 -8 q-13 0 -19 8 z" />
        </g>
      );
    case "none":
      return null;
    default:
      return <path d="M31 38 q2 -18 19 -18 q17 0 19 18 q-5 -6 -19 -6 q-14 0 -19 6 z" fill={c} />;
  }
}

function Face({ face }: { face: NonNullable<AvatarSpec["face"]> }) {
  return (
    <g>
      <g className="av-eyes">
        <ellipse cx="43" cy="44" rx="2.6" ry={face === "focus" ? 1.8 : 3} fill="#1f2937" />
        <ellipse cx="57" cy="44" rx="2.6" ry={face === "focus" ? 1.8 : 3} fill="#1f2937" />
      </g>
      {face === "cheer" ? <path d="M42 52 q8 9 16 0 z" fill="#7f1d1d" /> : face === "focus" ? <path d="M44 54 h12" stroke="#7f1d1d" strokeWidth="2.4" strokeLinecap="round" /> : face === "calm" ? <path d="M44 53 q6 3 12 0" stroke="#7f1d1d" strokeWidth="2.4" fill="none" strokeLinecap="round" /> : <path d="M42 52 q8 7 16 0" stroke="#7f1d1d" strokeWidth="2.6" fill="none" strokeLinecap="round" />}
      <circle cx="38" cy="51" r="3" fill="#f87171" opacity=".25" />
      <circle cx="62" cy="51" r="3" fill="#f87171" opacity=".25" />
    </g>
  );
}

export function AgentAvatar({ spec, state = "idle", size = 96, className, label }: { spec: AvatarSpec; state?: LiveState; size?: number; className?: string; label?: string }) {
  const id = useId().replace(/:/g, "");
  const hue = Number.isFinite(spec.hue) ? Number(spec.hue) : 222;
  const skin = SKIN[spec.skin ?? "tan"] ?? SKIN.tan;
  return (
    <div className={cn("agent-avatar relative inline-grid place-items-center", `av-${state}`, className)} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="overflow-visible">
        <defs>
          <radialGradient id={`bg${id}`} cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor={`hsl(${hue} 90% 72%)`} />
            <stop offset="100%" stopColor={`hsl(${(hue + 30) % 360} 80% 42%)`} />
          </radialGradient>
          <linearGradient id={`body${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`hsl(${hue} 70% 55%)`} />
            <stop offset="100%" stopColor={`hsl(${hue} 70% 38%)`} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill={`url(#bg${id})`} className="av-halo" />
        <g className="av-body">
          <path d="M22 96 q2 -30 28 -30 q26 0 28 30 z" fill={`url(#body${id})`} />
          <rect x="45" y="58" width="10" height="10" rx="4" fill={skin} />
          <circle cx="50" cy="44" r="19" fill={skin} />
          <Hair kind={spec.hair ?? "short"} hue={hue} />
          <Face face={spec.face ?? "smile"} />
          <Accessory kind={spec.accessory ?? "none"} hue={hue} />
        </g>
      </svg>
      {state === "working" ? (
        <span className="av-dots absolute -bottom-1 start-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-surface px-2 py-1 shadow-md rtl:translate-x-1/2" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {state === "waiting" ? <span className="av-badge absolute -end-1 -top-1 grid h-7 w-7 place-items-center rounded-full bg-warning text-[15px] font-black text-white shadow-md" aria-hidden>?</span> : null}
      {state === "success" ? <span className="av-badge absolute -end-1 -top-1 grid h-7 w-7 place-items-center rounded-full bg-success text-[14px] font-black text-white shadow-md" aria-hidden>✓</span> : null}
      {state === "error" ? <span className="av-badge absolute -end-1 -top-1 grid h-7 w-7 place-items-center rounded-full bg-danger text-[15px] font-black text-white shadow-md" aria-hidden>!</span> : null}
    </div>
  );
}

export const ACCESSORIES = ["none", "tie", "headset", "pen", "chart", "brush", "clipboard", "shield", "coin", "star", "megaphone", "laptop", "spark"] as const;
export const FACES = ["smile", "cheer", "calm", "focus"] as const;
export const SKINS = ["light", "tan", "brown", "dark"] as const;
export const HAIRS = ["short", "long", "curly", "bun", "none"] as const;
