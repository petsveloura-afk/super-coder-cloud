import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { runAISystem } from "@/lib/ai/run-system";
import { AGENT_DEFAULTS, attentionItems, cartText, isMorning, overdueText, parsePostPlan, reminderTone, scheduleSlots, trend, type AgentKey, type DayMetrics } from "./core";

/**
 * Wave 19 — the AI team, run by /api/cron/agents. Every agent:
 *  - is switched on per business (Agents hub) and claimed atomically (claim_due_agents),
 *  - writes what it did to agent_runs (visible in the hub) and notifies the owners,
 *  - messages customers ONLY through the conversation guard (consent, a person owns the chat,
 *    24-hour windows, caps, quiet hours) — the same single conversation state as everything else.
 */
type Locale = "he" | "en" | "ar";
interface Org {
  id: string;
  name: string;
  locale: Locale;
  tz: string;
  agent: { id: string; instructions: string; provider: string | null; model: string | null } | null;
}

async function loadOrg(orgId: string): Promise<Org | null> {
  const admin = createAdminClient();
  const [{ data: o }, { data: a }] = await Promise.all([
    admin.from("organizations").select("id, name, locale, timezone").eq("id", orgId).maybeSingle(),
    admin.from("ai_agents").select("id, instructions, provider, model").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
  ]);
  if (!o) return null;
  return {
    id: o.id as string,
    name: (o.name as string) ?? "",
    locale: (o.locale === "en" || o.locale === "ar" ? o.locale : "he") as Locale,
    tz: (o.timezone as string) || "Asia/Jerusalem",
    agent: a ? { id: a.id as string, instructions: String(a.instructions ?? ""), provider: (a.provider as string | null) ?? null, model: (a.model as string | null) ?? null } : null,
  };
}

async function logRun(orgId: string, agent: string, summary: string, details: Record<string, unknown>, actions: number) {
  await createAdminClient().from("agent_runs").insert({ organization_id: orgId, agent, summary: summary.slice(0, 4000), details, actions });
}

async function notifyOwners(orgId: string, titleKey: string, params: Record<string, string>, link: string) {
  const admin = createAdminClient();
  const { data: members } = await admin.from("organization_members").select("user_id").eq("organization_id", orgId).in("role", ["agency_owner", "owner", "admin", "manager"]);
  const rows = ((members ?? []) as { user_id: string }[]).map((m) => ({ organization_id: orgId, user_id: m.user_id, kind: "agents", title_key: titleKey, params, link }));
  if (rows.length) await admin.from("notifications").insert(rows);
}

async function ai(org: Org, feature: "marketing" | "sales_manager" | "brief" | "collections", system: string, user: string, maxTokens = 700): Promise<string | null> {
  const out = await runAISystem({
    orgId: org.id,
    feature,
    agentId: org.agent?.id ?? null,
    provider: (org.agent?.provider as "openai" | "anthropic" | "gemini" | null) ?? undefined,
    model: org.agent?.model ?? undefined,
    system,
    messages: [{ role: "user", content: user }],
    temperature: 0.5,
    maxTokens,
    patienceMs: 15_000,
  });
  return out.ok ? out.text.trim() : null;
}

const langName = (l: Locale) => (l === "en" ? "English" : l === "ar" ? "Arabic" : "Hebrew");

