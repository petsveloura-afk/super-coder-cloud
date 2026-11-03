/**
 * Upgrade 7 / stage I — the Hebrew evaluation set. 40+ scenarios that run in CI WITHOUT a live model: each one feeds a real Hebrew
 * (slang, missing spelling, voice transcript) situation to the deterministic part of the team (understanding, routing, audit,
 * arbitration, forecast, anomalies, reports) and checks the behaviour a professional employee must show. The model-dependent part
 * is covered by the engine-layer tests with an exact mock model.
 */
import { askOrAssume, errorCost, understand, type Intent } from "./understanding-core";
import { appendRecord, auditDecision, classifyRoute, verifyChain } from "./decision-core";
import { arbitrate, nextEscalation } from "./coordination-core";
import { forecast, forecastLine, goalAlert } from "./goals-core";
import { buildReport, detectAnomaly } from "./reports-core";
import { analyze } from "./experiments-core";

export interface PlusEval {
  id: string;
  group: "understand" | "policy" | "route" | "audit" | "coordination" | "numbers";
  title: string;
  /** the Hebrew input (when there is one) */
  he?: string;
  check: () => string[];
}
const SERVICES = ["תספורת", "צבע", "החלקה"];
const ok = (c: boolean, m: string) => (c ? [] : [m]);
const intent = (he: string, want: Intent, title: string): PlusEval => ({ id: `u-${want}-${he.length}-${he.charCodeAt(0)}`, group: "understand", title, he, check: () => ok(understand(he, { knownServices: SERVICES }).intent === want, `"${he}" should be ${want}, got ${understand(he, { knownServices: SERVICES }).intent}`) });

const D = 86_400_000;
const NOW = Date.parse("2026-11-15T10:00:00Z");
const days = (from: string, v: number[]) => v.map((x, i) => ({ day: new Date(Date.parse(`${from}T00:00:00Z`) + i * D).toISOString().slice(0, 10), value: x }));
const draft = (over: Record<string, unknown> = {}) => ({ understood: "u", decided: "d", why: "הסיבה ברורה ומבוססת על הנתונים", confidence: 0.7, would_change_mind: ["עובדה חדשה"], options: [], chosen: null, premortem: null, ...over }) as Parameters<typeof auditDecision>[0];

