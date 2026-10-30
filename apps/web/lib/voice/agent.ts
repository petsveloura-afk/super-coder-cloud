import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccount } from "@/lib/channels/accounts";
import { publicEnv } from "@/lib/env";
import { runAISystem } from "@/lib/ai/run-system";
import { escalationText, isGoodbye, speakable, wantsPersonOnPhone } from "./twiml";

/**
 * Wave 16 — the AI voice agent on the business's Twilio number (the same Twilio
 * account as SMS) and urgent calls to the team. Plan feature "voice_ai".
 *  inbound   caller dials the Twilio number → /api/voice/twilio/{token} (Voice URL)
 *  outbound  "call with the agent" from a contact → Twilio calls the customer
 *  alert     handoff of a hot lead → Twilio calls the on-duty team member
 */
const twBase = () => (process.env.TWILIO_API_BASE || "https://api.twilio.com").replace(/\/$/, "");

export function voiceWebhookUrl(token: string, path = ""): string {
  return `${publicEnv.appUrl.replace(/\/$/, "")}/api/voice/twilio/${token}${path}`;
}

export async function twilioCall(sid: string, authToken: string, params: Record<string, string>): Promise<{ ok: boolean; sid?: string; error?: string }> {
  try {
    const res = await fetch(`${twBase()}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    return res.ok ? { ok: true, sid: j.sid } : { ok: false, error: j.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

interface Turn {
  role: "caller" | "agent";
  text: string;
  at: string;
}

/** Creates the call record + a "voice" conversation linked to the caller's contact. */
export async function openVoiceCall(input: { orgId: string; direction: "in" | "out"; from: string; to: string; callSid: string | null; contactId?: string | null }): Promise<{ id: string; conversationId: string | null }> {
  const admin = createAdminClient();
  const customer = input.direction === "in" ? input.from : input.to;
  let contactId = input.contactId ?? null;
  if (!contactId) {
    const { data: c } = await admin.from("contacts").select("id").eq("organization_id", input.orgId).or(`phone.eq.${customer},phone.eq.${customer.replace(/^\+972/, "0")}`).order("created_at").limit(1).maybeSingle();
    contactId = (c?.id as string | undefined) ?? null;
  }
  const { data: conv } = await admin
    .from("conversations")
    .upsert({ organization_id: input.orgId, channel: "voice", external_id: customer.slice(0, 120), contact_id: contactId, title: customer.slice(0, 160) }, { onConflict: "organization_id,channel,external_id" })
    .select("id")
    .single();
  const { data: call } = await admin
    .from("voice_calls")
    .upsert({ organization_id: input.orgId, conversation_id: conv?.id ?? null, contact_id: contactId, direction: input.direction, from_number: input.from.slice(0, 40), to_number: input.to.slice(0, 40), call_sid: input.callSid, status: "in_progress" }, { onConflict: "call_sid" })
    .select("id")
    .single();
  return { id: call?.id as string, conversationId: (conv?.id as string | undefined) ?? null };
}

async function addTurn(callId: string, conversationId: string | null, orgId: string, turn: Turn) {
  const admin = createAdminClient();
  const { data } = await admin.from("voice_calls").select("turns").eq("id", callId).maybeSingle();
  const turns = [...(((data?.turns as Turn[] | null) ?? []) as Turn[]), turn].slice(-60);
  await admin.from("voice_calls").update({ turns, updated_at: new Date().toISOString() }).eq("id", callId);
  if (conversationId) {
    await admin.from("messages").insert({
      organization_id: orgId,
      conversation_id: conversationId,
      direction: turn.role === "caller" ? "in" : "out",
      body: turn.text.slice(0, 8000),
      status: turn.role === "caller" ? "received" : "sent",
      meta: { voice: true, system: turn.role === "agent" ? "voice" : undefined },
    });
    await admin.from("conversations").update({ last_message_at: turn.at, last_message_preview: `📞 ${turn.text}`.slice(0, 200) }).eq("id", conversationId);
  }
}

/** One turn of the phone conversation: what the caller said → what the agent says. */
export async function voiceTurn(input: { orgId: string; callId: string; conversationId: string | null; callerText: string; locale: string }): Promise<{ say: string; end: boolean; transfer: boolean }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  if (input.callerText) await addTurn(input.callId, input.conversationId, input.orgId, { role: "caller", text: input.callerText, at: now });
  if (input.callerText && isGoodbye(input.callerText)) {
    const say = input.locale === "en" ? "Thank you for calling, goodbye!" : input.locale === "ar" ? "شكراً لاتصالك، مع السلامة!" : "תודה שהתקשרת, יום נעים!";
    await addTurn(input.callId, input.conversationId, input.orgId, { role: "agent", text: say, at: now });
    return { say, end: true, transfer: false };
  }
  if (input.callerText && wantsPersonOnPhone(input.callerText)) {
    const say = input.locale === "en" ? "Of course, I'm connecting you to a person from the team." : input.locale === "ar" ? "بالتأكيد، أحولك الآن إلى أحد أفراد الفريق." : "בשמחה, אני מעביר אותך עכשיו לאדם מהצוות.";
    await addTurn(input.callId, input.conversationId, input.orgId, { role: "agent", text: say, at: now });
    if (input.conversationId) await admin.rpc("ai_handoff", { p_conv: input.conversationId, p_reason: "phone_human" });
    return { say, end: true, transfer: true };
  }
  // wave 56: the full sales brain on the phone (objections, funnel state, memory, hours, real booking,
  // lead capture, anti-repetition, self-correction). The original simple turn below stays as the fallback.
  if (process.env.VOICE_BRAIN !== "basic") {
    const { phoneTurn } = await import("./phone-brain");
    const smart = await phoneTurn(input).catch((e) => {
      console.error("phone brain failed", (e as Error).message);
      return null;
    });
    if (smart) {
      await addTurn(input.callId, input.conversationId, input.orgId, { role: "agent", text: smart.say, at: new Date().toISOString() });
      if (smart.transfer && input.conversationId) await admin.rpc("ai_handoff", { p_conv: input.conversationId, p_reason: "phone_agent" });
      return { say: smart.say, end: smart.end || smart.transfer, transfer: smart.transfer };
    }
  }
  const [{ data: call }, { data: agent }, { data: org }] = await Promise.all([
    admin.from("voice_calls").select("turns").eq("id", input.callId).maybeSingle(),
    admin.from("ai_agents").select("id, name, instructions, provider, model, profile").eq("organization_id", input.orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    admin.from("organizations").select("name").eq("id", input.orgId).maybeSingle(),
  ]);
  const turns = ((call?.turns as Turn[] | null) ?? []).slice(-20);
  const p = (agent?.profile ?? {}) as Record<string, unknown>;
  const system = [
    `You are "${agent?.name ?? "Assistant"}", the phone assistant of "${org?.name ?? ""}". You are speaking on a PHONE CALL: answer in 1–3 short spoken sentences, no lists, no links, no emojis, no markdown.`,
    `Speak ${input.locale === "en" ? "English" : input.locale === "ar" ? "Arabic" : "Hebrew"} unless the caller uses another language.`,
    "Help, qualify (need, timing, budget), and when the caller is ready offer the next step (a meeting / a call back from the team). Ask for the caller's name. Never invent prices or facts.",
    `Business instructions:\n${String(agent?.instructions ?? "").slice(0, 4000)}`,
    `Business data: ${String(p.business ?? "")} | services & prices: ${String(p.services ?? "")} | hours: ${String(p.hours ?? "")} | address: ${String(p.location ?? "")}`.slice(0, 3000),
  ].join("\n\n");
  const messages = turns.map((t) => ({ role: t.role === "caller" ? ("user" as const) : ("assistant" as const), content: t.text }));
  if (!messages.length) messages.push({ role: "user", content: "(the call just started — greet the caller briefly and ask how you can help)" });
  const out = await runAISystem({ orgId: input.orgId, feature: "voice", agentId: (agent?.id as string | undefined) ?? null, system, messages, temperature: 0.4, maxTokens: 220, patienceMs: 9000 });
  const say = out.ok ? speakable(out.text.replace(/\[\[[^\]]*\]\]/g, ""), 500) : input.locale === "en" ? "Sorry, one moment please — a person from the team will call you back shortly." : input.locale === "ar" ? "عذراً — سيعاود أحد أفراد الفريق الاتصال بك قريباً." : "סליחה, נציג מהצוות יחזור אליך בהקדם.";
  await addTurn(input.callId, input.conversationId, input.orgId, { role: "agent", text: say, at: new Date().toISOString() });
  return { say, end: !out.ok, transfer: false };
}

/** "Call the customer with the AI agent" (outbound). */
export async function startAgentCall(orgId: string, contactId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { data: has } = await admin.rpc("has_feature", { p_org: orgId, p_feature: "voice_ai" });
  if (has !== true) return { ok: false, error: "plans.locked.voice_ai.title" };
  const acc = await loadAccount(orgId, "sms");
  if (!acc?.config.account_sid || !acc.secrets.auth_token || !acc.config.from_number) {
    // wave 57: no own Twilio account → the business's platform number (zero setup)
    return startPlatformAgentCall(orgId, contactId);
  }
  const { data: c } = await admin.from("contacts").select("phone").eq("id", contactId).eq("organization_id", orgId).maybeSingle();
  const { toE164 } = await import("@/lib/channels/secrets");
  const to = toE164((c?.phone as string | null) ?? null);
  if (!to) return { ok: false, error: "voice.noPhone" };
  const { checkContact } = await import("@/lib/conversations/guard");
  if (!(await checkContact(contactId, "automation")).allowed) return { ok: false, error: "guard.reasons.opted_out" };
  const call = await openVoiceCall({ orgId, direction: "out", from: acc.config.from_number, to, callSid: null, contactId });
  const r = await twilioCall(acc.config.account_sid, acc.secrets.auth_token, { To: to, From: acc.config.from_number, Url: voiceWebhookUrl(acc.webhook_token, `/turn?call=${call.id}`), Method: "POST", StatusCallback: voiceWebhookUrl(acc.webhook_token, "/status"), StatusCallbackMethod: "POST" });
  if (!r.ok) {
    await admin.from("voice_calls").update({ status: "failed" }).eq("id", call.id);
    return { ok: false, error: "voice.callFailed" };
  }
  await admin.from("voice_calls").update({ call_sid: r.sid ?? null, status: "ringing" }).eq("id", call.id);
  return { ok: true };
}

/** Urgent call to the team members who chose "urgent calls" (job "call"). */
export async function escalationCalls(orgId: string, payload: { customer?: string; reason?: string; conversation_id?: string }): Promise<{ ok: boolean; error?: string; permanent?: boolean }> {
  const admin = createAdminClient();
  const acc0 = await loadAccount(orgId, "sms");
  // wave 57: no own Twilio account → urgent calls go out from the business's platform number
  const platform = !acc0?.config.account_sid || !acc0.secrets.auth_token || !acc0.config.from_number ? await import("./platform-phone").then((m) => m.twilioCredsForOrg(orgId)) : null;
  const acc = platform ? { config: { account_sid: platform.sid, from_number: platform.from }, secrets: { auth_token: platform.token } } : acc0;
  if (!acc?.config.account_sid || !acc.secrets.auth_token || !acc.config.from_number) return { ok: false, error: "twilio_not_connected", permanent: true };
  const { data: recs } = await admin.from("notify_recipients").select("id, target").eq("organization_id", orgId).eq("kind", "call").eq("enabled", true).contains("events", ["escalation"]).not("target", "is", null).limit(3);
  if (!recs?.length) return { ok: true };
  const { data: org } = await admin.from("organizations").select("name, locale").eq("id", orgId).maybeSingle();
  const locale = (org?.locale as string | undefined) ?? "he";
  const { sayTwiml } = await import("./twiml");
  const twiml = sayTwiml(escalationText(locale, { org: (org?.name as string) ?? "", customer: payload.customer ?? "", reason: payload.reason ?? "" }), locale);
  let any = false;
  for (const r of recs as { id: string; target: string }[]) {
    const res = await twilioCall(acc.config.account_sid, acc.secrets.auth_token, { To: r.target, From: acc.config.from_number, Twiml: twiml });
    await admin.from("voice_calls").insert({ organization_id: orgId, conversation_id: payload.conversation_id ?? null, direction: "alert", from_number: acc.config.from_number, to_number: r.target, call_sid: res.sid ?? null, status: res.ok ? "queued" : "failed" });
    any = any || res.ok;
  }
  return any ? { ok: true } : { ok: false, error: "call_failed" };
}

/** Wave 57 — "call with the agent" from a business that uses a platform number (no Twilio of its own). */
async function startPlatformAgentCall(orgId: string, contactId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  const { twilioCredsForOrg, platformMinutes, platformUrls } = await import("./platform-phone");
  const cr = await twilioCredsForOrg(orgId);
  if (!cr || cr.via !== "platform") return { ok: false, error: "voice.notConnected" };
  if ((await platformMinutes(orgId)).left === 0) return { ok: false, error: "phone.minutesUsed" };
  const { data: c } = await admin.from("contacts").select("phone").eq("id", contactId).eq("organization_id", orgId).maybeSingle();
  const { toE164 } = await import("@/lib/channels/secrets");
  const to = toE164((c?.phone as string | null) ?? null);
  if (!to) return { ok: false, error: "voice.noPhone" };
  const { checkContact } = await import("@/lib/conversations/guard");
  if (!(await checkContact(contactId, "automation")).allowed) return { ok: false, error: "guard.reasons.opted_out" };
  const call = await openVoiceCall({ orgId, direction: "out", from: cr.from, to, callSid: null, contactId });
  await admin.from("voice_calls").update({ via: "platform" }).eq("id", call.id);
  const urls = platformUrls();
  const r = await twilioCall(cr.sid, cr.token, { To: to, From: cr.from, Url: urls.turn(call.id), Method: "POST", StatusCallback: urls.status, StatusCallbackMethod: "POST" });
  if (!r.ok) {
    await admin.from("voice_calls").update({ status: "failed" }).eq("id", call.id);
    return { ok: false, error: "voice.callFailed" };
  }
  await admin.from("voice_calls").update({ call_sid: r.sid ?? null, status: "ringing" }).eq("id", call.id);
  return { ok: true };
}
