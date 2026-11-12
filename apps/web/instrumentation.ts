/**
 * Server-side error capture for every route, server action and page (Next.js onRequestError hook).
 * Errors are logged as redacted JSON and grouped in app_errors (Mission Control). Free, no external service.
 */
export async function register() {
  // always-on servers (Railway, Docker): the built-in background clock — see lib/ops/self-clock-core.ts.
  // Off on Vercel, during builds and with SELF_CLOCK=off; it never throws.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startSelfClock } = await import("@/lib/ops/self-clock");
    startSelfClock();
  } catch (e) {
    console.warn("self-clock: not started", (e as Error).message);
  }
}

export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routePath?: string; routeType?: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { captureError } = await import("@/lib/ops/log");
    const digest = (err as { digest?: string } | null)?.digest ?? null;
    await captureError(err, { source: "server", route: context.routePath ?? request.path, digest });
  } catch {
    /* never throw from the error hook */
  }
}
