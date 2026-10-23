/**
 * Wave 15 — AI customer insights (pure helpers, unit-tested).
 * The model returns one JSON object; everything is validated and clamped here
 * before it is stored, so a wrong or partial answer never breaks the CRM.
 */

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];
export const BUY_STAGES = ["new", "interested", "considering", "ready", "customer", "lost"] as const;
export type BuyStage = (typeof BUY_STAGES)[number];

export interface ContactInsightAI {
  score: number | null;
  sentiment: Sentiment | null;
  stage: BuyStage | null;
  intent: string;
  next_action: string;
  suggested_offer: string;
  summary: string;
  objections: string;
  best_channel: string;
  urgency: "low" | "medium" | "high" | null;
}

export const INSIGHT_CHANNELS = ["whatsapp", "telegram", "sms", "email", "phone", "web"] as const;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Extracts the first JSON object from a model answer (handles ```json fences and chatter). */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
  const text = (fenced ?? raw).trim();
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(text.slice(start, i + 1)) as unknown;
          return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseInsights(raw: string): ContactInsightAI | null {
  const o = extractJsonObject(raw);
  if (!o) return null;
  const n = Number(o.score);
  const sentiment = (SENTIMENTS as readonly string[]).includes(String(o.sentiment)) ? (o.sentiment as Sentiment) : null;
  const stage = (BUY_STAGES as readonly string[]).includes(String(o.stage)) ? (o.stage as BuyStage) : null;
  const urgency = ["low", "medium", "high"].includes(String(o.urgency)) ? (o.urgency as "low" | "medium" | "high") : null;
  const channel = str(o.best_channel, 20).toLowerCase();
  const out: ContactInsightAI = {
    score: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null,
    sentiment,
    stage,
    intent: str(o.intent, 300),
    next_action: str(o.next_action, 400),
    suggested_offer: str(o.suggested_offer, 400),
    summary: str(o.summary, 800),
    objections: str(o.objections, 300),
    best_channel: (INSIGHT_CHANNELS as readonly string[]).includes(channel) ? channel : "",
    urgency,
  };
  // nothing useful → treat as a failed answer
  if (out.score === null && !out.sentiment && !out.next_action && !out.summary) return null;
  return out;
}

/** The task given to the model (the data block is appended by the caller). */
export function insightsTask(): string {
  return [
    "Analyse this customer for the sales team. Answer with ONE JSON object only, no prose, with these keys:",
    '{"score": 0-100 (how likely to buy soon), "sentiment": "positive|neutral|negative",',
    ' "stage": "new|interested|considering|ready|customer|lost", "urgency": "low|medium|high",',
    ' "intent": "what the customer wants, one sentence", "objections": "doubts or blockers, if any",',
    ' "next_action": "the single best next step for the salesperson, concrete", ',
    ' "suggested_offer": "what to offer (product / price frame / incentive) based ONLY on the data", ',
    ' "best_channel": "whatsapp|telegram|sms|email|phone|web", "summary": "2-3 sentences"}',
    "Base everything on the data. Never invent prices, products or promises that are not in the data;",
    "if there is not enough information, say so in the summary and use a lower score.",
  ].join("\n");
}

/** Score → label used across the UI. */
export function scoreBand(score: number | null | undefined): "hot" | "warm" | "cold" | "none" {
  if (score === null || score === undefined) return "none";
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}