/* ------------------------------------------------------------------ analyst (daily brief) */
export async function metricsFor(orgId: string, tz: string): Promise<{ y: DayMetrics; avg: DayMetrics }> {
  const admin = createAdminClient();
  const now = Date.now();
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const weekAgo = new Date(now - 8 * 86_400_000).toISOString();
  const count = async (table: string, col: string, since: string, until?: string, extra?: { aiOnly?: boolean; status?: string }) => {
    let q = admin.from(table).select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte(col, since);
    if (until) q = q.lt(col, until);
    if (extra?.aiOnly) q = q.not("ai_agent_id", "is", null);
    if (extra?.status) q = q.eq("status", extra.status);
    const { count: c } = await q;
    return c ?? 0;
  };
  const sum = async (table: string, field: string, col: string, since: string, until: string | undefined, filter?: Record<string, string>) => {
    let q = admin.from(table).select(field).eq("organization_id", orgId).gte(col, since).limit(5000);
    if (until) q = q.lt(col, until);
    for (const [k, v] of Object.entries(filter ?? {})) q = q.eq(k, v);
    const { data } = await q;
    return ((data ?? []) as unknown as Record<string, number>[]).reduce((s, r) => s + Number(r[field] ?? 0), 0);
  };
  const [leadsY, leadsW, convY, convW, aiY, aiW, wonY, wonW, wonCountY, revY, revW] = await Promise.all([
    count("contacts", "created_at", dayAgo),
    count("contacts", "created_at", weekAgo, dayAgo),
    count("conversations", "created_at", dayAgo),
    count("conversations", "created_at", weekAgo, dayAgo),
    count("messages", "created_at", dayAgo, undefined, { aiOnly: true }),
    count("messages", "created_at", weekAgo, dayAgo, { aiOnly: true }),
    sum("deals", "value", "closed_at", dayAgo, undefined, { status: "won" }),
    sum("deals", "value", "closed_at", weekAgo, dayAgo, { status: "won" }),
    count("deals", "closed_at", dayAgo, undefined, { status: "won" }),
    sum("payments", "amount", "paid_at", dayAgo, undefined),
    sum("payments", "amount", "paid_at", weekAgo, dayAgo),
  ]);
  const { data: timings } = await admin.from("messages").select("meta").eq("organization_id", orgId).not("ai_agent_id", "is", null).gte("created_at", dayAgo).not("meta->timing", "is", null).limit(300);
  const ts = ((timings ?? []) as { meta: { timing?: { total?: number } } | null }[]).map((r) => Number(r.meta?.timing?.total)).filter((n) => Number.isFinite(n) && n >= 0);
  const { data: overdue } = await admin.rpc("overdue_invoices", { p_org: orgId, p_days: 0, p_limit: 100 });
  const overdueTotal = ((overdue ?? []) as { balance: number }[]).reduce((s, r) => s + Number(r.balance ?? 0), 0);
  const startToday = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday.getTime() + 86_400_000);
  const [{ count: appts }, { count: waiting }, { count: hot }] = await Promise.all([
    admin.from("appointments").select("id", { count: "exact", head: true }).eq("organization_id", orgId).in("status", ["scheduled", "confirmed"]).gte("starts_at", new Date().toISOString()).lt("starts_at", endToday.toISOString()),
    admin.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "open").eq("ai_mode", "human").gt("unread_count", 0),
    admin.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("lead_score", "hot").eq("status", "open"),
  ]);
  const y: DayMetrics = { leads: leadsY, conversations: convY, aiReplies: aiY, avgReplyMs: ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length) : null, wonValue: wonY, wonCount: wonCountY, revenue: revY, overdueTotal, appointmentsToday: appts ?? 0, waiting: waiting ?? 0, hotLeads: hot ?? 0 };
  const avg: DayMetrics = { leads: leadsW / 7, conversations: convW / 7, aiReplies: aiW / 7, avgReplyMs: null, wonValue: wonW / 7, wonCount: 0, revenue: revW / 7, overdueTotal, appointmentsToday: 0, waiting: 0, hotLeads: 0 };
  return { y, avg };
}

