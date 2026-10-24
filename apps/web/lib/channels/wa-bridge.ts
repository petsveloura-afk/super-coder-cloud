import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { publicEnv } from "@/lib/env";
import type { LoadedAccount } from "./accounts";
import type { ProviderResult } from "./providers";

/**
 * WhatsApp by QR code ("WhatsApp Web" style) through the separate
 * `apps/wa-bridge` service (must run continuously — e.g. on Railway).
 * Unofficial: WhatsApp may block numbers that use it; the UI says so clearly.
 *
 * Env (server): WA_BRIDGE_URL (https://…), WA_BRIDGE_SECRET (shared secret, ≥ 24 chars).
 */

export function bridgeConfigured(): boolean {
  return /^https?:\/\/\S+$/.test(process.env.WA_BRIDGE_URL ?? "") && (process.env.WA_BRIDGE_SECRET ?? "").length >= 24;
}

const base = () => (process.env.WA_BRIDGE_URL ?? "").replace(/\/$/, "");

export interface BridgeStatus {
  status: "starting" | "qr" | "connected" | "logged_out" | "error" | "unknown" | "code";
  qr?: string | null; // data:image/png;base64,…
  /** wave 20: "link with phone number" — the 8-character code to type in WhatsApp ("ABCD-1234") */
  code?: string | null;
  phone?: string | null;
  name?: string | null;
  error?: string | null;
}

async function call(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  if (!bridgeConfigured()) return { ok: false, status: 503, data: { error: "bridge_not_configured" } };
  try {
    const res = await fetch(`${base()}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${process.env.WA_BRIDGE_SECRET}`, "Content-Type": "application/json" },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: (e as Error).message } };
  }
}

/** Shared signed call to the bridge service (also used by the personal-Telegram channel). */
export async function bridgeCall(path: string, init: { method: "GET" | "POST"; body?: unknown }) {
  return call(path, init);
}

export function bridgeCallbackUrl(token: string) {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/whatsapp_qr/${token}`;
}

export async function bridgeStart(accountId: string, token: string): Promise<BridgeStatus> {
  const r = await call(`/sessions/${accountId}/start`, { method: "POST", body: { callback: bridgeCallbackUrl(token) } });
  if (!r.ok) return { status: "error", error: String(r.data.error ?? `bridge_${r.status}`) };
  return r.data as unknown as BridgeStatus;
}

/** wave 20 — link with phone number: the bridge asks WhatsApp for an 8-character code for this phone. */
export async function bridgePair(accountId: string, token: string, phone: string): Promise<BridgeStatus> {
  const r = await call(`/sessions/${accountId}/pair`, { method: "POST", body: { callback: bridgeCallbackUrl(token), phone } });
  if (!r.ok) return { status: "error", error: String(r.data.error ?? `bridge_${r.status}`) };
  return r.data as unknown as BridgeStatus;
}

export async function bridgeStatus(accountId: string): Promise<BridgeStatus> {
  const r = await call(`/sessions/${accountId}`, { method: "GET" });
  if (r.status === 404) return { status: "unknown" };
  if (!r.ok) return { status: "error", error: String(r.data.error ?? `bridge_${r.status}`) };
  return r.data as unknown as BridgeStatus;
}

export async function bridgeLogout(accountId: string): Promise<void> {
  await call(`/sessions/${accountId}/logout`, { method: "POST" });
}

export async function bridgeSend(acc: LoadedAccount, externalId: string, text: string): Promise<ProviderResult> {
  const r = await call(`/sessions/${acc.id}/send`, { method: "POST", body: { to: externalId.replace(/[^\d]/g, ""), text } });
  if (!r.ok) return { ok: false, status: r.status, error: String(r.data.error ?? `bridge_${r.status}`), permanent: r.status === 404 || r.status === 409 };
  return { ok: true, externalId: (r.data.id as string | undefined) ?? undefined };
}

/** Verifies the bridge's signed callback: X-SCC-Timestamp + X-SCC-Signature = hex(HMAC-SHA256(secret, ts + "." + body)). */
export function verifyBridgeSignature(rawBody: string, timestamp: string | null, signature: string | null, now = Date.now()): boolean {
  const secret = process.env.WA_BRIDGE_SECRET ?? "";
  if (secret.length < 24 || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.replace(/^sha256=/, ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
