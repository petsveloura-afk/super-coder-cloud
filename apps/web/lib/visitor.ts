import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * Privacy-preserving visitor key for rate limiting public endpoints: a daily
 * salted SHA-256 of the client IP (the IP itself is never stored).
 */
export async function visitorHash(): Promise<string> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const salt = process.env.CRON_SECRET ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "scc";
  return createHash("sha256").update(`${salt}:${day}:${ip}`).digest("hex").slice(0, 32);
}
