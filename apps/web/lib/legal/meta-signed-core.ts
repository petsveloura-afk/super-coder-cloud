import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta's "signed_request" (data-deletion and deauthorize callbacks of Facebook Login and Instagram Login) — pure, tested.
 * Format: base64url(HMAC-SHA256(payload, app secret)) + "." + base64url(JSON payload with algorithm "HMAC-SHA256").
 * Every app secret the platform has (Facebook app, Instagram app) is tried; an unsigned or tampered request is refused.
 */
export interface SignedPayload {
  user_id: string;
  algorithm: string;
  issued_at?: number;
  [k: string]: unknown;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function parseSignedRequest(signed: string | null | undefined, secrets: (string | null | undefined)[]): SignedPayload | null {
  const raw = String(signed ?? "").trim();
  const dot = raw.indexOf(".");
  if (dot < 10 || dot === raw.length - 1 || raw.length > 4000) return null;
  const sig = b64url(raw.slice(0, dot));
  const body = raw.slice(dot + 1);
  let payload: SignedPayload;
  try {
    payload = JSON.parse(b64url(body).toString("utf8")) as SignedPayload;
  } catch {
    return null;
  }
  if (String(payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
  if (!/^\d{3,40}$/.test(String(payload.user_id ?? ""))) return null;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = createHmac("sha256", secret).update(body).digest();
    if (expected.length === sig.length && timingSafeEqual(expected, sig)) return { ...payload, user_id: String(payload.user_id) };
  }
  return null;
}

/** a short, readable confirmation code Meta shows to the person (and they can look up on the status page) */
export function deletionCode(userId: string, now: number, rand: () => number = Math.random): string {
  const t = now.toString(36).toUpperCase().slice(-6);
  const u = Number(String(userId).slice(-6)).toString(36).toUpperCase();
  const r = Math.floor(rand() * 36 ** 4).toString(36).toUpperCase().padStart(4, "0");
  return `DEL-${t}-${u}-${r}`.slice(0, 40);
}

/** test helper (and documentation of the format): signs a payload the way Meta does */
export function signRequestForTest(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${sig}.${body}`;
}
