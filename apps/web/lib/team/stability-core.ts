/**
 * Upgrade 8 / stage A — stability (pure, unit-tested). Decides which AI engines are NOT worth a try right now, so a task never
 * wastes an attempt on a provider that has no key, cannot do this kind of work, is resting, over its daily quota or failing in a
 * row. Nothing is removed from any configuration: a skipped engine only leaves THIS attempt's route, and when every engine would
 * be skipped the original route is returned untouched (the team never ends up with nothing to try).
 * Keys are NEVER read out or returned — only "has a key: yes / no" leaves this file.
 */
import { cloudflareKeys, keysFor } from "@/lib/ai/router-core";
import { profileOf } from "./routing-core";

export type Lang = "he" | "en" | "ar";
type Env = Record<string, string | undefined>;

export type SkipReason = "no_key" | "wrong_kind" | "resting" | "over_daily_quota" | "fail_streak" | "too_many_parallel";

/** the environment variable (base name) of each provider's key */
export const KEY_ENV: Record<string, string> = {
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  github: "GITHUB_MODELS_TOKEN",
  sambanova: "SAMBANOVA_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  huggingface: "HUGGINGFACE_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** does the server have at least one plausible key for this provider? (boolean only — the key itself never leaves) */
export function providerHasKey(provider: string, env: Env): boolean {
  if (provider === "cloudflare") return cloudflareKeys(env).length > 0;
  const base = KEY_ENV[provider];
  if (!base) return true; // unknown provider: not our call to block it
  if (provider === "gemini") return keysFor(env, "GEMINI_API_KEY", 20).length > 0 || keysFor(env, "GOOGLE_AI_API_KEY", 20).length > 0 || keysFor(env, "GOOGLE_GENERATIVE_AI_API_KEY", 20).length > 0;
  if (provider === "github") return keysFor(env, "GITHUB_MODELS_TOKEN", 20).length > 0 || keysFor(env, "GITHUB_MODELS_API_KEY", 20).length > 0;
  return keysFor(env, base, 20).length > 0;
}

/** image generation needs an image model; a text model can never produce an image */
const IMAGE_MODEL = /image|imagen|flux|stable-diffusion|sdxl|dall-?e|nano-banana/i;

/** does this model fit the kind of work? ("image" is the image-generation kind; "vision" needs a model that SEES images) */
export function modelFitsKind(kind: string, provider: string, model: string): boolean {
  if (kind === "image") return IMAGE_MODEL.test(model);
  if (kind === "vision") return profileOf(provider, model).vision;
  return !IMAGE_MODEL.test(model); // an image-only model cannot write text
}

export interface ProviderState {
  /** epoch ms; the provider rests until then (from Retry-After or a rate limit) */
  restUntil: number;
  /** calls today */
  dayCount: number;
  /** consecutive failures */
  streak: number;
  /** calls running right now */
  inflight: number;
}
export type UsageState = Record<string, ProviderState>;

export const STABILITY_DEFAULTS = {
  /** consecutive failures after which a provider is left out of the route for `streakRestMs` */
  streakLimit: 4,
  streakRestMs: 5 * 60_000,
  /** conservative free-tier daily call budgets (0 = unknown / no limit enforced) */
  dailyLimit: { groq: 14_000, cerebras: 14_000, gemini: 1_400, openrouter: 180, mistral: 900, github: 140, sambanova: 900, nvidia: 900, huggingface: 150, cloudflare: 9_000 } as Record<string, number>,
  /** how many calls one provider serves in parallel from the team */
  parallel: { default: 3, openrouter: 2, github: 2, huggingface: 2, gemini: 4, groq: 4, cerebras: 4 } as Record<string, number>,
};

const blank = (): ProviderState => ({ restUntil: 0, dayCount: 0, streak: 0, inflight: 0 });

export function maxParallel(provider: string, o = STABILITY_DEFAULTS): number {
  return o.parallel[provider] ?? o.parallel.default ?? 3;
}

/** why this provider/model should be skipped now (null = fine to try) */
export function skipReason(kind: string, provider: string, model: string, ctx: { env: Env; usage: UsageState; now: number }, o = STABILITY_DEFAULTS): SkipReason | null {
  if (!providerHasKey(provider, ctx.env)) return "no_key";
  if (!modelFitsKind(kind, provider, model)) return "wrong_kind";
  const u = ctx.usage[provider] ?? blank();
  if (u.restUntil > ctx.now) return "resting";
  const lim = o.dailyLimit[provider] ?? 0;
  if (lim > 0 && u.dayCount >= lim) return "over_daily_quota";
  if (u.streak >= o.streakLimit) return "fail_streak";
  if (u.inflight >= maxParallel(provider, o)) return "too_many_parallel";
  return null;
}

export interface Skipped {
  provider: string;
  model: string;
  reason: SkipReason;
}

/**
 * The route with the engines that should not be tried left out (and the list of who was skipped and why).
 * Order of the rest is kept; the free-and-idle engines are preferred among equals (fewest calls in flight first, stable otherwise).
 * When EVERYTHING would be skipped, the original route comes back unchanged.
 */
export function guardRoute<T extends { provider: string; model: string }>(kind: string, route: T[], ctx: { env: Env; usage: UsageState; now: number }, o = STABILITY_DEFAULTS): { route: T[]; skipped: Skipped[] } {
  const skipped: Skipped[] = [];
  const kept: T[] = [];
  for (const r of route) {
    const why = skipReason(kind, r.provider, r.model, ctx, o);
    if (why) skipped.push({ provider: r.provider, model: r.model, reason: why });
    else kept.push(r);
  }
  if (!kept.length) return { route, skipped: [] };
  return { route: preferIdle(kept, ctx.usage), skipped };
}

/** among the engines in the route, the idle ones first — but never past the first strong choice (a stable reorder only inside "tied" neighbours) */
export function preferIdle<T extends { provider: string; model: string }>(route: T[], usage: UsageState): T[] {
  const load = (p: string) => usage[p]?.inflight ?? 0;
  return route.map((r, i) => ({ r, i })).sort((a, b) => (load(a.r.provider) > 1 && load(b.r.provider) <= 1 ? 1 : load(b.r.provider) > 1 && load(a.r.provider) <= 1 ? -1 : 0) || a.i - b.i).map((x) => x.r);
}

/* ------------------------------------------------------------------ Retry-After, backoff, bookkeeping */

/** Retry-After: seconds ("30") or an HTTP date; clamped to 1s..6h; null when unusable */
export function retryAfterMs(header: string | number | null | undefined, now: number): number | null {
  if (header === null || header === undefined || header === "") return null;
  let ms: number;
  if (typeof header === "number") ms = header * 1000;
  else if (/^\s*\d+(\.\d+)?\s*$/.test(header)) ms = Number(header) * 1000;
  else {
    const t = Date.parse(header);
    if (!Number.isFinite(t)) return null;
    ms = t - now;
  }
  if (!Number.isFinite(ms)) return null;
  return Math.min(6 * 3_600_000, Math.max(1000, Math.round(ms)));
}

/** exponential backoff with FULL jitter (so many tasks do not retry in the same second); `rand` is 0..1 */
export function backoffJitterMs(attempt: number, o: { baseMs?: number; capMs?: number } = {}, rand: () => number = Math.random): number {
  const base = o.baseMs ?? 2000;
  const cap = o.capMs ?? 5 * 60_000;
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + (exp / 2) * rand());
}

