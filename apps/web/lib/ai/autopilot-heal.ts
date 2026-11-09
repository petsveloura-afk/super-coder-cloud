/**
 * Wave 57 — the agent never gets stuck (pure helpers, unit-tested).
 *
 * A conversation must pause for a person only when a person took it, the customer asked for one, a
 * guardrail fired, or the AI credits ran out. A technical hiccup (an empty or broken AI answer, a busy
 * engine, a timeout) must NOT leave the customer waiting until someone presses "return to agent".
 */

/** Pause reasons (conversations.ai_note) that are technical — the agent takes the conversation back by itself. */
export function technicalPause(note: string | null | undefined): boolean {
  const n = (note ?? "").trim();
  if (!n) return false;
  if (/limit|demo|credit|quota/i.test(n)) return false; // out of AI credits → a person on purpose
  return n === "empty_answer" || n === "ai_busy" || n === "agent_error" || /^ai\.(?:failed|busy|self_check_timeout|empty_retry_timeout|notConfigured)$/.test(n);
}

/**
 * Removes control lines the parsers did not recognise (a free model wrote "[[FOLLOW-UP …]]",
 * "[[TASK - …]]", an unfinished "[[…" at the end) so the customer never sees them.
 */
export function stripStrayMarkers(text: string): string {
  return (text ?? "")
    .replace(/\[\[[^\]]{0,900}\]\]/g, " ")
    .replace(/\[\[[^\]]*$/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ------------------------------------------------------------------ the agent never goes silent (additive)
 * A conversation the AGENT handed to the team (a price it could not confirm, the customer asked for a person, the watchdog
 * after busy engines…) used to stay with "a person" forever when nobody from the team answered — the next customer
 * messages got no reply at all. These helpers decide when the agent takes such a conversation back by itself. */

/** pause reasons that technically failed — also the watchdog's own hand-over after busy engines */
export function technicalPauseExtended(note: string | null | undefined): boolean {
  const n = (note ?? "").trim();
  // wave A4: a reply the outbound guard held (a false alarm is possible) is a hiccup, not a decision of a person → the agent returns with the next message
  return technicalPause(n) || n === "stuck_no_answer" || n === "agent_timeout" || n === "guardrail_unready";
}

/** default minutes of team silence after an AGENT hand-over before the agent answers again (agent profile can change it; 0 = never) */
export const DEFAULT_UNATTENDED_RESUME_MINUTES = 15;

export interface UnattendedInput {
  /** conversations.ai_note — the hand-over reason */
  note: string | null | undefined;
  /** conversations.handoff_at */
  handoffAt: string | null | undefined;
  /** conversations.owner_takeover_at — set when the owner wrote himself (that path has its own "resume after" rule) */
  ownerTakeoverAt: string | null | undefined;
  /** a person from the team (app or owner phone) wrote in the conversation after the hand-over */
  teamAnsweredSince: boolean;
  /** the agent's setting (profile.unattended_resume_minutes); undefined = default */
  minutes?: number | null;
  now: number;
}

/**
 * true when the agent should take the conversation back: the AGENT (not a person) handed it over, nobody from the team
 * wrote since, and enough time passed. Never for legal threats / threats of harm, forbidden phrases, or no AI credits.
 */
export function unattendedResume(i: UnattendedInput): boolean {
  if (i.teamAnsweredSince) return false;
  if (i.ownerTakeoverAt) return false;
  const minutes = i.minutes === undefined || i.minutes === null || !Number.isFinite(Number(i.minutes)) ? DEFAULT_UNATTENDED_RESUME_MINUTES : Math.max(0, Math.min(10080, Number(i.minutes)));
  if (minutes <= 0) return false;
  const note = (i.note ?? "").trim();
  if (/^critical/i.test(note) || /banned/i.test(note)) return false;
  if (/limit|demo|credit|quota/i.test(note)) return false;
  const at = i.handoffAt ? Date.parse(i.handoffAt) : NaN;
  if (!Number.isFinite(at)) return false;
  const waitMs = (note === "ai_budget" ? Math.max(minutes, 12 * 60) : minutes) * 60_000;
  return i.now - at >= waitMs;
}

/** one line for the agent's instructions after it took a conversation back (the customer already heard "passing to the team") */
export function resumedNote(lang: string): string {
  if (lang === "en") return "NOTE: earlier in this conversation it was passed to the team, and nobody from the team has answered yet. Do not leave the customer waiting: answer the new message yourself as well as you can. If something truly needs a person, say honestly that the team will also get back to them — never invent details.";
  if (lang === "ar") return "ملاحظة: حُوّلت هذه المحادثة سابقًا إلى الفريق ولم يرد أحد بعد. لا تترك العميل ينتظر: أجب عن الرسالة الجديدة بنفسك قدر الإمكان. إن كان الأمر يحتاج شخصًا حقًا فقل بصدق إن الفريق سيعود إليه أيضًا — دون اختراع تفاصيل.";
  return "הערה: קודם בשיחה הזו היא הועברה לצוות, ואף אחד מהצוות עוד לא ענה. אל תשאיר את הלקוח מחכה: ענה בעצמך על ההודעה החדשה כמיטב יכולתך. אם משהו באמת דורש אדם, אמור בכנות שהצוות יחזור אליו גם כן — בלי להמציא פרטים.";
}

/** an automatic "please wait" line (hold message or the watchdog's hand-over) — never counts as a real answer */
export function isPlaceholderOut(meta: { fallback?: unknown; escalation?: unknown } | null | undefined): boolean {
  return meta?.fallback === true || meta?.escalation === true;
}
