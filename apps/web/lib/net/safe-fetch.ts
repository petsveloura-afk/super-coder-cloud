import "server-only";
import { assertPublicHttpsUrl } from "./safe-url";

/**
 * Wave A1 — fetch a user-supplied https URL and follow redirects SAFELY.
 *
 * `assertPublicHttpsUrl` checks one URL. A site that answers "302 → https://169.254.169.254/…" (or any other private host) would
 * be followed by `redirect: "follow"` without a second check. Here every hop is resolved manually and passes the same guard
 * (https only, default port, host resolves to public addresses only). At most `maxRedirects` hops (default 4).
 *
 * Throws the same error codes as `assertPublicHttpsUrl` (invalid_url, https_required, host_not_allowed, …) plus
 * "too_many_redirects". The caller keeps its own timeout / size limits.
 */
export async function fetchPublicHttps(raw: string, init: Omit<RequestInit, "redirect"> = {}, opts: { maxRedirects?: number } = {}): Promise<Response> {
  const max = Math.max(0, Math.min(10, opts.maxRedirects ?? 4));
  let current = await assertPublicHttpsUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(current, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= max) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error("too_many_redirects");
    }
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      await res.body?.cancel().catch(() => undefined);
      throw new Error("invalid_url");
    }
    await res.body?.cancel().catch(() => undefined);
    current = await assertPublicHttpsUrl(next.toString());
  }
}
