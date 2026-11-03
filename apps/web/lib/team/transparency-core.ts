/**
 * Upgrade 7 / stage J — transparency (pure). The "why did you do this" view is built ONLY from the decision record (never from raw
 * model reasoning), and an owner's correction becomes a PROPOSED lesson — active only after the owner confirms it.
 */
import { decisionLabels, type DecisionDraft, type DecisionRecord, type LessonProposal, type Lang } from "./decision-core";

export interface Explanation {
  route: "fast" | "deep";
  routeWhy: string[];
  sections: { key: "understood" | "options" | "decided" | "why" | "premortem" | "change" | "audit"; label: string; lines: string[] }[];
  confidencePct: number;
  /** the model's own number before calibration, shown only when calibration changed it by 5+ points */
  rawConfidencePct: number | null;
}

const REASON: Record<Lang, Record<string, string>> = {
  he: { money_action: "פעולה כספית", irreversible_action: "פעולה בלתי הפיכה", many_recipients: "הרבה נמענים", large_amount: "סכום גדול", high_risk_wording: "ניסוח רגיש (החזר / משפטי / הנחה)", high_cost_of_error: "טעות יקרה", unsure_reading: "הבנה לא בטוחה מול לקוח", goal_with_customers: "יעד שמערב לקוחות" },
  en: { money_action: "money action", irreversible_action: "irreversible action", many_recipients: "many recipients", large_amount: "large amount", high_risk_wording: "sensitive wording (refund / legal / discount)", high_cost_of_error: "costly mistake", unsure_reading: "unsure reading with a customer", goal_with_customers: "goal involving customers" },
  ar: { money_action: "إجراء مالي", irreversible_action: "إجراء لا رجعة فيه", many_recipients: "مستلمون كثر", large_amount: "مبلغ كبير", high_risk_wording: "صياغة حساسة (استرجاع / قانوني / خصم)", high_cost_of_error: "خطأ مكلف", unsure_reading: "فهم غير مؤكد مع عميل", goal_with_customers: "هدف يشمل عملاء" },
};

export function explainDecision(r: Pick<DecisionRecord, keyof DecisionDraft | "route" | "route_reasons" | "confidence" | "raw_confidence" | "audit">, lang: Lang): Explanation {
  const t = decisionLabels(lang);
  const sections: Explanation["sections"] = [{ key: "understood", label: t.understood, lines: [r.understood] }];
  if (r.options.length) sections.push({ key: "options", label: t.options, lines: r.options.map((o) => `${o.id}) ${o.title}${o.id === r.chosen ? " ✓" : ""} — ${o.summary}`.slice(0, 300)) });
  sections.push({ key: "decided", label: t.decided, lines: [r.decided] }, { key: "why", label: t.why, lines: [r.why] });
  if (r.premortem?.failure_modes.length) sections.push({ key: "premortem", label: t.premortem, lines: r.premortem.failure_modes.map((f) => `${f.cause} → ${f.mitigation}`) });
  if (r.would_change_mind.length) sections.push({ key: "change", label: t.change, lines: r.would_change_mind });
  if (r.audit) sections.push({ key: "audit", label: t.audit[r.audit.verdict], lines: r.audit.issues });
  const pct = Math.round(r.confidence * 100);
  const raw = Math.round(r.raw_confidence * 100);
  return { route: r.route, routeWhy: r.route_reasons.map((x) => REASON[lang][x] ?? x), sections, confidencePct: pct, rawConfidencePct: Math.abs(raw - pct) >= 5 ? raw : null };
}

/** the owner's correction → a proposed lesson (never active on its own) */
export function correctionLesson(r: Pick<DecisionRecord, "decided" | "route">, correction: string): LessonProposal | null {
  const c = correction.replace(/\s+/g, " ").trim().slice(0, 400);
  if (c.length < 3) return null;
  return { layer: "semantic", kind: "correction", content: `The owner corrected a decision. I did: "${r.decided.slice(0, 160)}". The owner wants instead: "${c}".`, subject: `owner_correction:${c.slice(0, 40).toLowerCase()}`, confidence: 0.8, status: "proposed", tags: ["owner_correction", r.route] };
}
