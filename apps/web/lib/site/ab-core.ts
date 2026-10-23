/**
 * Wave 17 — A/B tests on websites (pure, unit-tested).
 * Variant B replaces the hero's title / subtitle / button text. Each visitor keeps the
 * same variant (cookie); the winner is chosen by conversion rate once both variants
 * have enough visitors and the difference is statistically meaningful (two-proportion z-test).
 */
import type { SiteBlock } from "@scc/shared/engagement";

export interface SiteAb {
  active?: boolean;
  title?: string;
  subtitle?: string;
  cta_label?: string;
  started_at?: string;
  min_views?: number;
  winner?: "a" | "b" | null;
  decided_at?: string | null;
}
export interface AbStats {
  a_views: number;
  b_views: number;
  a_conv: number;
  b_conv: number;
}

export const AB_COOKIE = (slug: string) => `scc_ab_${slug.replace(/[^a-z0-9-]/g, "")}`;

export function isVariant(v: unknown): v is "a" | "b" {
  return v === "a" || v === "b";
}

/** Even split; `rand` in [0,1). */
export function pickVariant(rand: number): "a" | "b" {
  return rand < 0.5 ? "a" : "b";
}

/** Applies variant B to the first hero block (other blocks untouched). */
export function applyVariant(blocks: SiteBlock[], ab: SiteAb | null | undefined, variant: "a" | "b"): SiteBlock[] {
  if (!ab || variant !== "b") return blocks;
  let done = false;
  return blocks.map((b) => {
    if (done || b.type !== "hero") return b;
    done = true;
    return {
      ...b,
      data: {
        ...b.data,
        title: ab.title?.trim() ? ab.title.trim().slice(0, 160) : b.data.title,
        subtitle: ab.subtitle?.trim() ? ab.subtitle.trim().slice(0, 500) : b.data.subtitle,
        cta_label: ab.cta_label?.trim() ? ab.cta_label.trim().slice(0, 60) : b.data.cta_label,
      },
    };
  });
}

export function rate(conv: number, views: number): number {
  return views > 0 ? conv / views : 0;
}

/** z-score of the difference in conversion rate between B and A. */
export function zScore(s: AbStats): number {
  const n1 = s.a_views;
  const n2 = s.b_views;
  if (n1 <= 0 || n2 <= 0) return 0;
  const p1 = Math.min(1, s.a_conv / n1);
  const p2 = Math.min(1, s.b_conv / n2);
  const p = Math.min(1, (s.a_conv + s.b_conv) / (n1 + n2));
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  return se > 0 ? (p2 - p1) / se : 0;
}

/**
 * The winner when both variants reached `minViews` visitors and |z| ≥ 1.96 (95%);
 * null while there is no clear winner yet.
 */
export function abWinner(s: AbStats, minViews = 100): "a" | "b" | null {
  if (s.a_views < minViews || s.b_views < minViews) return null;
  const z = zScore(s);
  if (Math.abs(z) < 1.96) return null;
  return z > 0 ? "b" : "a";
}

/** Bounded visitor id (random, no personal data). */
export function validVisitorId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

/** Two-sided confidence (0–100) that the variants really differ, from the z-score. */
export function confidence(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  // erf (Abramowitz & Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.round(Math.max(0, Math.min(1, erf)) * 1000) / 10;
}
