import "server-only";
import { fingerprint, logLine, redactText, type LogLevel } from "./log-core";

/**
 * Server logger: one JSON line per event (visible in Vercel logs), PII and secrets redacted. Errors are also
 * stored, grouped, in app_errors (Mission Control → errors) — free, no external service. When SENTRY_DSN is
 * set, errors are additionally sent to Sentry's ingest API (optional; Sentry has a free plan).
 */
function emit(level: LogLevel, msg: string, ctx?: Record<string, unknown>) {
  const line = logLine(level, msg, ctx);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, ctx?: Record<string, unknown>) => (process.env.LOG_DEBUG === "1" ? emit("debug", msg, ctx) : undefined),
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};

/** Records an error (grouped) — never throws, never blocks the caller for long. */
export async function captureError(err: unknown, ctx: { source?: "server" | "client" | "job"; route?: string | null; digest?: string | null; orgId?: string | null } = {}): Promise<void> {
  const message = redactText(err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "error")).slice(0, 1000);
  const source = ctx.source ?? "server";
  emit("error", message, { source, route: ctx.route ?? null, digest: ctx.digest ?? null, org: ctx.orgId ?? null });
  try {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      await createAdminClient().rpc("record_app_error", {
        p_fingerprint: fingerprint(source, message, ctx.route),
        p_source: source,
        p_route: ctx.route ?? null,
        p_message: message,
        p_digest: ctx.digest ?? null,
        p_org: ctx.orgId ?? null,
      });
    }
  } catch {
    /* logging must never break the app */
  }
  await sendToSentry(message, ctx).catch(() => undefined);
}

/** Optional: Sentry store endpoint over plain fetch (no SDK, no build change). */
async function sendToSentry(message: string, ctx: { source?: string; route?: string | null; digest?: string | null }) {
  const dsn = process.env.SENTRY_DSN ?? "";
  const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!m) return;
  const [, key, host, project] = m;
  await fetch(`https://${host}/api/${project}/store/?sentry_version=7&sentry_key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      level: "error",
      platform: "javascript",
      environment: process.env.VERCEL_ENV ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? "production",
      release: (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA)?.slice(0, 7),
      tags: { source: ctx.source ?? "server", route: ctx.route ?? "" },
      extra: { digest: ctx.digest ?? null },
    }),
    signal: AbortSignal.timeout(3000),
  });
}
