/**
 * Smart model routing for the digital team (pure, unit-tested) — ON TOP of the existing AI router, without changing it.
 *
 * The existing router (lib/ai/router*.ts) already knows every connected engine (Gemini, Groq, Cerebras, OpenRouter,
 * Mistral, Cloudflare, GitHub Models, SambaNova, NVIDIA, Hugging Face, Anthropic, OpenAI), rotates keys, rests limited
 * ones and fails over automatically. This layer only decides WHICH engine to try FIRST for a kind of work:
 *   plan / review / decide  → the strongest available
 *   write / site            → strong at writing and code
 *   classify / extract      → fast and cheap
 *   summarize / report      → long context
 *   vision                  → sees images
 * The routing table can be overridden per task kind in the database (ai_routing) and a business can prefer
 * quality / balanced / speed / cost. When the first choice fails, the existing router's chain takes over.
 */
export type TaskKind = "plan" | "review" | "write" | "site" | "classify" | "summarize" | "vision";
export const TASK_KINDS: TaskKind[] = ["plan", "review", "write", "site", "classify", "summarize", "vision"];
export type RoutingPref = "quality" | "balanced" | "speed" | "cost";

export interface ModelProfile {
  provider: string;
  model: string;
  /** 1..5 */
  quality: number;
  writing: number;
  code: number;
  speed: number;
  longContext: number;
  vision: boolean;
  tools: boolean;
  /** relative cost: 0 free tier · 1 cheap · 2 mid · 3 premium */
  cost: number;
}

/** capability profile of a provider/model, by family (unknown models get a neutral profile) */
export function profileOf(provider: string, model: string): ModelProfile {
  const m = model.toLowerCase();
  const base: ModelProfile = { provider, model, quality: 3, writing: 3, code: 3, speed: 3, longContext: 2, vision: false, tools: true, cost: 0 };
  const set = (p: Partial<ModelProfile>) => ({ ...base, ...p });
  if (provider === "anthropic") {
    const top = /opus|fable|mythos/.test(m);
    const mid = /sonnet/.test(m);
    return set({ quality: top ? 5 : mid ? 5 : 4, writing: 5, code: 5, speed: top ? 2 : mid ? 3 : 4, longContext: 5, vision: true, cost: top ? 3 : mid ? 3 : 2 });
  }
  if (provider === "openai") {
    const mini = /mini|nano/.test(m);
    return set({ quality: mini ? 3 : 5, writing: mini ? 3 : 5, code: mini ? 3 : 5, speed: mini ? 4 : 3, longContext: 4, vision: /4o|4\.1|gpt-5|o\d/.test(m), cost: mini ? 1 : 3 });
  }
  if (provider === "gemini") {
    const lite = /lite/.test(m);
    const pro = /pro/.test(m);
    return set({ quality: pro ? 5 : lite ? 3 : 4, writing: pro ? 5 : 4, code: pro ? 5 : 4, speed: lite ? 5 : 4, longContext: 5, vision: true, cost: 0 });
  }
  if (provider === "github") return set({ quality: /gpt-4\.1(?!-mini)|gpt-4o(?!-mini)/.test(m) ? 4 : 3, writing: 4, code: 4, speed: 3, longContext: 4, vision: /gpt-4/.test(m), cost: 0 });
  if (provider === "groq" || provider === "cerebras" || provider === "sambanova") return set({ quality: /120b|70b/.test(m) ? 4 : 3, writing: 3, code: /120b|qwen/.test(m) ? 4 : 3, speed: 5, longContext: 3, cost: 0 });
  if (provider === "mistral") return set({ quality: /large/.test(m) ? 4 : 3, writing: 3, code: 3, speed: 4, longContext: 3, cost: 0 });
  if (provider === "openrouter") return set({ quality: /free/.test(m) ? 2 : 3, writing: 3, code: 3, speed: 3, longContext: 3, cost: 0 });
  if (provider === "cloudflare" || provider === "nvidia" || provider === "huggingface") return set({ quality: /120b|70b/.test(m) ? 3 : 2, writing: 3, code: 3, speed: 3, longContext: 2, cost: 0 });
  return base;
}

