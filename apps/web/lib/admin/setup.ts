import "server-only";

/** Wave 20 — live checks for the setup wizard (admin only): is the bridge up, are the Meta keys real. */
export interface LiveChecks {
  bridge: { ok: boolean; sessions?: number; error?: string } | null;
  meta: { ok: boolean; name?: string; error?: string } | null;
}

export async function runLiveChecks(): Promise<LiveChecks> {
  const out: LiveChecks = { bridge: null, meta: null };
  const bridgeUrl = (process.env.WA_BRIDGE_URL ?? "").replace(/\/$/, "");
  const tasks: Promise<void>[] = [];
  if (/^https?:\/\/\S+$/.test(bridgeUrl)) {
    tasks.push(
      fetch(`${bridgeUrl}/health`, { signal: AbortSignal.timeout(6000), cache: "no-store" })
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { ok?: boolean; sessions?: number };
          out.bridge = r.ok && j.ok ? { ok: true, sessions: j.sessions ?? 0 } : { ok: false, error: `HTTP ${r.status}` };
        })
        .catch((e: Error) => {
          out.bridge = { ok: false, error: e.name === "TimeoutError" ? "timeout" : "unreachable" };
        }),
    );
  }
  const appId = process.env.META_APP_ID ?? "";
  const secret = process.env.META_APP_SECRET ?? "";
  if (/^\d{5,20}$/.test(appId) && secret.length >= 16) {
    const { graphVersion } = await import("@/lib/channels/meta");
    const graph = (process.env.META_GRAPH_BASE || `https://graph.facebook.com/${graphVersion()}`).replace(/\/$/, "");
    tasks.push(
      fetch(`${graph}/${appId}?fields=name&access_token=${encodeURIComponent(`${appId}|${secret}`)}`, { signal: AbortSignal.timeout(8000), cache: "no-store" })
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { name?: string; error?: { message?: string } };
          out.meta = r.ok && j.name ? { ok: true, name: j.name } : { ok: false, error: j.error?.message?.slice(0, 160) ?? `HTTP ${r.status}` };
        })
        .catch(() => {
          out.meta = { ok: false, error: "unreachable" };
        }),
    );
  }
  await Promise.all(tasks);
  return out;
}
