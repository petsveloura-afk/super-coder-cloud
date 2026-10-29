/**
 * Wave 52 — personal profile, pure logic (unit-tested): completeness, avatar upload rules, field cleaning.
 */

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function avatarCheck(input: { type: string; size: number }): { ok: true; ext: string } | { ok: false; error: "type" | "size" } {
  const ext = AVATAR_EXT[(input.type ?? "").toLowerCase()];
  if (!ext) return { ok: false, error: "type" };
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > AVATAR_MAX_BYTES) return { ok: false, error: "size" };
  return { ok: true, ext };
}

/** The avatar URL must point at this user's own folder in the public avatars bucket. */
export function isOwnAvatarUrl(url: string, userId: string, supabaseUrl: string): boolean {
  const base = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/avatars/${userId}/`;
  return url.startsWith(base) && url.length <= 1000 && !/\.\.|[\s"'<>]/.test(url.slice(base.length));
}

export interface ProfileLike {
  full_name?: string | null;
  avatar_url?: string | null;
  job_title?: string | null;
  phone?: string | null;
  bio?: string | null;
}

/** Profile completeness 0-100 and which items are missing (i18n keys under settings.pro.missing.*). */
export function profileCompleteness(p: ProfileLike): { pct: number; missing: ("name" | "avatar" | "jobTitle" | "phone" | "bio")[] } {
  const checks: ["name" | "avatar" | "jobTitle" | "phone" | "bio", boolean][] = [
    ["name", (p.full_name ?? "").trim().length >= 2],
    ["avatar", Boolean(p.avatar_url)],
    ["jobTitle", Boolean((p.job_title ?? "").trim())],
    ["phone", Boolean((p.phone ?? "").trim())],
    ["bio", Boolean((p.bio ?? "").trim())],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { pct: Math.round((done / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([k]) => k) };
}

/** Light phone cleaning: keeps digits, +, spaces and dashes; bounded. */
export function cleanPhone(raw: string | null | undefined): string | null {
  const v = (raw ?? "").replace(/[^\d+\s()-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return (v.match(/\d/g) ?? []).length >= 7 ? v : v ? null : null;
}
