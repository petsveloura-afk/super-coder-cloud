import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Wave 15 — signed one-tap action links (reminders on WhatsApp / SMS / e-mail):
 * "mark the task done", "snooze 15 minutes", "confirm / cancel the meeting".
 * token = base64url(payload) + "." + base64url(HMAC-SHA256(payload)).
 * The key is derived from ENCRYPTION_KEY (or CRON_SECRET); links expire.
 * Opening a link only SHOWS a confirmation page — the action runs on a button
 * press (POST), so link previews in WhatsApp / mail scanners never trigger it.
 */
export interface ActPayload {
  /** kind: task | appt */
  k: "task" | "appt";
  /** entity id */
  id: string;
  /** action */
  a: "done" | "snooze" | "confirm" | "cancel";
  /** org */
  o: string;
  /** user (tasks) */
  u?: string;
  /** expiry (unix seconds) */
  e: number;
}

function key(env: Record<string, string | undefined> = process.env): Buffer {
  const base = env.ENCRYPTION_KEY || env.CRON_SECRET || "";
  if (base.length < 16) throw new Error("act_links_key_missing");
  return createHmac("sha256", base).update("scc-act-links-v1").digest();
}

export function actLinksReady(env: Record<string, string | undefined> = process.env): boolean {
  return (env.ENCRYPTION_KEY || env.CRON_SECRET || "").length >= 16;
}

export function signAct(p: ActPayload, env?: Record<string, string | undefined>): string {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", key(env)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAct(token: string, now = Date.now(), env?: Record<string, string | undefined>): ActPayload | null {
  if (typeof token !== "string" || token.length > 1200 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
  const [body, sig] = token.split(".") as [string, string];
  let expected: Buffer;
  try {
    expected = createHmac("sha256", key(env)).update(body).digest();
  } catch {
    return null;
  }
  const given = Buffer.from(sig, "base64url");
  // canonical encoding only (no alternative spellings of the same signature)
  if (given.toString("base64url") !== sig) return null;
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ActPayload;
    if (!p || typeof p !== "object" || !["task", "appt"].includes(p.k) || !["done", "snooze", "confirm", "cancel"].includes(p.a)) return null;
    if (typeof p.e !== "number" || p.e * 1000 < now) return null;
    if (!/^[0-9a-f-]{36}$/.test(p.id) || !/^[0-9a-f-]{36}$/.test(p.o) || (p.u !== undefined && !/^[0-9a-f-]{36}$/.test(p.u))) return null;
    return p;
  } catch {
    return null;
  }
}

export function actUrl(appUrl: string, locale: string, p: ActPayload, env?: Record<string, string | undefined>): string {
  return `${appUrl.replace(/\/$/, "")}/${locale}/a/${signAct(p, env)}`;
}
