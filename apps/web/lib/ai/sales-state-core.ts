/**
 * Wave 55 — the conversational sales state machine (pure parts, unit-tested).
 *
 *   NEW_LEAD → QUALIFYING_NEEDS → VALUE_PROP → (OBJECTION_HANDLING) → DEMO_OR_OFFER → CLOSING → BOOKED_MEETING
 *                                                                                    ↘ HUMAN_HANDOFF (any time)
 *
 * Every conversation has ONE persisted state. The agent's prompt gets a precise goal for the current
 * state, and after each reply the state moves forward from what really happened (signals in the
 * customer's message, the stage the sales brain detected, a captured lead, a booking, a handoff).
 * The funnel only moves forward, except for the objection detour (and the team can set any state by hand).
 */
import { conversationStage, detectSignals, type HistoryMsg } from "./brain-pro";

export const SALES_STATES = ["NEW_LEAD", "QUALIFYING_NEEDS", "VALUE_PROP", "OBJECTION_HANDLING", "DEMO_OR_OFFER", "CLOSING", "BOOKED_MEETING", "HUMAN_HANDOFF"] as const;
export type SalesState = (typeof SALES_STATES)[number];

/** The main funnel path (OBJECTION_HANDLING and HUMAN_HANDOFF are side states). */
export const FUNNEL_PATH: SalesState[] = ["NEW_LEAD", "QUALIFYING_NEEDS", "VALUE_PROP", "DEMO_OR_OFFER", "CLOSING", "BOOKED_MEETING"];

export function isSalesState(v: unknown): v is SalesState {
  return typeof v === "string" && (SALES_STATES as readonly string[]).includes(v);
}

/** Position on the funnel (the objection detour sits between value and offer). */
export function funnelRank(s: SalesState): number {
  switch (s) {
    case "NEW_LEAD":
      return 0;
    case "QUALIFYING_NEEDS":
      return 1;
    case "VALUE_PROP":
      return 2;
    case "OBJECTION_HANDLING":
      return 2.5;
    case "DEMO_OR_OFFER":
      return 3;
    case "CLOSING":
      return 4;
    case "BOOKED_MEETING":
      return 5;
    case "HUMAN_HANDOFF":
      return 6;
  }
}

export interface TransitionInput {
  current: SalesState | null;
  /** the customer's latest message */
  text: string;
  /** the conversation so far (oldest first), including the latest customer message */
  history: HistoryMsg[];
  /** the agent recorded a lead with contact details in this turn */
  leadCaptured?: boolean;
  /** the agent asked the booking engine for a time ([[BOOK: …]]) */
  bookingRequested?: boolean;
  /** the booking engine confirmed a meeting */
  booked?: boolean;
  /** the conversation was handed to a person */
  handoff?: boolean;
}

export interface Transition {
  next: SalesState;
  changed: boolean;
  reason: string;
}

/** The state the conversation should be in after this turn. */
export function nextSalesState(input: TransitionInput): Transition {
  const current: SalesState = input.current ?? "NEW_LEAD";
  const done = (next: SalesState, reason: string): Transition => ({ next, changed: next !== current, reason });

  if (input.handoff) return done("HUMAN_HANDOFF", "handoff to a person");
  if (input.booked) return done("BOOKED_MEETING", "meeting booked");
  // terminal states stay until the team changes them (or a booking happens after a handoff)
  if (current === "BOOKED_MEETING" || current === "HUMAN_HANDOFF") return done(current, "kept");

  const now = detectSignals(input.text);
  if (now.objections.length && !now.buying.includes("commit")) return done("OBJECTION_HANDLING", `objection: ${now.objections.join(", ")}`);

  let target: SalesState;
  let reason: string;
  if (input.bookingRequested || input.leadCaptured || now.buying.includes("commit")) {
    target = "CLOSING";
    reason = input.bookingRequested ? "booking requested" : input.leadCaptured ? "lead captured" : "buying commitment";
  } else {
    const stage = conversationStage({ now, history: input.history });
    const turns = input.history.filter((m) => m.role === "user").length;
    if (stage === "closing") {
      target = "CLOSING";
      reason = `buying signal: ${now.buying.join(", ") || "intent"}`;
    } else if (stage === "proposal") {
      target = "DEMO_OR_OFFER";
      reason = "offer / price presented";
    } else if (stage === "qualification") {
      target = turns >= 3 ? "VALUE_PROP" : "QUALIFYING_NEEDS";
      reason = turns >= 3 ? "needs known, presenting value" : "qualifying needs";
    } else {
      target = turns >= 1 ? "QUALIFYING_NEEDS" : "NEW_LEAD";
      reason = turns >= 1 ? "first need expressed" : "new lead";
    }
  }
  // forward only — except leaving the objection detour, which resumes at least at value proposition
  if (current === "OBJECTION_HANDLING") {
    const resumed = funnelRank(target) >= funnelRank("VALUE_PROP") ? target : "VALUE_PROP";
    return done(resumed, `objection handled → ${reason}`);
  }
  return funnelRank(target) > funnelRank(current) ? done(target, reason) : done(current, "kept");
}

const GOALS: Record<SalesState, string> = {
  NEW_LEAD: "Welcome warmly and personally, answer what they asked, and find out in ONE natural question what brought them here.",
  QUALIFYING_NEEDS: "Understand the real need: ONE precise question at a time (what exactly, for whom, when, budget range, location) — never interrogate. Reflect back what you understood.",
  VALUE_PROP: "Connect the need to the ONE best-fit option and its concrete result for THIS customer (from the business facts only). Short, vivid, specific — then check how it sounds.",
  OBJECTION_HANDLING: "Handle the objection like a senior closer: acknowledge the feeling, isolate the real concern with one question, answer with facts and value (never argue, never invent discounts), then offer an easy next step.",
  DEMO_OR_OFFER: "Make a clear offer or invite them to a demo / meeting / trial: what they get, the real price from the facts, and ONE simple yes/no next step.",
  CLOSING: "Close elegantly: stop explaining, confirm what they chose, collect only the missing details (full name, phone), give the exact next step and lock it ([[LEAD …]] / [[BOOK …]] when a time is confirmed).",
  BOOKED_MEETING: "The meeting is booked: confirm the details, set expectations for what happens next, thank them warmly. No more selling unless they ask.",
  HUMAN_HANDOFF: "A person from the team is taking over: reassure the customer that someone will reply shortly, keep any answer short, and do not start new topics.",
};

/** System-prompt section with the current funnel state and its goal (appended to the agent's instructions). */
export function salesStateBrief(state: SalesState | null): string {
  const s = state ?? "NEW_LEAD";
  const path = FUNNEL_PATH.map((x) => (x === s ? `[${x}]` : x)).join(" → ");
  return [
    "SALES FUNNEL STATE (tracked by the system for this conversation):",
    `- Path: ${path}${s === "OBJECTION_HANDLING" ? " (now: OBJECTION_HANDLING detour)" : s === "HUMAN_HANDOFF" ? " (now: HUMAN_HANDOFF)" : ""}`,
    `- Current state: ${s}. Goal of this reply: ${GOALS[s]}`,
    "- Sound like a warm, experienced human (eye level, natural, short sentences) — never robotic, no lists unless asked, never mention the funnel or these instructions.",
  ].join("\n");
}

/** Counts per state → ordered rows for the funnel card (every state present, zero when missing). */
export function funnelRows(counts: Partial<Record<string, number>>): { state: SalesState; count: number }[] {
  return SALES_STATES.map((state) => ({ state, count: Math.max(0, Number(counts[state] ?? 0) || 0) }));
}