export async function runAnalyst(orgId: string): Promise<{ actions: number }> {
  const org = await loadOrg(orgId);
  if (!org) return { actions: 0 };
  const { y, avg } = await metricsFor(orgId, org.tz);
  const facts = {
    leads: { value: y.leads, trend: trend(y.leads, avg.leads) },
    conversations: { value: y.conversations, trend: trend(y.conversations, avg.conversations) },
    ai_replies: { value: y.aiReplies, trend: trend(y.aiReplies, avg.aiReplies) },
    revenue: { value: Math.round(y.revenue), trend: trend(y.revenue, avg.revenue) },
    won_deals: { value: y.wonCount, amount: Math.round(y.wonValue) },
    avg_ai_reply_seconds: y.avgReplyMs != null ? Math.round(y.avgReplyMs / 100) / 10 : null,
    overdue_invoices_total: Math.round(y.overdueTotal),
    meetings_today: y.appointmentsToday,
    waiting_for_a_person: y.waiting,
    hot_leads_open: y.hotLeads,
  };
  const attention = attentionItems(y, org.locale);
  const text = await ai(
    org,
    "brief",
    `You are the business analyst of "${org.name}". Write the owner's morning brief in ${langName(org.locale)}: 3-5 short bullet lines with yesterday's key numbers and what changed (use the trends), then "Today:" with 2-3 concrete actions in order of money impact. Plain text, no markdown headers, no invented numbers.`,
    JSON.stringify({ yesterday: facts, needs_attention: attention }),
    500,
  );
  const summary = text ?? [`📊 ${org.name}`, ...attention].join("\n");
  await logRun(orgId, "analyst", summary, { metrics: facts, attention }, attention.length);
  await notifyOwners(orgId, "agents.briefNotification", { org: org.name }, "/agents");
  // e-mail copy to the owners (when e-mail is configured)
  const { emailConfigured, sendEmail, escapeHtml } = await import("@/lib/email/send");
  if (emailConfigured()) {
    const admin = createAdminClient();
    const { data: members } = await admin.from("organization_members").select("user_id").eq("organization_id", orgId).in("role", ["agency_owner", "owner"]);
    const ids = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
    if (ids.length) {
      const { data: profiles } = await admin.from("profiles").select("email").in("id", ids);
      const link = `${publicEnv.appUrl.replace(/\/$/, "")}/${org.locale}/agents`;
      const html = `<div dir="${org.locale === "en" ? "ltr" : "rtl"}" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.7">${escapeHtml(summary).replace(/\n/g, "<br>")}<p><a href="${link}">${link}</a></p></div>`;
      for (const p of ((profiles ?? []) as { email: string | null }[]).filter((x) => x.email)) {
        await sendEmail({ to: p.email!, subject: org.locale === "en" ? `☀️ Morning brief · ${org.name}` : org.locale === "ar" ? `☀️ ملخص الصباح · ${org.name}` : `☀️ תדריך בוקר · ${org.name}`, html, text: summary }).catch(() => undefined);
      }
    }
  }
  return { actions: attention.length };
}

