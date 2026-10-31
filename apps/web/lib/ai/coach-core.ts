/**
 * Wave 59 — the weekly AI coach (pure, unit-tested): the week's numbers, why conversations did not
 * close, and concrete fixes for the agent's script — one short report a week for the owner.
 */

export interface CoachStats {
  conversations: number;
  leads: number;
  handoffs: number;
  lost: number;
  /** leads / conversations (0..1) */
  conversion: number;
}

export interface CoachInsights {
  summary: string;
  reasons: { reason: string; count: number; fix: string }[];
  tips: string[];
}

/** Sunday (UTC date) of the week that contains `d` — one report per business per week. */
export function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - x.getUTCDay());
  return x.toISOString().slice(0, 10);
}

export function coachStats(input: { conversations: number; leads: number; handoffs: number; lost: number }): CoachStats {
  const c = Math.max(0, Math.round(input.conversations));
  const l = Math.max(0, Math.round(input.leads));
  return { conversations: c, leads: l, handoffs: Math.max(0, Math.round(input.handoffs)), lost: Math.max(0, Math.round(input.lost)), conversion: c ? Math.round((l / c) * 1000) / 1000 : 0 };
}

/** Enough activity for a meaningful report. */
export function coachWorthIt(s: CoachStats): boolean {
  return s.conversations >= 3;
}

export function coachSystemPrompt(locale: string): string {
  const lang = locale === "en" ? "English" : locale === "ar" ? "Arabic" : "Hebrew";
  return [
    "You are a senior sales coach reviewing a week of conversations between a small business's AI agent and its customers.",
    "You get the week's numbers and short transcripts of conversations that did NOT turn into a lead.",
    "Find the real reasons they did not close (price objection, slow/unclear answer, missing info, no clear next step, wrong timing, the customer only browsed …) and give a concrete fix for the agent's script or business info for each.",
    `Write in ${lang}, short and practical, no fluff, no blame. Never invent numbers.`,
    'Return ONLY JSON: {"summary":"2 sentences","reasons":[{"reason":"…","count":N,"fix":"one concrete change"}],"tips":["up to 3 short tips"]}',
  ].join("\n");
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function normalizeCoach(raw: unknown): CoachInsights | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r) return null;
  const reasons = (Array.isArray(r.reasons) ? r.reasons : [])
    .map((x) => {
      const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { reason: s(o.reason, 160), count: Math.max(1, Math.min(999, Math.round(Number(o.count) || 1))), fix: s(o.fix, 300) };
    })
    .filter((x) => x.reason.length >= 3)
    .slice(0, 5);
  const tips = (Array.isArray(r.tips) ? r.tips : []).map((x) => s(x, 200)).filter((x) => x.length >= 3).slice(0, 3);
  const summary = s(r.summary, 500);
  if (!summary && !reasons.length) return null;
  return { summary, reasons, tips };
}

/** A short transcript line list for the coach (bounded). */
export function coachTranscript(msgs: { direction: string; body: string; ai: boolean }[], max = 8): string {
  return msgs
    .slice(-max)
    .map((m) => `${m.direction === "in" ? "customer" : m.ai ? "agent" : "team"}: ${m.body.replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");
}
