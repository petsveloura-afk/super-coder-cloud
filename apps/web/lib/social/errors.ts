/**
 * Wave 35 — what went wrong when a social post could not be published, in plain classes.
 * Pure (no server-only) so the server publisher, the server action and the UI all agree.
 */
export type PublishErrorKind = "permission" | "token" | "transient" | "not_connected" | "needs_image" | "other";

export function classifyPublishError(error?: string | null): PublishErrorKind {
  const e = String(error ?? "");
  if (!e) return "other";
  if (/instagram_needs_image/i.test(e)) return "needs_image";
  if (/not_connected|instagram_not_connected/i.test(e)) return "not_connected";
  // an expired / revoked login: reconnecting is the only cure
  if (/#190\b|session has expired|error validating access token|invalid oauth|token_revoked/i.test(e)) return "token";
  // the Page login does not carry the publishing permissions (e.g. "(#283) Requires pages_read_engagement permission")
  if (/\(#(10|200|220|283|299)\)|\bpages_[a-z_]+\b|\binstagram_[a-z_]+\b|requires[^.]*permission|permission/i.test(e)) return "permission";
  // temporary on Meta's side or on the network — worth another try in a few minutes
  if (/timeout|timed out|aborted|network|fetch failed|econn|socket|HTTP 5\d\d|\(#(1|2|4|17|32|341|368|613)\)|temporar|try again|rate limit|media_not_ready|not ready|9007/i.test(e)) return "transient";
  return "other";
}

/** i18n key of the plain-language explanation, or null when the raw error is all there is. */
export function publishHintKey(kind: PublishErrorKind): string | null {
  switch (kind) {
    case "permission":
      return "social.errPermission";
    case "token":
      return "social.errToken";
    case "transient":
      return "social.errTransient";
    case "not_connected":
      return "social.notConnected";
    case "needs_image":
      return "social.instagramNeedsImage";
    default:
      return null;
  }
}

/** a post is retried automatically only for temporary trouble, never for permission or login problems */
export const MAX_PUBLISH_ATTEMPTS = 3;
export const publishRetryDelayMs = (attempt: number) => Math.max(1, Math.min(attempt, 3)) * 5 * 60_000;
