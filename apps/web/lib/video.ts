/**
 * Wave 16 — video calls without installing anything: a private, hard-to-guess
 * meeting room. Jitsi Meet by default (free); VIDEO_MEET_BASE can point at any
 * room-per-URL service (self-hosted Jitsi, Whereby room prefix, …).
 */
export function videoRoomUrl(orgSlug: string, random: string, env: Record<string, string | undefined> = process.env): string {
  const base = (env.VIDEO_MEET_BASE || "https://meet.jit.si").replace(/\/$/, "");
  const slug = orgSlug.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || "meet";
  const room = `${slug}-${random.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}`;
  return `${base}/${room}`;
}
