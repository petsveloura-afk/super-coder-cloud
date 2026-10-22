/**
 * Wave 16 — visual conversation flows (pure engine, unit-tested).
 * A flow is a list of steps; it runs BEFORE the free AI when it is active in a
 * conversation, so the business can force an exact path where it matters
 * (qualification questions, menus, collecting details) and hand over to the AI
 * or to a person at the end.
 *
 * Step types:
 *   message   send text → next
 *   buttons   send text + choices; each choice has its own next step (branching)
 *   collect   ask and save the answer (name / phone / email / need / any key) → next
 *   handoff   send text and pass the conversation to the team
 *   ai        let the free AI agent continue (the flow ends)
 *   end       send text and finish
 */
export type FlowNodeType = "message" | "buttons" | "collect" | "handoff" | "ai" | "end";
export interface FlowButton {
  label: string;
  next?: string | null;
}
export interface FlowNode {
  id: string;
  type: FlowNodeType;
  text?: string;
  buttons?: FlowButton[];
  field?: string;
  next?: string | null;
}
export interface Flow {
  id: string;
  name: string;
  enabled: boolean;
  trigger_keywords: string[];
  on_first_message: boolean;
  nodes: FlowNode[];
}
export interface FlowState {
  flow_id: string;
  node_id: string;
  data: Record<string, string>;
  started_at?: string;
}
export interface FlowOutput {
  messages: { text: string; buttons?: string[] }[];
  state: FlowState | null;
  handoff: boolean;
  toAI: boolean;
  finished: boolean;
  collected: Record<string, string>;
  /** the customer's answer was not valid (asked again) */
  invalid?: boolean;
}

export const FIELD_KINDS = ["name", "phone", "email", "need", "budget", "date", "custom"] as const;

const MAX_STEPS = 12;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function validFlowNodes(raw: unknown): FlowNode[] {
  if (!Array.isArray(raw)) return [];
  const out: FlowNode[] = [];
  const ids = new Set<string>();
  for (const n of raw.slice(0, 60)) {
    if (!n || typeof n !== "object") continue;
    const x = n as Record<string, unknown>;
    const id = String(x.id ?? "").trim().slice(0, 40);
    const type = String(x.type ?? "") as FlowNodeType;
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || ids.has(id) || !["message", "buttons", "collect", "handoff", "ai", "end"].includes(type)) continue;
    ids.add(id);
    out.push({
      id,
      type,
      text: typeof x.text === "string" ? x.text.slice(0, 1500) : "",
      buttons: Array.isArray(x.buttons)
        ? (x.buttons as unknown[]).slice(0, 10).map((b) => ({ label: String((b as FlowButton)?.label ?? "").slice(0, 60), next: (b as FlowButton)?.next ? String((b as FlowButton).next).slice(0, 40) : null })).filter((b) => b.label)
        : undefined,
      field: typeof x.field === "string" ? x.field.slice(0, 40).replace(/[^A-Za-z0-9_]/g, "") || "custom" : undefined,
      next: typeof x.next === "string" && x.next ? x.next.slice(0, 40) : null,
    });
  }
  return out;
}

/** Which flow (if any) starts on this customer message. */
export function pickFlow(flows: Flow[], text: string, isFirstMessage: boolean): Flow | null {
  const t = norm(text);
  for (const f of flows) {
    if (!f.enabled || !f.nodes.length) continue;
    if (f.trigger_keywords.some((k) => k.trim() && t.includes(norm(k)))) return f;
  }
  if (isFirstMessage) return flows.find((f) => f.enabled && f.nodes.length && f.on_first_message) ?? null;
  return null;
}

export function validateAnswer(field: string | undefined, answer: string): string | null {
  const a = answer.trim();
  if (!a) return null;
  if (field === "phone") {
    const d = a.replace(/[^\d+]/g, "");
    return /^\+?\d{9,15}$/.test(d) ? d : null;
  }
  if (field === "email") return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(a) ? a.toLowerCase() : null;
  if (field === "name") return a.length <= 80 ? a : a.slice(0, 80);
  return a.slice(0, 500);
}

