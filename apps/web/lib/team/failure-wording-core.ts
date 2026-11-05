/**
 * Wave 68 — the AI-layer wordings that mean "busy or answered badly, it heals by itself" (pure, no imports, so that both
 * tool-failure-core and failure-reason-core can use it without importing each other).
 */
const TEMPORARY = /rate_limited|rate-limited|ai\.limit|ai_limit|limit_reached|resource_exhausted|service unavailable|overloaded|try again|please retry|plan_unreadable|ai_unreadable|unreadable|unparsable|no_models|ai\.no_|empty_response|עמוס|ינסה שוב|נסו שוב|مشغول/i;

/** a wording that means "the AI side is busy or answered badly — it heals by itself" */
export function looksTemporaryFailure(error: string | null | undefined): boolean {
  return TEMPORARY.test(error ?? "");
}
