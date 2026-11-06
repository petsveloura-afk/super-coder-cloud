/**
 * Wave 69 — resolution metrics from data that already exists (pure). Two numbers over the conversations the agent answered:
 *   - closed without a person: the conversation is closed, the AI never handed over (`ai_mode` stayed auto, no `handoff_at`)
 *     and every outgoing message came from the agent;
 *   - repeated the same question: after the agent answered, the customer wrote (almost) the same question again.
 * The denominator is ALL conversations the agent answered in the window (open ones count as not-yet-resolved), so the first
 * number is deliberately on the cautious side. Below `MIN_SAMPLE` conversations no percentage is shown.
 */
export const MIN_SAMPLE = 5;

export interface ResConv { id: string; status: string; aiMode?: string | null; handoffAt?: string | null }
export interface ResMsg { conversationId: string; direction: string; body: string; aiAgentId: string | null; createdAt: string }
export interface ResolutionStats {
  aiConversations: number;
  closedWithoutHuman: number;
  repeatedConversations: number;
  /** whole percentages, null when there are fewer than MIN_SAMPLE agent conversations */
  closedRate: number | null;
  repeatRate: number | null;
}

/** words of a message, lower-cased, without vowel marks (Hebrew niqqud, Arabic tashkeel) */
export function questionTokens(text: string): string[] {
  return ((text ?? "").replace(/[\u0591-\u05C7\u064B-\u065F]/g, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** The same question again: at least 3 words each and at least 80% of the words are shared. Re-phrasing is not detected (cautious). */
export function sameQuestion(a: string, b: string): boolean {
  const ta = new Set(questionTokens(a));
  const tb = new Set(questionTokens(b));
  if (ta.size < 3 || tb.size < 3) return false;
  let shared = 0;
  for (const w of ta) if (tb.has(w)) shared++;
  return shared / (ta.size + tb.size - shared) >= 0.8;
}

export function resolutionStats(convs: ResConv[], msgs: ResMsg[]): ResolutionStats {
  const byConv = new Map<string, ResMsg[]>();
  for (const m of msgs ?? []) {
    const list = byConv.get(m.conversationId);
    if (list) list.push(m);
    else byConv.set(m.conversationId, [m]);
  }
  let ai = 0;
  let closed = 0;
  let repeated = 0;
  for (const c of convs ?? []) {
    const list = [...(byConv.get(c.id) ?? [])].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt));
    const out = list.filter((m) => m.direction === "out");
    if (!out.some((m) => m.aiAgentId)) continue;
    ai++;
    const personTouched = out.some((m) => !m.aiAgentId) || c.aiMode === "human" || !!c.handoffAt;
    if (c.status === "closed" && !personTouched) closed++;
    const earlier: { text: string; answered: boolean }[] = [];
    let again = false;
    for (const m of list) {
      if (m.direction === "out" && m.aiAgentId) {
        for (const e of earlier) e.answered = true;
      } else if (m.direction === "in") {
        if (earlier.some((e) => e.answered && sameQuestion(e.text, m.body))) again = true;
        earlier.push({ text: m.body, answered: false });
      }
    }
    if (again) repeated++;
  }
  const enough = ai >= MIN_SAMPLE;
  return {
    aiConversations: ai,
    closedWithoutHuman: closed,
    repeatedConversations: repeated,
    closedRate: enough ? Math.round((closed / ai) * 100) : null,
    repeatRate: enough ? Math.round((repeated / ai) * 100) : null,
  };
}

/**
 * Analytics sync — how the agent's conversations ended up, open ones included (resolutionStats only counts CLOSED ones
 * as resolved, and most chats are never marked closed, so it read 0% for agents that handle everything alone).
 *   handledAlone: the agent answered and no person ever wrote / no hand-over
 *   handedOver:   a person wrote in, or the agent handed the chat to the team
 */
export interface HandlingStats {
  aiConversations: number;
  handledAlone: number;
  handedOver: number;
  handledAloneRate: number | null;
  handedOverRate: number | null;
}

export function handlingStats(convs: ResConv[], msgs: ResMsg[]): HandlingStats {
  const outBy = new Map<string, ResMsg[]>();
  for (const m of msgs ?? []) if (m.direction === "out") outBy.set(m.conversationId, [...(outBy.get(m.conversationId) ?? []), m]);
  let ai = 0;
  let alone = 0;
  for (const c of convs ?? []) {
    const out = outBy.get(c.id) ?? [];
    if (!out.some((m) => m.aiAgentId)) continue;
    ai++;
    const personTouched = out.some((m) => !m.aiAgentId) || c.aiMode === "human" || !!c.handoffAt;
    if (!personTouched) alone++;
  }
  const enough = ai >= MIN_SAMPLE;
  return { aiConversations: ai, handledAlone: alone, handedOver: ai - alone, handledAloneRate: enough ? Math.round((alone / ai) * 100) : null, handedOverRate: enough ? Math.round(((ai - alone) / ai) * 100) : null };
}
