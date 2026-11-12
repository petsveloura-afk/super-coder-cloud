/**
 * The app moved (Vercel → Railway, a new domain): phone numbers that the platform wired to its OLD address keep calling a dead
 * link, so calls and SMS to the business are lost. This decides — purely — whether a Twilio number must be re-pointed.
 *
 * A number is re-pointed ONLY when its current Voice URL is one the platform itself wrote (it contains our own path, e.g.
 * "/api/voice/platform" or "/api/voice/twilio/{token}") on a different address. A number the business pointed somewhere else
 * on purpose (its own IVR, another system) is never touched.
 */

export function isPublicHttpsBase(base: string): boolean {
  return /^https:\/\/[^\s/]+$/.test(base) && !/localhost|127\.0\.0\.1|0\.0\.0\.0|\.internal\b/.test(base);
}

export function twilioNeedsRepoint(currentVoiceUrl: string | null | undefined, expectedVoiceUrl: string, ourPath: string): boolean {
  const cur = String(currentVoiceUrl ?? "").trim();
  if (!cur || !expectedVoiceUrl || !ourPath) return false;
  if (cur === expectedVoiceUrl) return false;
  let path: string;
  try {
    path = new URL(cur).pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
  // ours = exactly our path (the address in front of it is the old one)
  return path === ourPath.replace(/\/$/, "");
}

/** at most once per interval per server process (the Twilio API is not called on every clock tick) */
export function healDue(lastAt: number | undefined, now: number, everyMs = 6 * 3600_000): boolean {
  return !lastAt || now - lastAt >= everyMs;
}
