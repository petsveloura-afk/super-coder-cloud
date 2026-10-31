import "server-only";
import { randomInt } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LoadedAccount } from "./accounts";

/**
 * Wave 60 — the official WhatsApp number heals itself.
 *
 * Meta answers "(#133010) Account not registered" when the business number was connected but never finished
 * its Cloud API registration (the step can fail silently at connect time, e.g. when the number already has a
 * two-step PIN). Customers' messages then never arrive and the agent cannot answer. Now:
 *   • the first failed send registers the number automatically (with the saved PIN, or a fresh one) and retries;
 *   • if Meta needs the owner's existing two-step PIN, the account is marked with a clear reason and the
 *     integrations screen asks for the 6 digits once (registerWhatsAppAction).
 * Never throws.
 */
export function isNotRegistered(error: string | null | undefined): boolean {
  return /133010|account not registered|not registered|wa_not_registered/i.test(error ?? "");
}

export function needsPin(error: string | null | undefined): boolean {
  return /133005|133006|pin|two.?step/i.test(error ?? "");
}

const graph = () => (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, ""); // same base as sending

export async function registerNumber(token: string, phoneNumberId: string, pin: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${graph()}/${encodeURIComponent(phoneNumberId)}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; code?: number } };
    if (res.ok && j.success !== false) return { ok: true };
    return { ok: false, error: `${j.error?.code ? `(#${j.error.code}) ` : ""}${j.error?.message ?? `HTTP ${res.status}`}`.slice(0, 300) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Registers the account's number (saved PIN first, else a new one that is then saved). */
export async function ensureRegistered(acc: LoadedAccount, ownerPin?: string | null): Promise<{ ok: boolean; error?: string }> {
  const token = acc.secrets.access_token ?? "";
  const phoneId = acc.config.phone_number_id ?? "";
  if (!token || !phoneId) return { ok: false, error: "whatsapp_not_connected" };
  const pin = /^\d{6}$/.test(ownerPin ?? "") ? (ownerPin as string) : /^\d{6}$/.test(acc.secrets.wa_pin ?? "") ? acc.secrets.wa_pin! : String(randomInt(100000, 999999));
  const r = await registerNumber(token, phoneId, pin);
  const admin = createAdminClient();
  if (r.ok) {
    try {
      const { sealSecrets } = await import("./secrets");
      await admin.from("channel_accounts").update({ secret_enc: sealSecrets({ ...acc.secrets, wa_pin: pin }), status: "active", last_error: null, updated_at: new Date().toISOString() }).eq("id", acc.id);
    } catch {
      await admin.from("channel_accounts").update({ status: "active", last_error: null }).eq("id", acc.id);
    }
    return { ok: true };
  }
  await admin
    .from("channel_accounts")
    .update({ status: "error", last_error: `wa_not_registered: ${r.error ?? ""}`.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", acc.id)
    .then(() => undefined, () => undefined);
  return r;
}

// wave 61: plain-language reasons (pure helpers live in wa-register-core)
export { explainRegisterError } from "./wa-register-core";
