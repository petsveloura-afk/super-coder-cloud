"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getOrgContext } from "@/lib/auth";
import { encryptionReady } from "@/lib/channels/secrets";
import { formLocale, str } from "@/lib/form";
import type { ActionState } from "@/lib/action-state";

/**
 * Wave 17 — "Ad conversions": the business connects its own Meta Pixel (Conversions API),
 * Google Analytics 4 (Measurement Protocol) and TikTok Pixel (Events API). Secrets are
 * encrypted; "Send a test event" verifies the connection.
 */
const schema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("meta_capi"), pixel_id: z.string().regex(/^\d{5,20}$/), secret: z.string().max(600), test_code: z.string().max(40).optional() }),
  z.object({ provider: z.literal("ga4"), measurement_id: z.string().regex(/^G-[A-Z0-9]{4,20}$/), secret: z.string().max(200), test_code: z.string().max(40).optional() }),
  z.object({ provider: z.literal("tiktok"), pixel_code: z.string().regex(/^[A-Za-z0-9]{8,40}$/), secret: z.string().max(600), test_code: z.string().max(40).optional() }),
]);
const EVENTS = ["Lead", "Schedule", "Purchase"] as const;

export async function saveConversionsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const provider = str(fd, "provider");
  const { loadIntegration, removeIntegration, saveIntegration } = await import("@/lib/integrations/store");
  if (str(fd, "disconnect") === "on" && ["meta_capi", "ga4", "tiktok"].includes(provider)) {
    await removeIntegration(ctx.org.id, provider);
    revalidatePath(`/${locale}/integrations`);
    return { ok: true, message: "conversions.disconnected" };
  }
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "conversion_api"))) return { error: "plans.locked.conversion_api.title" };
  const parsed = schema.safeParse({
    provider,
    pixel_id: str(fd, "pixel_id") || undefined,
    measurement_id: str(fd, "measurement_id").toUpperCase() || undefined,
    pixel_code: str(fd, "pixel_code").toUpperCase() || undefined,
    secret: str(fd, "secret"),
    test_code: str(fd, "test_code") || undefined,
  });
  if (!parsed.success) return { error: "conversions.invalid", fieldErrors: { id: "conversions.badId" } };
  if (!encryptionReady()) return { error: "integrations.channels.encryptionMissing" };
  const v = parsed.data;
  const current = await loadIntegration(ctx.org.id, v.provider);
  const secretKey = v.provider === "ga4" ? "api_secret" : "access_token";
  const secret = v.secret || current?.secrets[secretKey] || "";
  if (!secret) return { fieldErrors: { secret: "validation.required" } };
  const events = EVENTS.filter((e) => fd.get(`ev_${e}`) === "on");
  const config: Record<string, unknown> = {
    ...(v.provider === "meta_capi" ? { pixel_id: v.pixel_id } : v.provider === "ga4" ? { measurement_id: v.measurement_id } : { pixel_code: v.pixel_code }),
    test_code: v.test_code ?? null,
    events: events.length ? events : [...EVENTS],
    require_consent: fd.get("require_consent") === "on",
  };
  await saveIntegration(ctx.org.id, v.provider, config, { [secretKey]: secret });
  revalidatePath(`/${locale}/integrations`);
  return { ok: true, message: "conversions.saved" };
}

/** Sends one test "Lead" event (with the test code when set) and reports the platform's answer. */
export async function testConversionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = formLocale(fd);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage")) return { error: "errors.forbidden" };
  const provider = str(fd, "provider");
  if (!["meta_capi", "ga4", "tiktok"].includes(provider)) return { error: "conversions.invalid" };
  const { loadIntegration, markIntegration } = await import("@/lib/integrations/store");
  const integ = await loadIntegration(ctx.org.id, provider);
  if (!integ) return { error: "conversions.notConnected" };
  const { sendConversionTo } = await import("@/lib/marketing/conversions");
  const r = await sendConversionTo(provider as "meta_capi" | "ga4" | "tiktok", integ.config, integ.secrets, {
    event: "Lead",
    ref: `test-${Date.now()}`,
    at: new Date().toISOString(),
    email: ctx.email || null,
    contactId: ctx.userId,
  });
  await markIntegration(integ.id, r.ok, r.error ?? null);
  revalidatePath(`/${locale}/integrations`);
  return r.ok ? { ok: true, message: "conversions.testOk" } : { error: "conversions.testFailed", messageParams: { error: (r.error ?? String(r.status)).slice(0, 120) } };
}