/* ------------------------------------------------------------------ sales manager */
export async function runSalesManager(orgId: string, config: Record<string, unknown>): Promise<{ actions: number }> {
  const org = await loadOrg(orgId);
  if (!org) return { actions: 0 };
  const admin = createAdminClient();
  const days = Math.max(2, Math.min(60, Number(config.quiet_days ?? AGENT_DEFAULTS.sales_manager.config.quiet_days)));
  const maxTasks = Math.max(1, Math.min(20, Number(config.max_tasks ?? AGENT_DEFAULTS.sales_manager.config.max_tasks)));
  const { data } = await admin.rpc("stuck_deals", { p_org: orgId, p_days: days, p_limit: 30 });
  const deals = (data ?? []) as { id: string; title: string; value: number; stage_name: string | null; owner_id: string | null; contact_id: string | null; days_quiet: number }[];
  if (!deals.length) {
    await logRun(orgId, "sales_manager", org.locale === "en" ? "No deal went quiet — the pipeline is moving." : org.locale === "ar" ? "لا توجد صفقات متوقفة." : "אין עסקאות תקועות — הצינור זז.", { checked: 0 }, 0);
    return { actions: 0 };
  }
  // next steps in one AI call (falls back to a generic step)
  const plan = await ai(
    org,
    "sales_manager",
    `You are the sales manager of "${org.name}". For each quiet deal give ONE concrete next step (max 14 words) in ${langName(org.locale)}. Answer as JSON: [{"id": "...", "step": "..."}]. No invented facts.`,
    JSON.stringify(deals.slice(0, maxTasks).map((d) => ({ id: d.id, title: d.title, value: d.value, stage: d.stage_name, quiet_days: d.days_quiet }))),
    600,
  );
  let steps: Record<string, string> = {};
  try {
    steps = Object.fromEntries(((JSON.parse((plan ?? "[]").match(/\[[\s\S]*\]/)?.[0] ?? "[]") as { id: string; step: string }[]) ?? []).map((s) => [s.id, String(s.step).slice(0, 200)]));
  } catch {
    steps = {};
  }
  let created = 0;
  for (const d of deals.slice(0, maxTasks)) {
    await admin.rpc("agent_emit", { p_org: orgId, p_type: "deal.stuck", p_entity_type: "deal", p_entity_id: d.id, p_payload: { title: d.title, value: d.value, quiet_days: d.days_quiet } }).then(() => undefined, () => undefined);
    const { data: open } = await admin.from("tasks").select("id").eq("organization_id", orgId).eq("deal_id", d.id).eq("status", "open").limit(1).maybeSingle();
    if (open) continue;
    const step = steps[d.id] ?? (org.locale === "en" ? "Call and agree on the next step" : org.locale === "ar" ? "اتصل واتفق على الخطوة التالية" : "להתקשר ולסגור את הצעד הבא");
    const { error } = await admin.from("tasks").insert({
      organization_id: orgId,
      deal_id: d.id,
      contact_id: d.contact_id,
      assignee_id: d.owner_id,
      title: `🤖 ${d.title}: ${step}`.slice(0, 200),
      description: (org.locale === "en" ? `No activity for ${d.days_quiet} days (stage: ${d.stage_name ?? "—"}).` : org.locale === "ar" ? `لا نشاط منذ ${d.days_quiet} أيام.` : `אין פעילות כבר ${d.days_quiet} ימים (שלב: ${d.stage_name ?? "—"}).`).slice(0, 5000),
      due_at: new Date(Date.now() + 86_400_000).toISOString(),
      remind_at: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    });
    if (!error) created++;
  }
  const total = deals.reduce((s, d) => s + Number(d.value ?? 0), 0);
  const summary = org.locale === "en"
    ? `${deals.length} deals went quiet (₪${Math.round(total)} in the pipeline). Created ${created} follow-up tasks with a next step.`
    : org.locale === "ar"
      ? `${deals.length} صفقات متوقفة (₪${Math.round(total)}). تم إنشاء ${created} مهام متابعة.`
      : `${deals.length} עסקאות נתקעו (₪${Math.round(total).toLocaleString("he-IL")} בצינור). נוצרו ${created} משימות מעקב עם צעד הבא.`;
  await logRun(orgId, "sales_manager", summary, { deals: deals.slice(0, maxTasks).map((d) => ({ id: d.id, title: d.title, quiet: d.days_quiet, step: steps[d.id] ?? null })) }, created);
  if (created) await notifyOwners(orgId, "agents.salesNotification", { count: String(created) }, "/tasks");
  return { actions: created };
}

