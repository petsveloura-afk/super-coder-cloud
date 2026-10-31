import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAISystem } from "@/lib/ai/run-system";
import { proBrief, type HistoryMsg } from "@/lib/ai/brain-pro";
import { agentActionsInstructions, memoryBlock, parseActionMarkers } from "@/lib/ai/agent-actions-core";
import { parseAgentTools } from "@/lib/ai/autopilot-core";
import { scheduleInstructions } from "@/lib/ai/schedule";
import { salesStateBrief, nextSalesState } from "@/lib/ai/sales-state-core";
import { wallTimeToUtc, matchOption } from "@/lib/operator/operator-core";
import { dropRepeats, isCorrection, isRepeatReply, phoneLang, phoneSystemPrompt, spokenTurn, spokenWhen, summaryPrompt, type PhoneLang } from "./phone-brain-core";

/**
 * Wave 56 — the phone agent gets the FULL sales brain of the chat agent:
 *   objections playbook + stage guide (brain pro), the persisted sales funnel state, long-term customer
 *   memory, opening hours, the action tools (remember, tag, task, real booking in the calendar read back
 *   to the caller), lead capture into the CRM, anti-repetition and no-ego self-correction, and a
 *   call summary for the CRM when the call ends.
 * Returns null when it cannot answer (the caller falls back to the original wave-16 phone turn).
 */

export interface PhoneTurnTurn {
  role: "caller" | "agent";
  text: string;
  at: string;
}

export interface PhoneTurnResult {
  say: string;
  end: boolean;
  transfer: boolean;
}

interface CallRow {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  direction: "in" | "out" | "alert";
  from_number: string | null;
  to_number: string | null;
  turns: PhoneTurnTurn[] | null;
}

async function bookOnPhone(input: { orgId: string; local: string; service: string | null; name: string; phone: string; email: string; lang: PhoneLang; callId: string }): Promise<{ say: string; ok: boolean }> {
  const admin = createAdminClient();
  const { data: types } = await admin.from("appointment_types").select("slug, name, timezone").eq("organization_id", input.orgId).eq("status", "active").order("created_at").limit(20);
  const list = ((types ?? []) as { slug: string; name: string; timezone: string | null }[]).map((x) => ({ ...x, label: x.name }));
  const type = (input.service ? matchOption(list, input.service).match : null) ?? list[0] ?? null;
  const tz = type?.timezone || "Asia/Jerusalem";
  const startIso = wallTimeToUtc(input.local, tz);
  const when = startIso ? spokenWhen(startIso, input.lang, tz) : input.local.replace("T", " ");
  const L = input.lang;
  if (!type || !startIso) {
    return { ok: false, say: { he: `רשמתי את הבקשה ל${when}, ומישהו מהצוות יחזור אליך לאשר.`, en: `I've noted the request for ${when}, and someone from the team will call you to confirm.`, ar: `سجلت الطلب لـ${when}، وسيتصل بك أحد الفريق للتأكيد.` }[L] };
  }
  if (!input.name || (!input.phone && !input.email)) {
    return { ok: false, say: { he: "כדי לשריין את התור אני צריך רק את השם המלא שלך.", en: "To lock it in I just need your full name.", ar: "لتثبيت الموعد أحتاج فقط اسمك الكامل." }[L] };
  }
  const { data: res, error } = await admin.rpc("book_appointment_v2", {
    p_slug: type.slug,
    p_start: startIso,
    p_name: input.name,
    p_email: input.email,
    p_phone: input.phone,
    p_notes: L === "en" ? "Booked by the AI agent on a phone call" : "נקבע ע\"י סוכן ה-AI בשיחת טלפון",
    p_meta: { ip_hash: `phone:${input.callId}`, source: "phone" },
  });
  const r = (res ?? {}) as { ok?: boolean; error?: string };
  if (!error && r.ok) return { ok: true, say: { he: `מעולה, קבעתי לך ${type.name} ל${when}. תקבל גם תזכורת לפני.`, en: `Great, you're booked for ${type.name} on ${when}. You'll get a reminder before.`, ar: `ممتاز، حجزت لك ${type.name} يوم ${when}. ستصلك تذكرة قبل الموعد.` }[L] };
  const code = error ? "" : String(r.error ?? "");
  if (code === "booking.outOfRange" || code === "booking.notAvailable") return { ok: false, say: { he: `${when} לא פנוי לקביעה. איזה זמן אחר נוח לך?`, en: `${when} isn't available. What other time works for you?`, ar: `${when} غير متاح. ما الوقت الآخر المناسب لك؟` }[L] };
  return { ok: false, say: { he: `השעה ${when} כבר תפוסה. רוצה שאציע שעה קרובה אחרת?`, en: `${when} is already taken. Shall I suggest another time nearby?`, ar: `${when} محجوز. هل أقترح وقتاً قريباً آخر؟` }[L] };
}

