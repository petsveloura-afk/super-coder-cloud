/**
 * Wave 63 — richer customer memory (pure, unit-tested). Turns what a conversation SHOWED (not what the
 * customer was asked) into short memory facts: objections already raised, preferred language and style,
 * and what they were interested in. They use the existing `contact_memories` kinds (objection /
 * preference / context) and are shown to every agent by the existing `memoryBlock`.
 * Never stores anything sensitive (health, money trouble, loss) — see `sensitiveMoment`.
 */
import { analyzeMessage } from "./intelligence";
import { conversationSignals, type HistoryMsg } from "./brain-pro";
import { conversationInsight, sensitiveMoment } from "./social-intel-core";

export interface InsightMemory {
  fact: string;
  kind: "objection" | "preference" | "context";
}

const OBJ_FACT: Record<string, string> = {
  price: "was price-sensitive: asked for a lower price / said it is expensive",
  timing: "said it is not the right time yet (wanted to think about it)",
  trust: "asked for proof / guarantees before deciding",
  competitor: "compared with a competitor's price or offer",
  authority: "needs someone else's approval before deciding",
  fit: "was unsure the offer fits them",
};
const BUY_FACT: Record<string, string> = {
  delivery: "asked about delivery / shipping",
  payment: "asked about payment options",
  stock: "asked about availability / stock",
  start_when: "wanted to know how soon they can start",
};
const LANG_NAME = { he: "Hebrew", ar: "Arabic", en: "English" } as const;

/** Facts worth remembering from this conversation (max 5, deduped by the database's unique index). */
export function insightMemories(history: HistoryMsg[]): InsightMemory[] {
  const users = history.filter((m) => m.role === "user");
  if (users.length < 2) return []; // one message is not a pattern
  // a conversation with a painful moment stores nothing about the customer's feelings or situation
  if (users.some((m) => sensitiveMoment(m.content))) return [];
  const out: InsightMemory[] = [];
  const sig = conversationSignals(history);
  const insight = conversationInsight(history);
  for (const o of sig.objections) if (OBJ_FACT[o]) out.push({ fact: OBJ_FACT[o]!, kind: "objection" });
  for (const b of sig.buying) if (BUY_FACT[b]) out.push({ fact: BUY_FACT[b]!, kind: "context" });
  const langs = users.map((m) => analyzeMessage(m.content).lang).filter((l): l is "he" | "ar" | "en" => Boolean(l));
  const last = langs[langs.length - 1];
  if (last && langs.length >= 2 && langs.every((l) => l === last)) out.push({ fact: `writes in ${LANG_NAME[last]} — answer in ${LANG_NAME[last]}`, kind: "preference" });
  if (insight.brief) out.push({ fact: "prefers short, practical messages", kind: "preference" });
  return out.filter((m) => m.fact.length >= 2 && m.fact.length <= 300).slice(0, 5);
}