/* ------------------------------------------------------------------ collections (+ abandoned carts) */
async function messageContact(orgId: string, contactId: string, text: string, kind: "reminder" | "automation", meta: Record<string, unknown>): Promise<boolean> {
  const admin = createAdminClient();
  const { checkGuard, checkContact } = await import("@/lib/conversations/guard");
  const { sendToConversation, sendToContact } = await import("@/lib/channels/send-message");
  const { data: convs } = await admin.from("conversations").select("id, channel").eq("organization_id", orgId).eq("contact_id", contactId).neq("channel", "web").order("last_message_at", { ascending: false, nullsFirst: false }).limit(4);
  for (const c of (convs ?? []) as { id: string; channel: string }[]) {
    const g = await checkGuard(c.id, kind);
    if (!g.allowed) continue;
    const r = await sendToConversation(orgId, c.id, text, undefined, { meta: { system: "agent", ...meta } });
    if (r.ok) return true;
  }
  const cg = await checkContact(contactId, kind);
  if (!cg.allowed) return false;
  if (!convs?.length) {
    for (const k of ["whatsapp", "sms"] as const) {
      const r = await sendToContact(k, orgId, contactId, text).catch(() => ({ ok: false }));
      if (r.ok) return true;
    }
  }
  const { data: c } = await admin.from("contacts").select("email").eq("id", contactId).maybeSingle();
  const { emailConfigured, escapeHtml, sendEmail } = await import("@/lib/email/send");
  if (!c?.email || !emailConfigured()) return false;
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.7" dir="auto">${escapeHtml(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>")}</div>`;
  const res = await sendEmail({ to: c.email as string, subject: text.split("\n")[0]!.slice(0, 150), html, text });
  return res.sent;
}

export async function runCollections(orgId: string, config: Record<string, unknown>): Promise<{ actions: number }> {
  const org = await loadOrg(orgId);
  if (!org) return { actions: 0 };
  const admin = createAdminClient();
  const gap = Math.max(1, Math.min(30, Number(config.gap_days ?? 3)));
  const maxReminders = Math.max(1, Math.min(5, Number(config.max_reminders ?? 3)));
  const { data } = await admin.rpc("overdue_invoices", { p_org: orgId, p_days: gap, p_limit: 30 });
  const rows = (data ?? []) as { id: string; number: string; contact_id: string; balance: number; currency: string; days_overdue: number; reminders: number; public_token: string }[];
  const base = publicEnv.appUrl.replace(/\/$/, "");
  let sent = 0;
  let handedOver = 0;
  for (const inv of rows) {
    if (inv.reminders >= maxReminders) continue;
    const { data: c } = await admin.from("contacts").select("first_name, last_name, owner_id").eq("id", inv.contact_id).maybeSingle();
    const tone = reminderTone(inv.reminders);
    const text = overdueText(org.locale, { name: `${c?.first_name ?? ""} ${c?.last_name ?? ""}`.trim() || null, number: String(inv.number), balance: Number(inv.balance), currency: inv.currency, days: inv.days_overdue, url: `${base}/${org.locale}/q/${inv.public_token}`, org: org.name, tone });
    const ok = await messageContact(orgId, inv.contact_id, text, "reminder", { invoice_id: inv.id, reminder: inv.reminders + 1 }).catch(() => false);
    if (!ok) continue;
    sent++;
    await admin.from("activities").insert({ organization_id: orgId, contact_id: inv.contact_id, type: "invoice.reminded", payload: { document_id: inv.id, number: inv.number, n: inv.reminders + 1, tone } });
    await admin.rpc("agent_emit", { p_org: orgId, p_type: "invoice.overdue", p_entity_type: "contact", p_entity_id: inv.contact_id, p_payload: { document_id: inv.id, number: inv.number, balance: inv.balance, days: inv.days_overdue } }).then(() => undefined, () => undefined);
    if (tone === "final") {
      handedOver++;
      await admin.from("tasks").insert({ organization_id: orgId, contact_id: inv.contact_id, assignee_id: (c?.owner_id as string | null) ?? null, title: `💳 ${org.locale === "en" ? "Collect invoice" : org.locale === "ar" ? "تحصيل فاتورة" : "גבייה: חשבונית"} #${inv.number}`, due_at: new Date(Date.now() + 86_400_000).toISOString() });
    }
  }
  const carts = 0; // abandoned carts run as their own cron step (runAbandonedCarts) for every store
  const summary = org.locale === "en"
    ? `Sent ${sent} payment reminders (${handedOver} handed to the team) and ${carts} abandoned-cart reminders.`
    : org.locale === "ar"
      ? `أُرسلت ${sent} تذكيرات دفع و${carts} تذكيرات سلة.`
      : `נשלחו ${sent} תזכורות תשלום (${handedOver} הועברו לצוות) ו-${carts} תזכורות לעגלות נטושות.`;
  if (sent || carts || rows.length) await logRun(orgId, "collections", summary, { overdue: rows.length, sent, handedOver, carts }, sent + carts);
  return { actions: sent + carts };
}