/** the provider state after one call (never mutates the input) */
export function noteCall(usage: UsageState, provider: string, r: { ok: boolean; retryAfter?: string | number | null; error?: string | null }, now: number): UsageState {
  const cur = usage[provider] ?? blank();
  const next: ProviderState = { ...cur, dayCount: cur.dayCount + 1, inflight: Math.max(0, cur.inflight - 1) };
  if (r.ok) next.streak = 0;
  else {
    next.streak = cur.streak + 1;
    const limited = /429|rate|quota|busy|overload|resource_exhausted/i.test(r.error ?? "");
    const ra = retryAfterMs(r.retryAfter ?? null, now);
    if (ra !== null) next.restUntil = Math.max(cur.restUntil, now + ra);
    else if (limited) next.restUntil = Math.max(cur.restUntil, now + backoffJitterMs(next.streak, { baseMs: 15_000, capMs: 10 * 60_000 }, () => 0.5));
    if (next.streak >= STABILITY_DEFAULTS.streakLimit) next.restUntil = Math.max(next.restUntil, now + STABILITY_DEFAULTS.streakRestMs);
  }
  return { ...usage, [provider]: next };
}
export function noteStart(usage: UsageState, provider: string): UsageState {
  const cur = usage[provider] ?? blank();
  return { ...usage, [provider]: { ...cur, inflight: cur.inflight + 1 } };
}

/** a new day resets the daily counters (the rest of the state stays) */
export function resetDay(usage: UsageState): UsageState {
  return Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, { ...v, dayCount: 0 }]));
}

/* ------------------------------------------------------------------ the model-health bookkeeping fix (fallback_used) */

export interface HealthUpdate {
  provider: string;
  model: string;
  ok: boolean;
  error?: string | null;
}

/**
 * What the circuit breaker should learn from ONE routed call.
 *  - the call failed: the first choice counts as a failure (with the real error)
 *  - the first choice answered: success
 *  - the call succeeded through a fallback: the engine that ANSWERED is healthy; the first choice is a failure only when we KNOW
 *    it failed (the router's attempts say so) — before this fix "fallback_used" was written as a failure of the first engine every
 *    time, which made every model look sick.
 */