export const PLUS7_EVALS: PlusEval[] = [
  // ---- understanding: slang, missing spelling, voice transcripts (16)
  intent("היי אפשר לקבוע תור לתספורת מחר בחמש", "booking", "booking, polite"),
  intent("אחי בא לי תור לצבע", "booking", "booking, slang"),
  intent("אממ כאילו אני רוצה לקבע תר ליום שלישי בערב", "booking", "booking, voice transcript with missing spelling"),
  intent("אפשר לשריין לי שעה בשישי", "booking", "booking, 'שריון'"),
  intent("אני צריך לבטל את התור של מחר", "cancel", "cancel"),
  intent("אפשר לדחות את הפגישה לשבוע הבא", "cancel", "reschedule is a change, not a new booking"),
  intent("לבתל תור בבקשה", "cancel", "cancel with a typo"),
  intent("כמה זה יוצא החלקה", "price", "price, slang"),
  intent("כמה עולא צבע", "price", "price, typo"),
  intent("מה המחיר של תספורת", "price", "price"),
  intent("מתי אתם פתוחים בשישי", "hours", "hours"),
  intent("עד מתי פתוח היום", "hours", "hours today"),
  intent("השירות היה גרוע ואני מאוד לא מרוצה", "complaint", "complaint"),
  intent("זה מחורבן, חיכיתי שעה בטלפון", "complaint", "complaint, strong"),
  intent("אפשר לדבר עם נציג בבקשה", "human", "asks for a person"),
  intent("מה המצב עם ההזמנה שלי? עדיין לא קיבלתי עדכון", "followup", "follow-up"),
  // ---- missing details and entities (4)
  { id: "u-missing-1", group: "understand", title: "booking without day / time lists exactly what is missing", he: "אפשר תור לתספורת", check: () => ok(understand("אפשר תור לתספורת", { knownServices: SERVICES }).missing.join() === "date,time", "missing should be date,time") },
  { id: "u-missing-2", group: "understand", title: "a complete booking has nothing missing", he: "תור לתספורת מחר ב17:30", check: () => ok(understand("תור לתספורת מחר ב17:30", { knownServices: SERVICES }).missing.length === 0, "should be complete") },
  { id: "u-amount", group: "understand", title: "spoken amount 'מאה עשרים שקל' is 120", he: "זה עלה לי מאה עשרים שקל", check: () => ok(understand("זה עלה לי מאה עשרים שקל").entities.amounts.some((a) => a.value === 120), "amount 120 not found") },
  { id: "u-urgent", group: "understand", title: "urgency from 'דחוף' and 'היום'", he: "דחוף! צריך תור היום", check: () => ok(understand("דחוף! צריך תור היום", { knownServices: SERVICES }).urgency >= 0.7, "urgency too low") },
  // ---- ask-or-assume policy (6)
  { id: "p-low-assume", group: "policy", title: "cheap question with a missing detail → assume out loud, do not block", he: "כמה עולה", check: () => { const u = understand("כמה עולה"); const p = askOrAssume(u, errorCost(u), "he"); return ok(p.mode === "assume" && p.assumptions.length > 0, `mode ${p.mode}`); } },
  { id: "p-medium-ask-one", group: "policy", title: "booking without a service → ONE question, the service first", he: "אפשר תור", check: () => { const u = understand("אפשר תור"); const p = askOrAssume(u, errorCost(u), "he"); return ok(p.mode === "ask" && p.question === "על איזה שירות מדובר?", `${p.mode}/${p.question}`); } },
  { id: "p-high-complaint", group: "policy", title: "an angry complaint is high-cost: never guessed, a person is needed", he: "זה בושה שירות מחורבן", check: () => ok(errorCost(understand("זה בושה שירות מחורבן")) === "high", "should be high cost") },
  { id: "p-high-refund", group: "policy", title: "a refund request is high-cost", he: "אני רוצה החזר של 200 שקל", check: () => ok(errorCost(understand("אני רוצה החזר של 200 שקל")) === "high", "should be high cost") },
  { id: "p-unreadable", group: "policy", title: "an unreadable fragment is asked about, not guessed", he: "אה", check: () => { const u = understand("אה"); return ok(askOrAssume(u, "low", "he").mode === "ask", "should ask"); } },
  { id: "p-clear-proceeds", group: "policy", title: "a complete request just proceeds", he: "תור לתספורת מחר ב17:30", check: () => { const u = understand("תור לתספורת מחר ב17:30", { knownServices: SERVICES }); return ok(askOrAssume(u, errorCost(u), "he").mode === "proceed", "should proceed"); } },
  // ---- routing (6)
  { id: "r-fast", group: "route", title: "an opening-hours question stays on the fast path", he: "מתי אתם פתוחים", check: () => ok(classifyRoute({ text: "מתי אתם פתוחים" }).route === "fast", "should be fast") },
  { id: "r-refund", group: "route", title: "'החזר' goes deep", he: "הלקוח דורש החזר", check: () => ok(classifyRoute({ text: "הלקוח דורש החזר" }).reasons.includes("high_risk_wording"), "refund wording") },
  { id: "r-lawyer", group: "route", title: "'עורך דין' goes deep", he: "הלקוח מאיים בעורך דין", check: () => ok(classifyRoute({ text: "הלקוח מאיים בעורך דין" }).route === "deep", "legal wording") },
  { id: "r-discount", group: "route", title: "'הנחה' goes deep", he: "תן לו הנחה גדולה", check: () => ok(classifyRoute({ text: "תן לו הנחה גדולה" }).route === "deep", "discount wording") },
  { id: "r-money", group: "route", title: "a money action goes deep even with harmless words", check: () => ok(classifyRoute({ text: "שלח תזכורת", steps: [{ tool: "agents.run_collections", sensitivity: "money" }] }).reasons.includes("money_action"), "money action") },
  { id: "r-mass", group: "route", title: "a message to 20 customers goes deep", check: () => ok(classifyRoute({ customerFacing: true, recipients: 20 }).route === "deep", "many recipients") },
  // ---- the decision audit (5)
  { id: "a-ok", group: "audit", title: "a complete fast record passes", check: () => ok(auditDecision(draft(), { route: "fast" }).passed, "should pass") },
  { id: "a-no-why", group: "audit", title: "no reason → fails", check: () => ok(auditDecision(draft({ why: "" }), { route: "fast" }).failures.includes("missing_reason"), "should fail") },
  { id: "a-price", group: "audit", title: "an invented price in the reasoning is caught (Hebrew)", he: "התספורת עולה 999 ₪", check: () => ok(auditDecision(draft({ why: "התספורת עולה 999 ₪ ולכן מתאים" }), { route: "fast", known: "תספורת 120" }).failures.some((f) => f.startsWith("invented_price")), "should catch the price") },
  { id: "a-deep", group: "audit", title: "a deep decision without a pre-mortem fails", check: () => ok(auditDecision(draft(), { route: "deep" }).failures.includes("deep_needs_options"), "deep needs options") },
  { id: "a-chain", group: "audit", title: "the decision log detects tampering", check: () => { const l = appendRecord(appendRecord([], draft(), { id: "1", task_id: "t", member_id: null, route: "fast", route_reasons: [], confidence: 0.7, audit: null, now: 1 }), draft(), { id: "2", task_id: "t", member_id: null, route: "fast", route_reasons: [], confidence: 0.7, audit: null, now: 2 }); return ok(verifyChain(l).ok && !verifyChain(l.map((r, i) => (i ? { ...r, why: "שונה" } : r))).ok, "chain check"); } },
  // ---- coordination (3)
  { id: "c-owner-wins", group: "coordination", title: "the owner's confirmed price beats two employees", check: () => ok(arbitrate([{ member: "a", role: "sales", subject: "price", value: "150", source: "employee", confidence: 0.9, at: 1 }, { member: "b", role: "marketing", subject: "price", value: "150", source: "employee", confidence: 0.9, at: 2 }, { member: "o", role: "manager", subject: "price", value: "120", source: "owner_confirmed", confidence: 1, at: 0 }], "price").winner?.value === "120", "owner should win") },
  { id: "c-two-owner", group: "coordination", title: "two different owner-confirmed values go back to the owner", check: () => ok(arbitrate([{ member: "a", role: "m", subject: "x", value: "1", source: "owner_confirmed", confidence: 1, at: 1 }, { member: "b", role: "m", subject: "x", value: "2", source: "owner_confirmed", confidence: 1, at: 2 }]).needsOwner, "needs the owner") },
  { id: "c-ladder", group: "coordination", title: "a high-severity stuck task reaches the manager quickly", check: () => ok(nextEscalation({ attempts: 1, ageHours: 3, severity: "high" }) === "manager", "should be manager") },
  // ---- numbers (5)
  { id: "n-few-days", group: "numbers", title: "a goal with 4 days of data says 'אין מספיק נתונים'", he: "אין מספיק נתונים", check: () => { const f = forecast({ metric: "leads_new", baseline: 0, target: 30, start_date: "2026-11-12", due_date: "2026-11-30" }, days("2026-11-12", [1, 2, 1, 1]), NOW); return ok(f.risk === "not_enough_data" && forecastLine(f, "he").includes("אין מספיק נתונים"), "honest answer missing"); } },
  { id: "n-off-track", group: "numbers", title: "a trickle cannot reach the goal → off track, one alert", check: () => { const f = forecast({ metric: "leads_new", baseline: 0, target: 30, start_date: "2026-11-01", due_date: "2026-11-30" }, days("2026-11-01", [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), NOW); return ok(f.risk === "off_track" && goalAlert("on_track", f.risk) === "off_track" && goalAlert("off_track", f.risk) === null, "off-track alert once"); } },
  { id: "n-anomaly", group: "numbers", title: "a sudden spike in leads is flagged; a normal day is not", check: () => { const calm = [5, 6, 4, 5, 7, 5, 6, 4, 5, 6, 5, 4, 6, 5]; return ok(!!detectAnomaly("leads", days("2026-10-01", [...calm, 30])) && !detectAnomaly("leads", days("2026-10-01", [...calm, 7])), "anomaly thresholds"); } },
  { id: "n-report-he", group: "numbers", title: "the weekly report is in Hebrew with the real numbers", he: "דוח שבועי", check: () => { const r = buildReport({ period: "week", cur: { leads: 30 }, prev: { leads: 20 }, lang: "he" }); return ok(r.title === "דוח שבועי" && r.text.includes("לידים חדשים: 30 (+50%)"), "Hebrew report"); } },
  { id: "n-ab", group: "numbers", title: "an A/B test far below the sample size does not declare a winner", check: () => ok(["not_enough_data", "keep_running"].includes(analyze({ baseline_rate: 0.1, min_effect: 0.5, min_days: 7, started_at: "2026-11-01T00:00:00Z", a: { name: "A", trials: 40, successes: 2 }, b: { name: "B", trials: 40, successes: 9 } }, NOW).verdict), "must not declare") },
];

export function runPlus7Evals(): { id: string; group: string; title: string; pass: boolean; failures: string[] }[] {
  return PLUS7_EVALS.map((s) => {
    let failures: string[];
    try {
      failures = s.check();
    } catch (e) {
      failures = [`threw: ${(e as Error).message}`];
    }
    return { id: s.id, group: s.group, title: s.title, pass: failures.length === 0, failures };
  });
}
