import "server-only";
import { publicEnv } from "@/lib/env";
import type { LoadedAccount } from "./accounts";
import type { ProviderResult } from "./providers";
import { bridgeCall, bridgeConfigured } from "./wa-bridge";

/**
 * Telegram by PERSONAL account (MTProto) through the bridge service — next to
 * the Telegram bot. The business scans a QR code in Telegram (Settings →
 * Devices → Link Desktop Device); the AI agent answers from the account itself.
 * Bridge env: TELEGRAM_API_ID + TELEGRAM_API_HASH (my.telegram.org).
 */

export interface TgUserStatus {
  status: "starting" | "qr" | "password" | "connected" | "error" | "unknown" | "not_configured";
  qr?: string | null;
  hint?: string | null;
  phone?: string | null;
  name?: string | null;
  username?: string | null;
  error?: string | null;
}

export const tgUserConfigured = bridgeConfigured;

export function tgUserCallbackUrl(token: string) {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/api/channels/telegram_user/${token}`;
}

export async function tgUserStart(accountId: string, token: string): Promise<TgUserStatus> {
  const r = await bridgeCall(`/tg/sessions/${accountId}/start`, { method: "POST", body: { callback: tgUserCallbackUrl(token) } });
  if (r.status === 503) return { status: "not_configured" };
  if (!r.ok) return { status: "error", error: String(r.data.error ?? `bridge_${r.status}`) };
  return r.data as unknown as TgUserStatus;
}

export async function tgUserStatus(accountId: string): Promise<TgUserStatus> {
  const r = await bridgeCall(`/tg/sessions/${accountId}`, { method: "GET" });
  if (r.status === 404) return { status: "unknown" };
  if (r.status === 503) return { status: "not_configured" };
  if (!r.ok) return { status: "error", error: String(r.data.error ?? `bridge_${r.status}`) };
  return r.data as unknown as TgUserStatus;
}

export async function tgUserPassword(accountId: string, password: string): Promise<TgUserStatus> {
  const r = await bridgeCall(`/tg/sessions/${accountId}/password`, { method: "POST", body: { password } });
  if (!r.ok) return { status: "error", error: String(r.data.error ?? `bridge_${r.status}`) };
  return r.data as unknown as TgUserStatus;
}

export async function tgUserLogout(accountId: string): Promise<void> {
  await bridgeCall(`/tg/sessions/${accountId}/logout`, { method: "POST" });
}

export async function tgUserSend(acc: LoadedAccount, externalId: string, text: string): Promise<ProviderResult> {
  const r = await bridgeCall(`/tg/sessions/${acc.id}/send`, { method: "POST", body: { to: externalId.replace(/[^\d]/g, ""), text } });
  if (!r.ok) return { ok: false, status: r.status, error: String(r.data.error ?? `bridge_${r.status}`), permanent: r.status === 404 || r.status === 409 };
  return { ok: true, externalId: (r.data.id as string | undefined) ?? undefined };
}