export function healthUpdates(input: { first: { provider: string; model: string } | null; used: { provider: string; model: string } | null; ok: boolean; error?: string | null; attempts?: { provider: string; model: string; ok: boolean; reason?: string }[] }): HealthUpdate[] {
  const { first, used, ok } = input;
  if (!first) return used && ok ? [{ provider: used.provider, model: used.model, ok: true }] : [];
  if (!ok) return [{ provider: first.provider, model: first.model, ok: false, error: input.error ?? "ai_failed" }];
  const same = used && used.provider === first.provider && used.model === first.model;
  if (same) return [{ provider: first.provider, model: first.model, ok: true }];
  const out: HealthUpdate[] = [];
  const known = (input.attempts ?? []).filter((a) => !a.ok && a.provider === first.provider && a.model === first.model);
  if (known.length) out.push({ provider: first.provider, model: first.model, ok: false, error: known[0]!.reason ?? "failed" });
  if (used) out.push({ provider: used.provider, model: used.model, ok: true });
  return out;
}

/* ------------------------------------------------------------------ spreading work + the owner-facing texts */

/** which of the ready tasks run in this tick: spread across employees (round-robin) so one busy employee does not take every slot */
export function spreadTasks<T extends { id: string; assignee_id?: string | null; priority?: number }>(ready: T[], slots: number): T[] {
  if (slots <= 0) return [];
  const by = new Map<string, T[]>();
  for (const t of ready) {
    const k = t.assignee_id ?? "none";
    (by.get(k) ?? by.set(k, []).get(k)!).push(t);
  }
  const queues = [...by.values()];
  const out: T[] = [];
  for (let round = 0; out.length < slots && queues.some((q) => q.length > round); round++) {
    for (const q of queues) if (q[round] && out.length < slots) out.push(q[round]!);
  }
  return out;
}

const REASONS: Record<Lang, Record<SkipReason, string>> = {
  he: { no_key: "ספק ללא מפתח — מדולג", wrong_kind: "מודל לא מתאים לסוג העבודה — מדולג", resting: "ספק במנוחה — מדולג זמנית", over_daily_quota: "הספק עבר את המכסה היומית — מדולג", fail_streak: "הספק נכשל כמה פעמים ברצף — מדולג זמנית", too_many_parallel: "הספק עסוק כרגע — מועדף ספק פנוי" },
  en: { no_key: "Provider without a key — skipped", wrong_kind: "Model does not fit this kind of work — skipped", resting: "Provider is resting — skipped for now", over_daily_quota: "Provider is over its daily quota — skipped", fail_streak: "Provider failed several times in a row — skipped for now", too_many_parallel: "Provider is busy right now — an idle one is preferred" },
  ar: { no_key: "مزوّد بلا مفتاح — تم تخطيه", wrong_kind: "النموذج لا يناسب هذا النوع من العمل — تم تخطيه", resting: "المزوّد في راحة — تم تخطيه مؤقتًا", over_daily_quota: "المزوّد تجاوز الحصة اليومية — تم تخطيه", fail_streak: "فشل المزوّد عدة مرات متتالية — تم تخطيه مؤقتًا", too_many_parallel: "المزوّد مشغول الآن — يُفضَّل مزوّد متاح" },
};
export const skipText = (r: SkipReason, lang: Lang): string => REASONS[lang][r];

/** ONE sentence on how to add a free key (shown next to a provider without a key) */
export function addKeyHelp(provider: string, lang: Lang): string {
  const env = KEY_ENV[provider] ?? "API_KEY";
  if (provider === "groq") {
    return lang === "he" ? `להוספת מפתח חינמי: צרו מפתח ב-console.groq.com והוסיפו אותו ב-Vercel בשם ${env}.` : lang === "ar" ? `لإضافة مفتاح مجاني: أنشئ مفتاحًا في console.groq.com وأضفه في Vercel باسم ${env}.` : `To add a free key: create one at console.groq.com and add it in Vercel as ${env}.`;
  }
  return lang === "he" ? `להוספת מפתח: הוסיפו ב-Vercel משתנה בשם ${env}.` : lang === "ar" ? `لإضافة مفتاح: أضف في Vercel متغيرًا باسم ${env}.` : `To add a key: add a variable named ${env} in Vercel.`;
}

/** the rows of the "skipped providers" card (no keys, only reasons) */
export function skippedView(skipped: Skipped[], lang: Lang): { key: string; reason: SkipReason; text: string; help: string | null }[] {
  const seen = new Set<string>();
  const out: { key: string; reason: SkipReason; text: string; help: string | null }[] = [];
  for (const s of skipped) {
    const k = `${s.provider}/${s.reason}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key: `${s.provider}/${s.model}`, reason: s.reason, text: skipText(s.reason, lang), help: s.reason === "no_key" ? addKeyHelp(s.provider, lang) : null });
  }
  return out;
}