const WEIGHTS: Record<TaskKind, Partial<Record<"quality" | "writing" | "code" | "speed" | "longContext" | "cheap", number>>> = {
  plan: { quality: 3, longContext: 0.5, speed: 0.3 },
  review: { quality: 3, writing: 0.5, speed: 0.3 },
  write: { writing: 2.5, quality: 1.5, speed: 0.3 },
  site: { code: 2, writing: 1.5, quality: 1.5 },
  classify: { speed: 2.5, cheap: 2, quality: 0.5 },
  summarize: { longContext: 2, quality: 1, cheap: 1, speed: 0.5 },
  vision: { quality: 2, speed: 0.5 },
};

const PREF_BONUS: Record<RoutingPref, Partial<Record<"quality" | "speed" | "cheap", number>>> = {
  quality: { quality: 1.5 },
  balanced: {},
  speed: { speed: 1.5 },
  cost: { cheap: 2 },
};

export function scoreFor(kind: TaskKind, p: ModelProfile, pref: RoutingPref = "balanced"): number {
  if (kind === "vision" && !p.vision) return -1;
  const w = { ...WEIGHTS[kind] };
  for (const [k, v] of Object.entries(PREF_BONUS[pref])) w[k as keyof typeof w] = (w[k as keyof typeof w] ?? 0) + (v as number);
  const cheap = 5 - p.cost * 1.5;
  return (w.quality ?? 0) * p.quality + (w.writing ?? 0) * p.writing + (w.code ?? 0) * p.code + (w.speed ?? 0) * p.speed + (w.longContext ?? 0) * p.longContext + (w.cheap ?? 0) * cheap;
}

export interface RouteChoice {
  provider: string;
  model: string;
  reason: "override" | "policy";
}

/**
 * The engines to try for a kind of work, best first. `available` = the provider/model pairs that have keys (from the
 * existing router). `override` = the database routing table for this kind (only entries that are available are used).
 */
export function routeFor(kind: TaskKind, available: { provider: string; model: string }[], opts: { pref?: RoutingPref; override?: { provider: string; model: string }[] } = {}): RouteChoice[] {
  const seen = new Set<string>();
  const uniq = available.filter((a) => {
    const k = `${a.provider}/${a.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const has = new Set(uniq.map((a) => `${a.provider}/${a.model}`));
  const fromOverride: RouteChoice[] = (opts.override ?? []).filter((o) => has.has(`${o.provider}/${o.model}`)).map((o) => ({ provider: o.provider, model: o.model, reason: "override" as const }));
  const ranked = uniq
    .map((a) => ({ a, s: scoreFor(kind, profileOf(a.provider, a.model), opts.pref ?? "balanced") }))
    .filter((x) => x.s >= 0)
    .sort((x, y) => y.s - x.s)
    .map((x) => ({ provider: x.a.provider, model: x.a.model, reason: "policy" as const }));
  const out = [...fromOverride];
  for (const r of ranked) if (!out.some((o) => o.provider === r.provider && o.model === r.model)) out.push(r);
  return out;
}

/** which kind of work a team step is (the engine asks for the right kind) */
export function kindForPhase(phase: "understand" | "plan" | "write" | "review" | "summary" | "classify" | "site" | "vision"): TaskKind {
  switch (phase) {
    case "understand":
    case "plan":
      return "plan";
    case "review":
      return "review";
    case "summary":
      return "summarize";
    case "classify":
      return "classify";
    case "site":
      return "site";
    case "vision":
      return "vision";
    default:
      return "write";
  }
}

/** a cleaned routing-table row from the database (unknown kinds / malformed entries are dropped) */
export function cleanRoutingRow(kind: string, models: unknown): { kind: TaskKind; models: { provider: string; model: string }[] } | null {
  if (!(TASK_KINDS as string[]).includes(kind) || !Array.isArray(models)) return null;
  const list = models
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => /^[a-z]{2,20}$/.test(String(x.provider ?? "")) && /^[A-Za-z0-9._:/@-]{2,100}$/.test(String(x.model ?? "")))
    .map((x) => ({ provider: String(x.provider), model: String(x.model) }))
    .slice(0, 10);
  return { kind: kind as TaskKind, models: list };
}
