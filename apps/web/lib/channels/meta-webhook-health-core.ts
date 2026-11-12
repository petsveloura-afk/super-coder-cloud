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

/** true when `current` is the same path as `expected` on another https host, and `expected` itself is a public https address */
export function ownPathOnOldAddress(current: string, expected: string): boolean {
  try {
    const a = new URL(current);
    const b = new URL(expected);
    if (b.protocol !== "https:" || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(b.hostname) || b.hostname.endsWith(".internal")) return false;
    return a.host !== b.host && a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
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
      // the app moved (Vercel → Railway, a new domain): a callback that is OUR OWN path on the old address is safe to re-point;
      // any other address (staging, another system) is only reported, as before
      issues.push({ object, kind: "callback", detail: `the "${object}" webhook points to ${sub.callback_url} (this site is ${expectedCallback})`, fixable: ownPathOnOldAddress(sub.callback_url, expectedCallback) });
    }
  }
  return issues;
}
