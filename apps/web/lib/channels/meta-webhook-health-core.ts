/**
 * Wave 43 — is the Meta APP itself (not a single Page) set up to DELIVER Messenger / Instagram messages? (pure, unit-tested)
 * When the app-level webhook is missing, inactive or lacks the "messages" field nothing reaches the server at all and
 * the inbox only fills from the slow safety-net poller (minutes or hours late). This reads Meta's own answer for
 * GET /{app-id}/subscriptions and says exactly what is missing.
 */
export const APP_WEBHOOK_OBJECTS: Record<"page" | "instagram", readonly string[]> = {
  page: ["messages", "messaging_postbacks", "message_echoes", "messaging_referrals", "feed"],
  instagram: ["messages", "comments"],
};

export const CRITICAL_FIELDS: Record<"page" | "instagram", readonly string[]> = {
  page: ["messages"],
  instagram: ["messages"],
};

interface RawSubs {
  data?: { object?: string; callback_url?: string; active?: boolean; fields?: ({ name?: string } | string)[] }[];
}

export interface AppWebhookIssue {
  object: "page" | "instagram";
  /** "missing" | "inactive" | "fields" → safe to repair; "callback" → only reported (it may be intentional) */
  kind: "missing" | "inactive" | "fields" | "callback";
  detail: string;
  fixable: boolean;
}

export function evaluateAppSubscriptions(json: unknown, expectedCallback: string): AppWebhookIssue[] {
  const list = (json as RawSubs | null)?.data ?? [];
  const issues: AppWebhookIssue[] = [];
  for (const object of ["page", "instagram"] as const) {
    const sub = list.find((s) => s.object === object);
    if (!sub) {
      issues.push({ object, kind: "missing", detail: `the Meta app has no "${object}" webhook subscription`, fixable: true });
      continue;
    }
    if (sub.active === false) issues.push({ object, kind: "inactive", detail: `the "${object}" webhook is switched off`, fixable: true });
    const have = new Set((sub.fields ?? []).map((f) => (typeof f === "string" ? f : f.name ?? "")));
    const lacking = CRITICAL_FIELDS[object].filter((f) => !have.has(f));
    if (lacking.length) issues.push({ object, kind: "fields", detail: `the "${object}" webhook lacks: ${lacking.join(", ")}`, fixable: true });
    if (sub.callback_url && expectedCallback && sub.callback_url.replace(/\/$/, "") !== expectedCallback.replace(/\/$/, "")) {
      issues.push({ object, kind: "callback", detail: `the "${object}" webhook points to ${sub.callback_url} (this site is ${expectedCallback})`, fixable: false });
    }
  }
  return issues;
}