function retryText(field: string | undefined, locale: string): string {
  const he: Record<string, string> = { phone: "נראה שהמספר לא מלא. אפשר לכתוב שוב את מספר הטלפון?", email: "הכתובת לא נראית תקינה. אפשר לכתוב שוב את המייל?", default: "לא הבנתי, אפשר לנסות שוב?" };
  const en: Record<string, string> = { phone: "That number looks incomplete — could you type your phone number again?", email: "That address doesn't look right — could you type your e-mail again?", default: "Sorry, I didn't get that — could you try again?" };
  const ar: Record<string, string> = { phone: "يبدو الرقم غير مكتمل — هل يمكنك كتابة رقم الهاتف مجدداً؟", email: "يبدو البريد غير صحيح — هل يمكنك كتابته مجدداً؟", default: "لم أفهم — هل يمكنك المحاولة مجدداً؟" };
  const d = locale === "en" ? en : locale === "ar" ? ar : he;
  return d[field ?? ""] ?? d.default!;
}

function fill(text: string | undefined, data: Record<string, string>): string {
  return (text ?? "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => data[k] ?? "");
}

/**
 * One step of a flow: process the customer's answer (when the current step waits for
 * one), then emit steps until one waits for the customer or the flow ends.
 */
export function advanceFlow(flow: Flow, state: FlowState | null, customerText: string, locale = "he"): FlowOutput {
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const out: FlowOutput = { messages: [], state: null, handoff: false, toAI: false, finished: false, collected: {} };
  let data = { ...(state?.data ?? {}) };
  let cur: FlowNode | undefined;

  if (state) {
    const waiting = byId.get(state.node_id);
    if (!waiting) {
      out.finished = true;
      return out;
    }
    if (waiting.type === "buttons") {
      const t = norm(customerText);
      const idx = /^\d{1,2}$/.test(t) ? Number(t) - 1 : -1;
      const choice = (waiting.buttons ?? []).find((b, i) => norm(b.label) === t || i === idx) ?? (waiting.buttons ?? []).find((b) => t.includes(norm(b.label)));
      if (!choice) {
        // not one of the choices → the free AI handles it (the flow pauses on the same step)
        out.toAI = true;
        out.state = { ...state, data };
        return out;
      }
      data = { ...data, [`choice_${waiting.id}`]: choice.label };
      cur = choice.next ? byId.get(choice.next) : waiting.next ? byId.get(waiting.next) : undefined;
    } else if (waiting.type === "collect") {
      const v = validateAnswer(waiting.field, customerText);
      if (!v) {
        out.invalid = true;
        out.messages.push({ text: retryText(waiting.field, locale) });
        out.state = { ...state, data };
        return out;
      }
      const key = waiting.field || "custom";
      data = { ...data, [key === "custom" ? `answer_${waiting.id}` : key]: v };
      out.collected[key === "custom" ? `answer_${waiting.id}` : key] = v;
      cur = waiting.next ? byId.get(waiting.next) : undefined;
    } else {
      cur = waiting.next ? byId.get(waiting.next) : undefined;
    }
  } else {
    cur = flow.nodes[0];
  }

  for (let i = 0; i < MAX_STEPS && cur; i++) {
    const text = fill(cur.text, data);
    if (cur.type === "message") {
      if (text) out.messages.push({ text });
      cur = cur.next ? byId.get(cur.next) : undefined;
      continue;
    }
    if (cur.type === "buttons") {
      out.messages.push({ text: text || "👇", buttons: (cur.buttons ?? []).map((b) => b.label).slice(0, 10) });
      out.state = { flow_id: flow.id, node_id: cur.id, data, started_at: state?.started_at ?? new Date().toISOString() };
      out.collected = { ...out.collected };
      return out;
    }
    if (cur.type === "collect") {
      if (text) out.messages.push({ text });
      out.state = { flow_id: flow.id, node_id: cur.id, data, started_at: state?.started_at ?? new Date().toISOString() };
      return out;
    }
    if (cur.type === "handoff") {
      if (text) out.messages.push({ text });
      out.handoff = true;
      out.finished = true;
      out.collected = { ...data, ...out.collected };
      return out;
    }
    if (cur.type === "ai") {
      if (text) out.messages.push({ text });
      out.toAI = !text;
      out.finished = true;
      out.collected = { ...data, ...out.collected };
      return out;
    }
    // end
    if (text) out.messages.push({ text });
    out.finished = true;
    out.collected = { ...data, ...out.collected };
    return out;
  }
  out.finished = true;
  out.collected = { ...data, ...out.collected };
  return out;
}
