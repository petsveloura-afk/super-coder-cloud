/**
 * Embedded Signup — the popup's FINISH message (phone_number_id + waba_id) can arrive a moment
 * after FB.login's callback, or not at all in some flows (e.g. Coexistence). Wait for it, but never
 * longer than `ms`; the server then looks the ids up from the token itself.
 *
 * wave 26 (diagnostics): every message that comes from a facebook.com window is summarised here
 * (host + type/event only, never the payload) and handed to the server in a short-lived cookie, so a failed
 * connection can say what the popup really sent and how old the code was.
 */
type Seen = { at: number; s: string };
const seen: Seen[] = [];

if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    try {
      const host = new URL(event.origin).hostname;
      if (!/(^|\.)facebook\.com$/.test(host)) return;
      let data: unknown = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          data = null;
        }
      }
      const d = (data ?? {}) as { type?: unknown; event?: unknown };
      const s = `${host.replace(/\.facebook\.com$/, "")}:${typeof d.type === "string" ? d.type.slice(0, 20) : typeof event.data}/${typeof d.event === "string" ? d.event.slice(0, 24) : "-"}`;
      seen.push({ at: Date.now(), s });
      if (seen.length > 8) seen.shift();
    } catch {
      /* ignore */
    }
  });
}

function writeDebugCookie(waitedMs: number, found: boolean) {
  try {
    const now = Date.now();
    const msgs = seen.map((m) => `${m.s}@${Math.round((now - m.at) / 1000)}s`).join("|") || "none";
    const v = `t=${now};w=${waitedMs};f=${found ? 1 : 0};m=${msgs}`.slice(0, 300);
    document.cookie = `wa_dbg=${encodeURIComponent(v)}; path=/; max-age=120; SameSite=Lax; Secure`;
  } catch {
    /* ignore */
  }
}

export async function waitForSignup(ref: { current: { phone_number_id?: string; waba_id?: string } }, ms = 1200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (ref.current.phone_number_id && ref.current.waba_id) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  writeDebugCookie(Date.now() - start, Boolean(ref.current.phone_number_id && ref.current.waba_id));
}