/** Abandoned carts (every store): claimed once, one reminder when the business enabled it (collections agent, carts on). */
export async function runAbandonedCarts(budgetMs = 15_000): Promise<{ claimed: number; sent: number }> {
  const started = Date.now();
  const admin = createAdminClient();
  const { data: due } = await admin.rpc("claim_abandoned_carts", { p_limit: 40 });
  const rows = (due ?? []) as { organization_id: string; contact_id: string | null; customer_name: string | null; checkout_url: string | null; total: number; currency: string }[];
  const enabled = new Map<string, boolean>();
  const orgs = new Map<string, Org | null>();
  let sent = 0;
  for (const cart of rows) {
    if (Date.now() - started > budgetMs) break;
    if (!cart.contact_id) continue;
    if (!enabled.has(cart.organization_id)) {
      const { data: st } = await admin.from("agent_settings").select("enabled, config").eq("organization_id", cart.organization_id).eq("agent", "collections").maybeSingle();
      enabled.set(cart.organization_id, Boolean(st?.enabled) && (st?.config as { carts?: boolean } | null)?.carts !== false);
    }
    if (!enabled.get(cart.organization_id)) continue;
    const { data: ct } = await admin.from("contacts").select("marketing_consent").eq("id", cart.contact_id).maybeSingle();
    if (!ct?.marketing_consent) continue;
    if (!orgs.has(cart.organization_id)) orgs.set(cart.organization_id, await loadOrg(cart.organization_id));
    const org = orgs.get(cart.organization_id);
    if (!org) continue;
    const ok = await messageContact(cart.organization_id, cart.contact_id, cartText(org.locale, { name: cart.customer_name, org: org.name, url: cart.checkout_url, total: cart.total, currency: cart.currency }), "automation", { cart: true }).catch(() => false);
    if (ok) sent++;
  }
  return { claimed: rows.length, sent };
}

/* ------------------------------------------------------------------ marketing (content plan) */
export async function runMarketing(orgId: string, config: Record<string, unknown>): Promise<{ actions: number }> {
  const org = await loadOrg(orgId);
  if (!org) return { actions: 0 };
  const admin = createAdminClient();
  const { data: social } = await admin.from("social_settings").select("posts_per_week, brand_voice, auto_publish").eq("organization_id", orgId).maybeSingle();
  const posts = Math.max(1, Math.min(14, Number(config.posts ?? social?.posts_per_week ?? 3)));
  const autoPublish = Boolean(config.auto_publish ?? social?.auto_publish ?? false);
  const { data: ig } = await admin.from("channel_accounts").select("id").eq("organization_id", orgId).eq("kind", "instagram").maybeSingle();
  const raw = await ai(
    org,
    "marketing",
    [
      `You are the social media manager of "${org.name}". Business information:\n${(org.agent?.instructions ?? "").slice(0, 5000)}`,
      social?.brand_voice ? `Brand voice: ${String(social.brand_voice).slice(0, 800)}` : "",
      `Write ${posts} different posts for next week in ${langName(org.locale)}: a mix of value tips, a customer story/benefit, and one clear offer with a call to action (send a message / book). 2-5 short lines each, 1-3 relevant hashtags at the end, emojis sparingly. Never invent prices or facts. Answer ONLY as JSON: [{"text": "...", "platforms": ["facebook"${ig ? ', "instagram"' : ""}]}]`,
    ].filter(Boolean).join("\n\n"),
    "Plan next week's posts.",
    1500,
  );
  const plan = parsePostPlan(raw ?? "", posts);
  if (!plan.length) {
    await logRun(orgId, "marketing", org.locale === "en" ? "Could not write the content plan (AI unavailable)." : "לא הצלחתי לכתוב את תוכנית התוכן (ה-AI לא זמין).", {}, 0);
    return { actions: 0 };
  }
  const slots = scheduleSlots(plan.length, new Date());
  // Instagram needs an image — text-only posts go to Facebook only
  const rows = plan.map((p, i) => ({ organization_id: orgId, platforms: p.platforms.filter((x) => x === "facebook"), body: p.text, scheduled_at: slots[i]!.toISOString(), status: autoPublish ? "scheduled" : "draft", source: "agent" }));
  const { error } = await admin.from("social_posts").insert(rows.map((r) => ({ ...r, platforms: r.platforms.length ? r.platforms : ["facebook"] })));
  if (error) {
    await logRun(orgId, "marketing", `save failed: ${error.message}`.slice(0, 300), {}, 0);
    return { actions: 0 };
  }
  const summary = org.locale === "en"
    ? `${plan.length} posts for next week are ready ${autoPublish ? "and scheduled" : "for your approval"}.`
    : org.locale === "ar"
      ? `${plan.length} منشورات للأسبوع القادم جاهزة ${autoPublish ? "ومجدولة" : "للموافقة"}.`
      : `${plan.length} פוסטים לשבוע הבא מוכנים ${autoPublish ? "ומתוזמנים" : "לאישור שלך"}.`;
  await logRun(orgId, "marketing", summary, { posts: plan.length, autoPublish }, plan.length);
  await notifyOwners(orgId, "agents.marketingNotification", { count: String(plan.length) }, "/social");
  return { actions: plan.length };
}

