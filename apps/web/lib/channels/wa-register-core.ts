/**
 * Wave 61 — plain-language reasons for Meta's WhatsApp registration errors, and a readable diagnosis of the
 * official number (pure, unit-tested). Every key returned here exists in he / en / ar.
 */

/** A translation key that explains Meta's refusal, or null when the error is unknown (the raw text is shown). */
export function explainRegisterError(error: string | null | undefined): string | null {
  const e = error ?? "";
  if (/133016|rate limit/i.test(e)) return "integrations.wa.why.tooMany";
  if (/133015|wait a few minutes/i.test(e)) return "integrations.wa.why.waitMinutes";
  if (/133006|needs? (to be )?verif/i.test(e)) return "integrations.wa.why.verifyFirst";
  if (/133000|deregist/i.test(e)) return "integrations.wa.why.deregister";
  if (/131031|locked|368|blocked|restricted|banned/i.test(e)) return "integrations.wa.why.locked";
  if (/133004|temporar|unavailable|try again/i.test(e)) return "integrations.wa.why.temporary";
  if (/coexist|business app|smb|already (registered|in use)|on.?premise/i.test(e)) return "integrations.wa.why.coexist";
  if (/\(#(10|200|190)\)|permission|not authorized|access token/i.test(e)) return "integrations.wa.why.permission";
  if (/business verification|verify (your|the) business/i.test(e)) return "integrations.wa.why.businessVerify";
  return null;
}

export interface DiagRow {
  key: string;
  value: string;
  ok: boolean | null;
}

const GOOD: Record<string, string[]> = {
  platform_type: ["CLOUD_API"],
  status: ["CONNECTED"],
  code_verification_status: ["VERIFIED"],
  name_status: ["APPROVED", "AVAILABLE_WITHOUT_REVIEW"],
  quality_rating: ["GREEN"],
  account_mode: ["LIVE"],
};
const SOFT: Record<string, string[]> = { name_status: ["PENDING_REVIEW", "NONE"], quality_rating: ["YELLOW", "UNKNOWN"], code_verification_status: ["EXPIRED"] };

/** The number's fields from Graph → rows with a verdict (true = fine, false = must fix, null = info / wait). */
export function waDiagnosis(j: Record<string, unknown>): DiagRow[] {
  const rows: DiagRow[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
  for (const key of ["display_phone_number", "verified_name", "platform_type", "status", "code_verification_status", "name_status", "quality_rating", "account_mode", "messaging_limit_tier"]) {
    const value = str(j[key]);
    if (!value) continue;
    const ok = GOOD[key] ? (GOOD[key]!.includes(value.toUpperCase()) ? true : SOFT[key]?.includes(value.toUpperCase()) ? null : false) : null;
    rows.push({ key, value, ok });
  }
  return rows;
}

/** One sentence: what to do first (the first failing row decides). */
export function diagnosisAdvice(rows: DiagRow[]): string | null {
  const bad = rows.find((r) => r.ok === false);
  if (!bad) return rows.some((r) => r.ok === null && r.key === "name_status") ? "integrations.wa.advice.nameReview" : null;
  switch (bad.key) {
    case "platform_type":
      return "integrations.wa.advice.register";
    case "status":
      return bad.value.toUpperCase() === "PENDING" ? "integrations.wa.advice.register" : "integrations.wa.advice.status";
    case "code_verification_status":
      return "integrations.wa.advice.verify";
    case "name_status":
      return "integrations.wa.advice.name";
    case "account_mode":
      return "integrations.wa.advice.sandbox";
    case "quality_rating":
      return "integrations.wa.advice.quality";
    default:
      return null;
  }
}