/** One phone turn with the full sales brain. */
export async function phoneTurn(input: { orgId: string; callId: string; conversationId: string | null; callerText: string; locale: string }): Promise<PhoneTurnResult | null> {
  const admin = createAdminClient();
  const lang = phoneLang(input.locale);
  const [{ data: callRow }, { data: agent }, { data: org }] = await Promise.all([
    admin.from("voice_calls").select("id, organization_id, conversation_id, contact_id, direction, from_number, to_number, turns").eq("id", input.callId).maybeSingle(),
    admin.from("ai_agents").select("id, name, instructions, provider, model, profile").eq("organization_id", input.orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    admin.from("organizations").select("name").eq("id", input.orgId).maybeSingle(),
  ]);
  const call = callRow as CallRow | null;
  if (!call) return null;
  const turns = (call.turns ?? []).slice(-24);
  const history: HistoryMsg[] = turns.map((t) => ({ role: t.role === "caller" ? "user" : "assistant", content: t.text }));
  const previousAgent = turns.filter((t) => t.role === "agent").map((t) => t.text);
  const p = (agent?.profile ?? {}) as Record<string, unknown> & { schedule?: unknown };
  const callerPhone = (call.direction === "in" ? call.from_number : call.to_number) ?? "";

  const { loadMemories, canBook } = await import("@/lib/ai/agent-actions");
  const { loadSalesState } = await import("@/lib/ai/sales-state");
  const [memories, bookable, salesBefore, contact] = await Promise.all([
    loadMemories(input.orgId, call.contact_id).catch(() => []),
    canBook(input.orgId).catch(() => false),
    input.conversationId ? loadSalesState(input.conversationId).catch(() => null) : Promise.resolve(null),
    call.contact_id ? admin.from("contacts").select("first_name, last_name, email, phone").eq("id", call.contact_id).maybeSingle().then((r) => r.data as { first_name: string | null; last_name: string | null; email: string | null; phone: string | null } | null) : Promise.resolve(null),
  ]);
  const businessData = [
    p.business ? `About: ${String(p.business)}` : "",
    p.services ? `Services & prices: ${String(p.services)}` : "",
    p.pricing ? `Pricing / discounts policy: ${String(p.pricing)}` : "",
    p.hours ? `Hours: ${String(p.hours)}` : "",
    p.location ? `Address: ${String(p.location)}` : "",
    p.faq ? `FAQ: ${String(p.faq)}` : "",
    Array.isArray(p.fields) && p.fields.length ? `Details to find out before closing: ${(p.fields as string[]).join(", ")}` : "",
    Array.isArray(p.flow) && p.flow.length ? `Conversation script (follow naturally, not word by word): ${(p.flow as string[]).join(" → ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const knownName = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  // wave 59: why the agent is calling (appointment reminder / follow-up) — read separately, never blocks the call
  const purposeLine = call.direction === "out" ? await callPurposeLine(input.callId) : "";
  const sections = [
    purposeLine,
    knownName ? `The caller's name (from the CRM): ${knownName}. Caller phone: ${callerPhone}.` : `Caller phone (already known — do not ask for it unless they want another number): ${callerPhone}.`,
    scheduleInstructions((p.schedule as never) ?? null, new Date(), lang),
    memoryBlock(memories),
    input.callerText ? proBrief({ text: input.callerText, history }) : "",
    salesStateBrief(salesBefore),
    agentActionsInstructions({ canBook: bookable, hasContact: Boolean(call.contact_id) }).replace(/^- \[\[FOLLOWUP[^\n]*\n?/m, ""),
    "LEAD: when you learn the caller's name / need / budget, add [[LEAD: name=…; phone=…; need=…; budget=…; score=hot|warm|cold; summary=…]] at the very end (never spoken).",
    "HANDOFF: if the caller insists on a person, or the issue needs a human (complaint, refund, legal, medical), say you are connecting them and add [[HANDOFF: reason]].",
    "END: when the caller clearly finished (said goodbye / no more questions) close warmly in one sentence and add [[END]].",
    isCorrection(input.callerText) ? "NOTE: the caller is correcting something you said — acknowledge it in a few words without excuses, confirm the corrected detail, continue." : "",
  ];
  const system = phoneSystemPrompt({
    lang,
    agentName: (agent?.name as string | undefined) ?? "Assistant",
    orgName: (org?.name as string | undefined) ?? "",
    direction: call.direction === "out" ? "out" : "in",
    businessInstructions: String(agent?.instructions ?? ""),
    businessData,
    sections,
    callerKnown: Boolean(knownName || memories.length),
  });
  const messages = history.map((h) => ({ role: h.role, content: h.content }));
  if (!messages.length) messages.push({ role: "user", content: call.direction === "out" ? "(you are calling the customer — the customer just answered the phone)" : "(the call just started — greet the caller warmly and briefly and ask how you can help)" });

  const ask = async (extra?: string) =>
    runAISystem({
      orgId: input.orgId,
      feature: "voice",
      agentId: (agent?.id as string | undefined) ?? null,
      system: extra ? `${system}\n\n${extra}` : system,
      messages,
      temperature: 0.5,
      maxTokens: 320,
      patienceMs: 9000,
    });
  let out = await ask();
  if (!out.ok) return null;
  // anti-repetition: the whole answer equals an earlier one → ask once more for a different phrasing
  const firstText = parseAgentTools(parseActionMarkers(out.text).text).text;
  if (isRepeatReply(firstText, previousAgent)) {
    const again = await ask("You were about to repeat an earlier answer almost word for word. Say it differently and shorter, or move the conversation forward with a new question.");
    if (again.ok) out = again;
  }
  const raw = out.text;
  const end = /\[\[\s*end\s*\]\]/i.test(raw);
  const markers = parseActionMarkers(raw.replace(/\[\[\s*end\s*\]\]/gi, ""));
  const tools = parseAgentTools(markers.text);
  let say = spokenTurn(dropRepeats(tools.text, previousAgent).text);

  // lead → CRM (contact + conversation lead)
  let leadContact: string | null = call.contact_id;
  if (tools.lead && input.conversationId) {
    const { captureLead } = await import("@/lib/ai/autopilot");
    const lead = { ...tools.lead, phone: tools.lead.phone || callerPhone || undefined };
    const r = await captureLead({ orgId: input.orgId, conversationId: input.conversationId, lead, channel: "sms", title: lead.name ?? null }).catch(() => null);
    if (r?.contact_id) {
      leadContact = r.contact_id;
      if (!call.contact_id) await admin.from("voice_calls").update({ contact_id: r.contact_id }).eq("id", call.id);
    }
  }
  // actions: remember / tag / task through the shared engine; booking is done here and read back aloud
  const book = markers.actions.find((a) => a.kind === "book");
  const rest = markers.actions.filter((a) => a.kind !== "book" && a.kind !== "followup");
  let booked = false;
  if (rest.length && input.conversationId) {
    const { executeAgentActions } = await import("@/lib/ai/agent-actions");
    await executeAgentActions({
      orgId: input.orgId,
      conversationId: input.conversationId,
      contactId: leadContact,
      channel: "sms",
      agentId: (agent?.id as string | undefined) ?? "",
      locale: lang,
      actions: rest,
      lead: tools.lead,
      customer: { name: knownName || tools.lead?.name || null, phone: callerPhone || null, email: contact?.email ?? null },
    }).catch((e) => console.error("phone actions failed", (e as Error).message));
  }
  if (book && book.kind === "book") {
    const r = await bookOnPhone({ orgId: input.orgId, local: book.local, service: book.service, name: (tools.lead?.name || knownName || "").trim(), phone: (tools.lead?.phone || callerPhone || contact?.phone || "").trim(), email: (tools.lead?.email || contact?.email || "").trim(), lang, callId: call.id });
    booked = r.ok;
    say = `${say ? `${say} ` : ""}${r.say}`.trim();
  }
  // funnel state (CRM synced)
  if (input.conversationId) {
    const { applySalesTransition } = await import("@/lib/ai/sales-state");
    const transition = nextSalesState({ current: salesBefore, text: input.callerText, history, leadCaptured: Boolean(tools.lead && leadContact), bookingRequested: Boolean(book), booked, handoff: tools.handoff });
    await applySalesTransition({ orgId: input.orgId, conversationId: input.conversationId, contactId: leadContact, from: salesBefore, transition }).catch(() => false);
  }
  if (!say) return null;
  return { say, end: end && !tools.handoff, transfer: tools.handoff };
}

/** AI summary of the call → voice_calls.summary + the conversation summary + a CRM timeline activity. */
export async function summarizeCall(callId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("voice_calls").select("id, organization_id, conversation_id, contact_id, turns, summary, created_at, duration_sec").eq("id", callId).maybeSingle();
  const call = data as (CallRow & { summary: string | null; created_at: string; duration_sec: number | null }) | null;
  if (!call || call.summary) return call?.summary ?? null;
  const turns = (call.turns ?? []).filter((t) => t.text?.trim());
  if (turns.filter((t) => t.role === "caller").length === 0) return null;
  const { data: org } = await admin.from("organizations").select("locale").eq("id", call.organization_id).maybeSingle();
  const lang = phoneLang((org?.locale as string | undefined) ?? "he");
  const transcript = turns.map((t) => `${t.role === "caller" ? "Caller" : "Agent"}: ${t.text.replace(/[<>]/g, " ")}`).join("\n").slice(-12000);
  const out = await runAISystem({ orgId: call.organization_id, feature: "insights", system: summaryPrompt(lang), messages: [{ role: "user", content: `<transcript>\n${transcript}\n</transcript>` }], temperature: 0.2, maxTokens: 350, patienceMs: 20_000 }).catch(() => null);
  const summary = out?.ok ? out.text.replace(/[*#`]/g, "").trim().slice(0, 2000) : null;
  if (!summary) return null;
  // Twilio's exact duration wins (status callback); otherwise from the call's start
  const duration = call.duration_sec ?? Math.max(0, Math.round((Date.now() - new Date(call.created_at).getTime()) / 1000));
  await admin.from("voice_calls").update({ summary, duration_sec: duration }).eq("id", call.id);
  if (call.conversation_id) await admin.from("conversations").update({ summary: summary.slice(0, 1000) }).eq("id", call.conversation_id).then(() => undefined, () => undefined);
  if (call.contact_id) await admin.from("activities").insert({ organization_id: call.organization_id, contact_id: call.contact_id, type: "voice_call", payload: { summary: summary.slice(0, 600), call_id: call.id, duration_sec: duration } }).then(() => undefined, () => undefined);
  return summary;
}

/** Wave 59 — the purpose of an outbound call (reminder / callback) for the system prompt; "" when none. */
async function callPurposeLine(callId: string): Promise<string> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("voice_calls").select("purpose, purpose_ref, organization_id").eq("id", callId).maybeSingle();
    if (error || !data?.purpose) return "";
    let note: string | null = null;
    if (data.purpose === "reminder" && data.purpose_ref) {
      const { data: appt } = await admin.from("appointments").select("title, starts_at, location").eq("id", data.purpose_ref as string).eq("organization_id", data.organization_id as string).maybeSingle();
      if (appt) {
        const when = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(appt.starts_at as string));
        note = `${String(appt.title ?? "")} — ${when}${appt.location ? `, ${String(appt.location)}` : ""}`;
      }
    }
    const { purposeBrief } = await import("./outbound-core");
    return purposeBrief(data.purpose as "reminder" | "callback", note);
  } catch {
    return "";
  }
}