/* ------------------------------------------------------------------ scheduler */
export async function runAgentsCron(budgetMs = 50_000): Promise<Record<string, unknown>> {
  const started = Date.now();
  const admin = createAdminClient();
  const out: Record<string, unknown> = {};
  const left = () => budgetMs - (Date.now() - started);
  const runners: Record<AgentKey, (org: string, cfg: Record<string, unknown>) => Promise<{ actions: number }>> = {
    analyst: (o) => runAnalyst(o),
    sales_manager: runSalesManager,
    collections: runCollections,
    marketing: runMarketing,
  };
  // wave 35: due posts go out FIRST — they are time-critical and cheap, and must not wait behind slow agents
  if (left() > 6000) {
    const { publishDuePosts } = await import("@/lib/social/publish");
    out.socialPostsFirst = await publishDuePosts(Math.min(20_000, left() - 3000)).catch((e) => ({ error: (e as Error).message }));
  }
  for (const key of ["collections", "sales_manager", "analyst", "marketing"] as AgentKey[]) {
    if (left() < 8000) break;
    // morning agents: only in the morning (Israel time for the claim; each org's zone is checked again)
    if ((key === "analyst" || key === "sales_manager") && !isMorning("Asia/Jerusalem")) {
      out[key] = { skipped: "not_morning" };
      continue;
    }
    const { data, error } = await admin.rpc("claim_due_agents", { p_agent: key, p_minutes: AGENT_DEFAULTS[key].minutes, p_limit: 10 });
    if (error) {
      out[key] = { error: error.message.slice(0, 120) };
      continue;
    }
    let done = 0;
    let actions = 0;
    for (const row of (data ?? []) as { organization_id: string; config: Record<string, unknown> }[]) {
      if (left() < 6000) break;
      try {
        const r = await runners[key](row.organization_id, row.config ?? {});
        actions += r.actions;
        done++;
      } catch (e) {
        console.error(`agent ${key} failed`, row.organization_id, (e as Error).message);
      }
    }
    out[key] = { orgs: done, actions };
  }
  if (left() > 6000) out.carts = await runAbandonedCarts(Math.min(15_000, left() - 3000)).catch((e) => ({ error: (e as Error).message }));
  // social posts that are due → publish
  if (left() > 6000) {
    const { publishDuePosts } = await import("@/lib/social/publish");
    out.socialPosts = await publishDuePosts(Math.min(20_000, left() - 3000)).catch((e) => ({ error: (e as Error).message }));
  }
  // Google reviews
  if (left() > 6000) {
    const { runReviewsSync } = await import("@/lib/social/reviews-agent");
    out.reviews = await runReviewsSync(Math.min(20_000, left() - 3000)).catch((e) => ({ error: (e as Error).message }));
  }
  return out;
}
