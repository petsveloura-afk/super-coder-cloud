import type { Metadata } from "next";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { PhoneCenter, type PhoneCenterView } from "@/components/phone/phone-center";
import { PhoneAutomations } from "@/components/phone/phone-automations";
import { MinutePacks } from "@/components/phone/minute-packs";
import { FeatureLock } from "@/components/billing/feature-gate";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { featureAccess } from "@/lib/billing/features";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("phone.title") };
}

/**
 * Wave 57 — the phone agent in one place: what is ready, the one thing left to do, a phone number in one
 * click (or the business's own Twilio number wired automatically), the transfer number, a test call to
 * your own phone, and the latest calls with their AI summaries.
 */
export default async function PhonePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const { t } = await getT(locale);
  if (!ctx.can("ai.use")) {
    return (
      <Card>
        <EmptyState title={t("errors.forbidden")} />
      </Card>
    );
  }
  const access = await featureAccess(ctx.org.id, "voice_ai");
  if (!access.allowed) {
    return (
      <>
        <PageHeader title={t("phone.title")} description={t("phone.subtitle")} />
        <FeatureLock locale={locale} feature="voice_ai" plan="business" access={{ ...access, trialAvailable: false }} canTrial={false} />
      </>
    );
  }
  const supabase = await createClient();
  const [{ data: agent }, { data: transfer }, callsRes] = await Promise.all([
    supabase.from("ai_agents").select("id, name").eq("organization_id", ctx.org.id).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    supabase.from("notify_recipients").select("target").eq("organization_id", ctx.org.id).eq("kind", "call").eq("enabled", true).is("user_id", null).not("target", "is", null).order("created_at").limit(1).maybeSingle(),
    supabase.from("voice_calls").select("id, direction, from_number, to_number, status, duration_sec, summary, mode, created_at").eq("organization_id", ctx.org.id).neq("direction", "alert").order("created_at", { ascending: false }).limit(8),
  ]);
  const [{ phoneTtsReady, phoneVoice }, { platformPhoneReady, orgPhoneNumber, platformMinutes }, { realtimeVoiceReady }, { hasPersona }, { displayPhone }] = await Promise.all([
    import("@/lib/voice/phone-tts"),
    import("@/lib/voice/platform-phone"),
    import("@/lib/voice/realtime"),
    import("@/lib/ai/voice-persona-core"),
    import("@/lib/voice/platform-phone-core"),
  ]);
  let own: string | null = null;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { loadAccount } = await import("@/lib/channels/accounts");
    const acc = await loadAccount(ctx.org.id, "sms").catch(() => null);
    own = acc?.config.from_number && acc.config.account_sid ? acc.config.from_number : null;
  }
  const platformNumber = own ? null : await orgPhoneNumber(ctx.org.id);
  const minutes = platformNumber ? await platformMinutes(ctx.org.id) : null;
  const persona = agent ? hasPersona(await phoneVoice(ctx.org.id)) : false;
  // wave 59: recordings + call purpose (separate query: never breaks the page before the migration ran)
  const callIds = ((callsRes.error ? [] : callsRes.data) ?? []).map((c) => c.id as string);
  const { data: extraRows } = callIds.length ? await supabase.from("voice_calls").select("id, recording_url, purpose").in("id", callIds) : { data: null };
  const extra = new Map(((extraRows ?? []) as { id: string; recording_url: string | null; purpose: string | null }[]).map((r) => [r.id, r]));
  const { data: settingsRow, error: settingsErr } = await supabase.from("phone_settings").select("missed_text, missed_message, record_calls, reminder_calls, callback_calls").eq("organization_id", ctx.org.id).maybeSingle();
  const { PHONE_DEFAULTS } = await import("@/lib/voice/phone-settings");
  const { minutePacks } = await import("@/lib/billing/packs-core");
  const { paypalConfigured } = await import("@/lib/billing/paypal");
  const { cryptoConfigured } = await import("@/lib/billing/nowpayments");
  const view: PhoneCenterView = {
    agent: agent ? { id: agent.id as string, name: (agent.name as string) ?? "" } : null,
    voiceReady: phoneTtsReady(),
    persona,
    live: await realtimeVoiceReady(),
    own: own ? displayPhone(own) : null,
    ownRaw: own,
    platformReady: platformPhoneReady(),
    platformNumber: platformNumber ? displayPhone(platformNumber.phone_number) : null,
    minutes,
    transfer: (transfer?.target as string | undefined) ?? null,
    canManage: ctx.can("ai.manage"),
    canIntegrations: ctx.can("integrations.manage"),
    calls: ((callsRes.error ? [] : callsRes.data) ?? []).map((c) => ({
      id: c.id as string,
      direction: c.direction as "in" | "out",
      other: displayPhone(String((c.direction === "in" ? c.from_number : c.to_number) ?? "")),
      status: String(c.status ?? ""),
      duration: (c.duration_sec as number | null) ?? null,
      summary: (c.summary as string | null) ?? null,
      live: c.mode === "realtime",
      at: c.created_at as string,
      recording: Boolean(extra.get(c.id as string)?.recording_url),
      purpose: extra.get(c.id as string)?.purpose ?? null,
    })),
  };
  return (
    <>
      <PageHeader title={t("phone.title")} description={t("phone.subtitle")} />
      <PhoneCenter view={view} />
      {/* wave 59: missed-call text-back, reminder / follow-up calls, recordings + minute packs */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card id="automations">
          <CardHeader title={t("phone.auto.title")} description={t("phone.auto.subtitle")} />
          <PhoneAutomations value={{ ...PHONE_DEFAULTS, ...((settingsRow ?? {}) as object) }} canManage={ctx.can("ai.manage")} ready={!settingsErr} />
        </Card>
        {platformNumber ? (
          <Card id="minutes">
            <CardHeader title={t("phone.packs.title")} description={t("phone.packs.subtitle")} />
            <MinutePacks packs={minutePacks()} balance={minutes?.packs ?? 0} canBuy={ctx.can("billing.manage") && !ctx.org.is_demo} methods={{ paypal: paypalConfigured(), crypto: cryptoConfigured() }} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
