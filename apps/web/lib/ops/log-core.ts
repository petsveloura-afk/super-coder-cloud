/**
 * Structured logging core (pure, unit-tested): JSON lines with request / org context and automatic redaction of
 * personal data and secrets — e-mails, phone numbers, tokens, API keys, passwords and card-like numbers never
 * reach the logs. Used by lib/ops/log.ts (server) and the error reporter.
 */

const SECRET_KEYS = /pass(word)?|secret|token|api[_-]?key|authorization|cookie|session|private|signature|pin|otp|card|iban|cvv/i;

export function redactText(s: string): string {
  return String(s ?? "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [secret]")
    .replace(/\b(sk|pk|rk|whsec|xox[abp]|ghp|gho|AIza|EAA)[A-Za-z0-9_-]{10,}\b/g, "[secret]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[number]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]");
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[deep]";
  if (value == null) return value;
  if (typeof value === "string") return redactText(value).slice(0, 2000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, message: redactText(value.message).slice(0, 1000) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 60)) out[k] = SECRET_KEYS.test(k) ? "[secret]" : redact(v, depth + 1);
    return out;
  }
  return String(value);
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function logLine(level: LogLevel, msg: string, ctx: Record<string, unknown> = {}, now = new Date()): string {
  return JSON.stringify({ t: now.toISOString(), level, msg: redactText(msg).slice(0, 500), ...(redact(ctx) as Record<string, unknown>) });
}

/** Groups the same error together: message without ids / numbers + route. */
export function fingerprint(source: string, message: string, route?: string | null): string {
  const norm = redactText(String(message ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#id"))
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  const r = (route ?? "").replace(/\/(he|en|ar)(?=\/|$)/, "/:l").replace(/[0-9a-f-]{20,}/g, ":id").slice(0, 120);
  let h = 2166136261;
  for (const c of `${source}|${r}|${norm}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `${source}:${(h >>> 0).toString(36)}`;
}

/** A short id to show the user ("event id") and find the error later. */
export function eventId(digest?: string | null): string {
  if (digest) return digest.slice(0, 12);
  return Math.random().toString(36).slice(2, 10);
}
