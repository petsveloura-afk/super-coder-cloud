/**
 * Upgrade 9 — "do what was asked, completely" (pure, unit-tested; additive). Closes the gaps found on a real business:
 *   • posts were written into a report and never reached the posts board → they are saved as drafts (extractPosts);
 *   • a task that was asked to PRODUCE something ended "done" with nothing produced → it is marked partial, honestly;
 *   • the per-task credit allowance ran out before the final output → a finishing reserve, and a continuation task;
 *   • a quality check said "there is no draft" without looking → the plan rules require reading before judging.
 */

/** a production verb — the task asks to MAKE something (not only to analyse / check) */
const MAKE = /(כתו?ב|כתיבת|צור|יצירת|הכ[ןנ]|הכנת|נסח|ניסוח|פרסם|פרסום|שלח|שליחת|תכנן\s+ו|write|create|draft|prepare|compose|produce|publish|send|اكتب|أنشئ|جهّز|انشر)/i;
const POST = /(פוסט|פוסטים|post|posts|منشور|منشورات|תוכן\s+לרשתות|social\s+content)/i;
const ANALYSE_ONLY = /^(ניתוח|בחינת|בדיקת|סקירת|analy[sz]e|review|audit|تحليل|مراجعة)\b/i;

/** the task asks to WRITE social posts (and not only to analyse existing ones) */
export function wantsPosts(text: string): boolean {
  const t = (text ?? "").trim();
  if (!POST.test(t) || !MAKE.test(t)) return false;
  return !ANALYSE_ONLY.test(t);
}

/** the task asks to produce something concrete (a text, posts, a message, a plan …) */
export function wantsOutput(text: string): boolean {
  return MAKE.test(text ?? "");
}

const HEADER = /^\s*(?:#{1,4}\s*)?(?:\*\*)?\s*(?:פוסט|post|منشور)\s*(?:מס['׳]?\s*)?#?\s*\d+\s*[:.)\-–—]?\s*(?:\*\*)?\s*/i;

/**
 * Splits a written deliverable into individual posts: "פוסט 1:" / "Post 2" headers, "---" separators or numbered blocks.
 * Each post is cleaned of its header, kept only when it is real content (≥ 40 chars), at most `max`. A single post text
 * (no markers, ≤ 2,200 chars) is returned as one post.
 */
export function extractPosts(text: string, max = 7): string[] {
  const t = (text ?? "").replace(/\r/g, "").trim();
  if (!t) return [];
  let parts: string[] = [];
  const lines = t.split("\n");
  if (lines.some((l) => HEADER.test(l))) {
    let cur: string[] | null = null;
    for (const l of lines) {
      if (HEADER.test(l)) {
        if (cur) parts.push(cur.join("\n"));
        const rest = l.replace(HEADER, "").trim();
        cur = rest ? [rest] : [];
      } else if (cur) cur.push(l);
    }
    if (cur) parts.push(cur.join("\n"));
  } else if (/\n\s*-{3,}\s*\n/.test(t)) {
    parts = t.split(/\n\s*-{3,}\s*\n/);
  } else if (/^\s*1[.)]\s/m.test(t) && /^\s*2[.)]\s/m.test(t)) {
    parts = t.split(/\n(?=\s*\d+[.)]\s)/).map((p) => p.replace(/^\s*\d+[.)]\s*/, ""));
  } else if (t.length <= 2200) {
    parts = [t];
  }
  return parts
    .map((p) => p.replace(/^\s*(?:\*\*)?(?:טקסט|text)\s*:\s*/i, "").trim())
    .filter((p) => p.length >= 40)
    .slice(0, max)
    .map((p) => p.slice(0, 2200));
}

export interface Produced {
  /** drafts saved on the posts board */
  drafts: number;
  /** successful write actions (messages, notes, tasks, drafts …) */
  writes: number;
  /** owner approvals opened */
  approvals: number;
  /** handoffs to other employees */
  handoffs: number;
  /** length of the final written deliverable */
  deliverableChars: number;
  /** steps the plan had that were stopped by a limit */
  stopped: boolean;
}

/** honest completion: a task that was asked to produce something and produced nothing is PARTIAL, with the reason */
export function completionVerdict(input: { task: string; expectsPosts: boolean; produced: Produced }): { partial: boolean; reason: string | null } {
  const p = input.produced;
  if (input.expectsPosts && p.drafts === 0 && p.approvals === 0 && p.handoffs === 0) return { partial: true, reason: "no_post_drafts" };
  if (p.stopped && p.writes === 0 && p.deliverableChars < 40 && p.approvals === 0 && p.handoffs === 0) return { partial: true, reason: "stopped_by_limit" };
  if (wantsOutput(input.task) && p.writes === 0 && p.deliverableChars < 40 && p.approvals === 0 && p.handoffs === 0) return { partial: true, reason: "nothing_produced" };
  return { partial: false, reason: null };
}

/** credits kept for writing + checking the final output after the steps (so a limit never stops the work at the last step) */
export const FINISH_RESERVE = 12;

/** the rules added to every work plan (the model is told exactly what "done" means) */
export const DELIVERY_RULES = [
  "DELIVERY RULES (mandatory):",
  "- Do exactly what the task asks, completely. If it asks to WRITE / CREATE something, the result must be that thing — not a plan to make it.",
  "- Social posts: write each post in full; set deliverable.type to \"post\" (one post per block, starting with \"פוסט 1:\" / \"Post 1:\"). They are saved as drafts for the owner — never published without approval.",
  "- Reviewing / checking existing work: READ it first with the read tools (e.g. social.drafts for posts). Never say something does not exist without reading.",
  "- Every number, name, price and claim comes from the business data or a tool result — mark anything else as an assumption.",
  "- Finish with what was produced and what is still open (if anything).",
].join("\n");

/** the brief of a continuation task (the same employee picks up where the limit stopped the work) */
export function continuationBrief(input: { title: string; done: { tool: string; ok: boolean; summary: string }[]; reason: string }): string {
  const lines = input.done.slice(0, 12).map((r) => `- ${r.tool}: ${r.ok ? "done" : "not done"} — ${r.summary.slice(0, 200)}`);
  return [`Continue the task "${input.title}" from where it stopped (${input.reason.replace(/_/g, " ")}).`, lines.length ? `Already done:\n${lines.join("\n")}` : "", "Do NOT repeat what is already done — finish the remaining work and deliver the final result."].filter(Boolean).join("\n\n").slice(0, 5000);
}

export function continuationTitle(title: string, lang: "he" | "en" | "ar"): string {
  const p = lang === "en" ? "Continue: " : lang === "ar" ? "متابعة: " : "המשך: ";
  return (title.startsWith(p) ? title : `${p}${title}`).slice(0, 300);
}
