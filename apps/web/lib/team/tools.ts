import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { isAutomatedSenderPlus as isAutomatedSender } from "./safety-plus-core";
import { orFilterFor, planWeekLadder, planWeekRetryable, smartContactQuery } from "./ops-core";

/** upgrade 2: when the exact search finds nothing — match each word separately and understand "leads" / "customers" */
async function smartFindContacts(db: ReturnType<typeof createAdminClient>, orgId: string, text: string) {
  const sq = smartContactQuery(text);
  if (!sq.status && !sq.tokens.length) return [];
  const base = db.from("contacts").select("id, first_name, last_name, email, phone, company_name, status").eq("organization_id", orgId);
  let query = sq.status ? base.eq("status", sq.status) : base;
  for (const t of sq.tokens) query = query.or(orFilterFor(t));
  const { data } = await query.order("created_at", { ascending: false }).limit(8);
  return (data ?? []) as { id: string; first_name: string; last_name: string | null; email: string | null; phone: string | null; company_name: string | null; status: string }[];
}

/**
 * The digital team — tool executors. Every tool calls a REAL capability of the platform and every query is scoped
 * to the business (organization_id) — the employee can never touch another business's data. Arguments arrive
 * validated by validateArgs (tools-core). Never throws: errors come back as { ok: false, error }.
 */
type Args = Record<string, string | number>;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** ids of the contacts that are robots / notification senders (never customers) — used to keep the team away from them */
export async function automatedContactIds(orgId: string, ids: (string | null)[]): Promise<Set<string>> {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x)))].slice(0, 300);
  const out = new Set<string>();
  if (!list.length) return out;
  const { data } = await createAdminClient().from("contacts").select("id, first_name, last_name, email, company_name, phone").eq("organization_id", orgId).in("id", list);
  const rows = (data ?? []) as { id: string; first_name: string | null; last_name: string | null; email: string | null; company_name: string | null; phone?: string | null }[];
  for (const c of rows) {
    if (isAutomatedSender({ email: c.email, name: `${c.first_name ?? ""} ${c.last_name ?? ""}`, company: c.company_name })) out.add(c.id);
  }
  // wave 67: the Telegram service account and one-time login / verification code messages are robots too (fails silent → exactly the set above)
  try {
    const extra = await import("./automated-extra-core");
    for (const c of rows) {
      if (!out.has(c.id) && extra.isTelegramServiceContact({ name: `${c.first_name ?? ""} ${c.last_name ?? ""}`, phone: c.phone ?? null, company: c.company_name })) out.add(c.id);
    }
    const rest = list.filter((id) => !out.has(id)).slice(0, 100);
    if (rest.length) {
      const adm = createAdminClient();
      const { data: convs } = await adm.from("conversations").select("id, contact_id").eq("organization_id", orgId).in("contact_id", rest).limit(300);
      const convRows = (convs ?? []) as { id: string; contact_id: string | null }[];
      if (convRows.length) {
        const { data: msgs } = await adm.from("messages").select("conversation_id, body, created_at").eq("organization_id", orgId).eq("direction", "in").in("conversation_id", convRows.map((c) => c.id)).order("created_at", { ascending: false }).limit(600);
        const lastInbound = new Map<string, string>();
        for (const m of (msgs ?? []) as { conversation_id: string; body: string | null }[]) if (!lastInbound.has(m.conversation_id)) lastInbound.set(m.conversation_id, m.body ?? "");
        for (const id of extra.contactsWithOnlyCodeMessages(convRows, lastInbound)) out.add(id);
      }
    }
  } catch {
    /* optional extra detection — the result stays what it was */
  }
  return out;
}

export async function runTeamTool(orgId: string, tool: string, args: Args, ctx: { actorUser: string | null; locale: string; interactive: boolean }): Promise<ToolRun> {
  const db = createAdminClient();
  try {
    switch (tool) {
      /* ---------------------------------------------------------------- read */
      case "crm.find_contacts": {
        const q = s(args.query).replace(/[%,()*]/g, " ").trim().slice(0, 80);
        if (q.length < 2) return { ok: false, summary: "", error: "query_too_short" };
        const { data, error } = await db.from("contacts").select("id, first_name, last_name, email, phone, company_name, status").eq("organization_id", orgId).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,company_name.ilike.%${q}%`).limit(8);
        if (error) return { ok: false, summary: "", error: error.message };
        let rows = (data ?? []) as { id: string; first_name: string; last_name: string | null; email: string | null; phone: string | null; company_name: string | null; status: string }[];
        if (!rows.length) rows = await smartFindContacts(db, orgId, q).catch(() => []);
        return { ok: true, data: rows, summary: rows.length ? rows.map((r) => `${r.first_name} ${r.last_name ?? ""}`.trim() + ` (id ${r.id}, ${r.status}${r.company_name ? `, ${r.company_name}` : ""})`).join("; ") : "no contacts found" };
      }
      case "crm.contact_brief": {
        const id = s(args.contact_id);
        const [{ data: c }, { data: mem }, { data: deals }, { data: tasks }, { data: msgs }] = await Promise.all([
          db.from("contacts").select("id, first_name, last_name, status, source, company_name, created_at").eq("organization_id", orgId).eq("id", id).maybeSingle(),
          db.from("contact_memories").select("fact").eq("organization_id", orgId).eq("contact_id", id).order("created_at", { ascending: false }).limit(8),
          db.from("deals").select("id, title, value, status").eq("organization_id", orgId).eq("contact_id", id).eq("status", "open").limit(5),
          db.from("tasks").select("title, due_at").eq("organization_id", orgId).eq("contact_id", id).eq("status", "open").limit(5),
          db.from("messages").select("direction, body, created_at, conversations!inner(contact_id)").eq("organization_id", orgId).eq("conversations.contact_id", id).order("created_at", { ascending: false }).limit(6),
        ]);
        if (!c) return { ok: false, summary: "", error: "contact_not_found" };
        const last = ((msgs ?? []) as { direction: string; body: string | null }[]).reverse().map((m) => `${m.direction === "in" ? "customer" : "business"}: ${(m.body ?? "").slice(0, 140)}`).join(" | ");
        return {
          ok: true,
          summary: `${c.first_name} ${c.last_name ?? ""} · ${c.status}${c.company_name ? ` · ${c.company_name}` : ""} · memories: ${((mem ?? []) as { fact: string }[]).map((m) => m.fact).join("; ") || "—"} · open deals: ${((deals ?? []) as { title: string; value: number }[]).map((d) => `${d.title} (${d.value})`).join(", ") || "—"} · open tasks: ${((tasks ?? []) as { title: string }[]).map((t) => t.title).join(", ") || "—"} · last messages: ${last || "—"}`,
          link: `/crm/${id}`,
        };
      }
      case "tasks.open": {
        const { data } = await db.from("tasks").select("title, due_at, assignee_id").eq("organization_id", orgId).eq("status", "open").order("due_at", { ascending: true, nullsFirst: false }).limit(15);
        const rows = (data ?? []) as { title: string; due_at: string | null }[];
        const now = Date.now();
        return { ok: true, summary: rows.length ? rows.map((t) => `${t.title}${t.due_at ? ` (due ${t.due_at.slice(0, 10)}${Date.parse(t.due_at) < now ? ", OVERDUE" : ""})` : ""}`).join("; ") : "no open tasks", link: "/tasks" };
      }
      case "analytics.day_metrics": {
        const { metricsFor, loadOrg } = await import("@/lib/agents/run");
        const org = await loadOrg(orgId);
        const m = await metricsFor(orgId, org?.tz ?? "Asia/Jerusalem");
        return { ok: true, data: m, summary: `yesterday: ${m.y.leads} leads (avg ${m.avg.leads}), ${m.y.conversations} conversations (avg ${m.avg.conversations}), ${m.y.aiReplies} AI replies, won ${m.y.wonCount} deals worth ${m.y.wonValue}, revenue ${m.y.revenue} (avg ${m.avg.revenue})` };
      }
      case "deals.stuck": {
        const days = Math.max(1, Math.min(90, Number(args.days) || 7));
        const { data } = await db.from("deals").select("id, title, value, updated_at, contact_id").eq("organization_id", orgId).eq("status", "open").lt("updated_at", ago(days * 1440)).order("value", { ascending: false }).limit(10);
        const rows = (data ?? []) as { id: string; title: string; value: number; updated_at: string; contact_id: string | null }[];
        return { ok: true, data: rows, summary: rows.length ? rows.map((d) => `${d.title} (id ${d.id}, ${d.value}, quiet since ${d.updated_at.slice(0, 10)}${d.contact_id ? `, contact ${d.contact_id}` : ""})`).join("; ") : `no deals quiet for ${days}+ days`, link: "/pipelines" };
      }
      case "inbox.unanswered": {
        const minutes = Math.max(5, Math.min(10080, Number(args.minutes) || 30));
        const { data } = await db.from("conversations").select("id, title, channel, contact_id, last_customer_at, last_human_at, last_ai_at, last_auto_at").eq("organization_id", orgId).eq("status", "open").lt("last_customer_at", ago(minutes)).gte("last_customer_at", ago(7 * 1440)).order("last_customer_at", { ascending: true }).limit(40);
        const t = (v: string | null) => (v ? Date.parse(v) : 0);
        // waiting = the customer wrote last (after every human / AI / automatic answer)
        const rows = ((data ?? []) as { id: string; title: string | null; channel: string; contact_id: string | null; last_customer_at: string; last_human_at: string | null; last_ai_at: string | null; last_auto_at: string | null }[])
          .filter((c) => t(c.last_customer_at) > Math.max(t(c.last_human_at), t(c.last_ai_at), t(c.last_auto_at)))
          ;
        // robots (security alerts, no-reply notifications, newsletters) are not customers waiting for an answer
        const robots = await automatedContactIds(orgId, rows.map((c) => c.contact_id));
        const people = rows.filter((c) => !(c.contact_id && robots.has(c.contact_id))).slice(0, 10);
        return { ok: true, data: people, summary: people.length ? people.map((c) => `${c.title ?? "customer"} on ${c.channel} (contact ${c.contact_id ?? "—"}, waiting since ${c.last_customer_at.slice(0, 16)})`).join("; ") + (robots.size ? `. (${robots.size} automated sender(s) ignored — not customers)` : "") : "no customer is waiting", link: "/inbox" };
      }
      case "reviews.recent": {
        const days = Math.max(1, Math.min(120, Number(args.days) || 14));
        const { data } = await db.from("reviews").select("id, author, rating, body, status, reply").eq("organization_id", orgId).gte("created_at", ago(days * 1440)).order("created_at", { ascending: false }).limit(12);
        const rows = (data ?? []) as { id: string; author: string | null; rating: number | null; body: string; status: string; reply: string | null }[];
        return { ok: true, data: rows, summary: rows.length ? rows.map((r) => `${r.rating ?? "?"}★ ${r.author ?? "customer"} (id ${r.id}, ${r.reply ? "replied" : "NOT replied"}): ${r.body.slice(0, 160)}`).join("; ") : "no recent reviews" };
      }
      case "social.performance": {
        const [{ data: posts }, { data: brain }] = await Promise.all([
          db.from("social_posts").select("body, engagement, scheduled_at, pillar").eq("organization_id", orgId).eq("status", "published").gte("scheduled_at", ago(30 * 1440)).order("engagement", { ascending: false, nullsFirst: false }).limit(12),
          db.from("social_brain").select("learned").eq("organization_id", orgId).maybeSingle(),
        ]);
        const rows = (posts ?? []) as { body: string; engagement: number | null; pillar: string | null }[];
        const { brainBrief } = await import("@/lib/social/brain-core");
        return { ok: true, summary: `${rows.length} posts in 30 days. Top: ${rows.slice(0, 3).map((p) => `[${p.engagement ?? 0}] ${p.body.slice(0, 90)}`).join(" | ") || "—"}. ${brainBrief(brain?.learned as never) || ""}`.slice(0, 2500), link: "/social" };
      }
      case "sites.list": {
        const { data } = await db.from("sites").select("id, name, status, slug").eq("organization_id", orgId).order("updated_at", { ascending: false }).limit(10);
        const rows = (data ?? []) as { id: string; name: string; status: string }[];
        return { ok: true, data: rows, summary: rows.length ? rows.map((x) => `${x.name} (id ${x.id}, ${x.status})`).join("; ") : "no websites yet", link: "/websites" };
      }
      case "sites.audit": {
        const { data } = await db.from("sites").select("name, status, seo, blocks, settings, theme").eq("organization_id", orgId).eq("id", s(args.site_id)).maybeSingle();
        if (!data) return { ok: false, summary: "", error: "site_not_found" };
        const { auditSite } = await import("@/lib/site/audit-core");
        const r = auditSite(data as never);
        return { ok: true, summary: `health score ${r.score}/100; to fix: ${r.failing.slice(0, 6).map((f) => f.id).join(", ") || "nothing"}`, link: `/websites` };
      }
      case "finance.overdue": {
        const { data } = await db.from("documents").select("id, number, total, status, due_date, contact_id").eq("organization_id", orgId).eq("kind", "invoice").in("status", ["sent", "accepted"]).lt("due_date", new Date().toISOString().slice(0, 10)).order("due_date").limit(12);
        const rows = (data ?? []) as { number: number; total: number; due_date: string; contact_id: string | null }[];
        return { ok: true, summary: rows.length ? rows.map((d) => `#${d.number} ${d.total} due ${String(d.due_date).slice(0, 10)} (contact ${d.contact_id ?? "—"})`).join("; ") : "no overdue invoices", link: "/finance" };
      }

      /* ---------------------------------------------------------------- write — internal */
      case "crm.add_note": {
        const { error } = await db.from("notes").insert({ organization_id: orgId, contact_id: s(args.contact_id), body: s(args.body).slice(0, 10000), created_by: ctx.actorUser });
        return error ? { ok: false, summary: "", error: error.message } : { ok: true, summary: "note added", link: `/crm/${s(args.contact_id)}` };
      }
      case "crm.add_tag": {
        const name = s(args.tag).replace(/^#/, "").slice(0, 40);
        const { data: c } = await db.from("contacts").select("id, first_name, last_name, email, company_name").eq("organization_id", orgId).eq("id", s(args.contact_id)).maybeSingle();
        if (!c) return { ok: false, summary: "", error: "contact_not_found" };
        if (isAutomatedSender({ email: c.email as string | null, name: `${(c.first_name as string | null) ?? ""} ${(c.last_name as string | null) ?? ""}`, company: c.company_name as string | null })) return { ok: false, summary: "", error: "automated_sender_not_a_customer" };
        await db.from("tags").upsert({ organization_id: orgId, name }, { onConflict: "organization_id,name", ignoreDuplicates: true });
        const { data: tag } = await db.from("tags").select("id").eq("organization_id", orgId).eq("name", name).maybeSingle();
        if (!tag) return { ok: false, summary: "", error: "tag_failed" };
        const { error } = await db.from("contact_tags").insert({ organization_id: orgId, contact_id: c.id, tag_id: tag.id });
        return error && error.code !== "23505" ? { ok: false, summary: "", error: error.message } : { ok: true, summary: `tagged #${name}`, link: `/crm/${c.id}` };
      }
      case "crm.remember": {
        const { error } = await db.from("contact_memories").insert({ organization_id: orgId, contact_id: s(args.contact_id), fact: s(args.fact).slice(0, 300), kind: "fact", source: "team", created_by: ctx.actorUser });
        return error && error.code !== "23505" ? { ok: false, summary: "", error: error.message } : { ok: true, summary: "remembered about the customer" };
      }
      case "crm.create_task": {
        const contact = s(args.contact_id) || null;
        if (contact) {
          const { data: c } = await db.from("contacts").select("id").eq("organization_id", orgId).eq("id", contact).maybeSingle();
          if (!c) return { ok: false, summary: "", error: "contact_not_found" };
        }
        const { error } = await db.from("tasks").insert({ organization_id: orgId, title: s(args.title).slice(0, 200), description: s(args.description).slice(0, 4000) || null, status: "open", due_at: s(args.due_iso) || null, contact_id: contact, assignee_id: ctx.actorUser, created_by: ctx.actorUser });
        return error ? { ok: false, summary: "", error: error.message } : { ok: true, summary: `task created: ${s(args.title).slice(0, 120)}`, link: "/tasks" };
      }
      case "deals.create": {
        const { data: pipe } = await db.from("pipelines").select("id, pipeline_stages(id, position)").eq("organization_id", orgId).order("created_at").limit(1).maybeSingle();
        const stages = ((pipe as { pipeline_stages?: { id: string; position: number }[] } | null)?.pipeline_stages ?? []).sort((a, b) => a.position - b.position);
        if (!pipe || !stages.length) return { ok: false, summary: "", error: "no_pipeline" };
        const { data: org } = await db.from("organizations").select("currency").eq("id", orgId).maybeSingle();
        const { error } = await db.from("deals").insert({ organization_id: orgId, title: s(args.title).slice(0, 160), value: Math.max(0, Number(args.value) || 0), currency: (org?.currency as string) || "ILS", pipeline_id: pipe.id, stage_id: stages[0]!.id, contact_id: s(args.contact_id) || null, owner_id: ctx.actorUser, created_by: ctx.actorUser });
        return error ? { ok: false, summary: "", error: error.message } : { ok: true, summary: `deal opened: ${s(args.title).slice(0, 120)}`, link: "/pipelines" };
      }
      case "deals.move": {
        const patch: Record<string, unknown> = {};
        const status = s(args.status);
        if (["won", "lost", "open"].includes(status)) patch.status = status;
        if (s(args.stage_id)) patch.stage_id = s(args.stage_id);
        if (!Object.keys(patch).length) return { ok: false, summary: "", error: "nothing_to_change" };
        const { data, error } = await db.from("deals").update(patch).eq("organization_id", orgId).eq("id", s(args.deal_id)).select("title");
        if (error) return { ok: false, summary: "", error: error.message };
        return data?.length ? { ok: true, summary: `deal updated: ${(data[0] as { title: string }).title}`, link: "/pipelines" } : { ok: false, summary: "", error: "deal_not_found" };
      }
      case "campaigns.draft": {
        const channel = s(args.channel);
        if (!["email", "whatsapp", "sms", "telegram"].includes(channel)) return { ok: false, summary: "", error: "bad_channel" };
        const { data, error } = await db.from("campaigns").insert({ organization_id: orgId, name: s(args.name).slice(0, 120), channel, subject: s(args.subject).slice(0, 200) || null, body: s(args.body).slice(0, 20000), audience: {}, created_by: ctx.actorUser }).select("id").single();
        return error ? { ok: false, summary: "", error: error.message } : { ok: true, summary: `campaign draft saved: ${s(args.name)}`, link: `/campaigns/${data.id}` };
      }
      case "social.draft_post": {
        const { makeSmartPost } = await import("@/lib/social/brain");
        const at = new Date(Date.now() + 86_400_000);
        const r = await makeSmartPost(orgId, { at, date: at.toISOString().slice(0, 10), origin: "studio", status: "draft", topic: s(args.topic) || null });
        return r.ok ? { ok: true, summary: `post draft created (${r.media}, pillar ${r.pillar}) id ${r.id}`, data: { id: r.id }, link: "/social" } : { ok: false, summary: "", error: r.error };
      }
      case "social.plan_week": {
        const { planWeek } = await import("@/lib/social/brain");
        // upgrade 2: a full week that the AI could not answer in one piece is retried smaller (7 → 3 → 1), never thrown
        let lastError = "ai.failed";
        for (const n of planWeekLadder(7)) {
          const r = await planWeek(orgId, n).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "ai.failed" }));
          if (r.ok) return { ok: true, summary: `${r.count} post drafts planned${n < 7 ? ` (smaller batch of ${n} after the full week could not be generated)` : " for the week"}`, link: "/social" };
          lastError = r.error;
          if (!planWeekRetryable(r.error)) break;
        }
        return { ok: false, summary: "", error: lastError };
      }
      case "sites.build": {
        if (!ctx.interactive || !ctx.actorUser) return { ok: false, summary: "", error: "needs_screen" };
        const { buildSiteWithAI } = await import("@/lib/ai/site-builder");
        const r = await buildSiteWithAI({ orgId, userId: ctx.actorUser, locale: (ctx.locale === "en" || ctx.locale === "ar" ? ctx.locale : "he") as "he", brief: s(args.brief).slice(0, 3000), wantFull: s(args.full) === "yes" || s(args.full) === "true" });
        return r.ok ? { ok: true, summary: `website draft "${r.site.name}" built${r.site.report?.quality ? ` (quality ${r.site.report.quality.after}/100)` : ""}`, link: `/websites/${r.site.id}/preview` } : { ok: false, summary: "", error: r.error };
      }
      case "agents.run_collections": {
        const m = await import("@/lib/agents/run");
        const { data: cfg } = await db.from("agent_settings").select("config").eq("organization_id", orgId).eq("agent", "collections").maybeSingle();
        const r = await m.runCollections(orgId, (cfg?.config ?? {}) as Record<string, unknown>);
        return { ok: true, summary: `collections agent ran: ${r.actions} reminder(s)`, link: "/agents" };
      }
      case "agents.run_analyst":
      case "agents.run_sales_manager":
      case "agents.run_marketing": {
        const m = await import("@/lib/agents/run");
        const { data: cfg } = await db.from("agent_settings").select("config").eq("organization_id", orgId).eq("agent", tool === "agents.run_analyst" ? "analyst" : tool === "agents.run_sales_manager" ? "sales_manager" : "marketing").maybeSingle();
        const config = (cfg?.config ?? {}) as Record<string, unknown>;
        const r = tool === "agents.run_analyst" ? await m.runAnalyst(orgId) : tool === "agents.run_sales_manager" ? await m.runSalesManager(orgId, config) : await m.runMarketing(orgId, config);
        return { ok: true, summary: `${tool.replace("agents.run_", "")} agent ran: ${r.actions} action(s)`, link: "/agents" };
      }
      case "reviews.draft_reply": {
        const { data, error } = await db.from("reviews").update({ ai_draft: s(args.text).slice(0, 4000), status: "drafted" }).eq("organization_id", orgId).eq("id", s(args.review_id)).is("reply", null).select("id");
        if (error) return { ok: false, summary: "", error: error.message };
        return data?.length ? { ok: true, summary: "reply draft saved on the review" } : { ok: false, summary: "", error: "review_not_found_or_replied" };
      }

      /* ---------------------------------------------------------------- write — customer-facing / money */
      case "inbox.send_message":
      case "collections.send_reminder": {
        const { data: c } = await db.from("contacts").select("id").eq("organization_id", orgId).eq("id", s(args.contact_id)).maybeSingle();
        if (!c) return { ok: false, summary: "", error: "contact_not_found" };
        const { messageContact } = await import("@/lib/agents/run");
        const sent = await messageContact(orgId, c.id as string, s(args.text).slice(0, 4000), tool === "collections.send_reminder" ? "reminder" : "automation", { team: true });
        return sent ? { ok: true, summary: "message sent to the customer", link: `/crm/${c.id}` } : { ok: false, summary: "", error: "not_sent_guard_or_channel" };
      }
      case "calendar.book": {
        const when = new Date(s(args.when_iso));
        if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) return { ok: false, summary: "", error: "bad_time" };
        const minutes = Math.max(5, Math.min(480, Math.round(Number(args.minutes) || 30)));
        const { error } = await db.from("appointments").insert({ organization_id: orgId, title: (s(args.title) || "Meeting").slice(0, 200), starts_at: when.toISOString(), ends_at: new Date(when.getTime() + minutes * 60_000).toISOString(), contact_id: s(args.contact_id) || null, host_id: ctx.actorUser, status: "confirmed", created_by: ctx.actorUser });
        return error ? { ok: false, summary: "", error: error.message.includes("no_overlap") ? "slot_taken" : error.message } : { ok: true, summary: `meeting booked ${when.toISOString().slice(0, 16)}`, link: "/appointments" };
      }
      case "social.schedule_post": {
        const when = s(args.when_iso) || new Date(Date.now() + 30 * 60_000).toISOString();
        const { data, error } = await db.from("social_posts").update({ status: "scheduled", scheduled_at: when }).eq("organization_id", orgId).eq("id", s(args.post_id)).eq("status", "draft").select("id");
        if (error) return { ok: false, summary: "", error: error.message };
        return data?.length ? { ok: true, summary: `post scheduled for ${when.slice(0, 16)}`, link: "/social" } : { ok: false, summary: "", error: "post_not_found_or_not_draft" };
      }
      case "market.scan":
      case "market.record":
      case "market.what_changed": {
        // upgrade 4: market intelligence (public sources only; says plainly when no search provider is configured)
        const { runMarketTool } = await import("./market-intel");
        return runMarketTool(orgId, tool, args);
      }
      case "goals.list":
      case "goals.forecast":
      case "goals.set":
      case "experiments.list":
      case "experiments.propose":
      case "board.view":
      case "board.post":
      case "reports.latest": {
        // upgrade 7 / stages C–H: goals, experiments, shared board, reports (every one fails soft when its migration was not run)
        const { runPlus7cTool } = await import("./tools-plus7c");
        return runPlus7cTool(orgId, tool, args, { lang: ctx.locale === "en" || ctx.locale === "ar" ? ctx.locale : "he" });
      }
      case "facts.lookup":
      case "facts.history":
      case "facts.record": {
        // upgrade 7: versioned business facts (the model can never claim the owner's authority)
        const { runFactsTool } = await import("./business-facts");
        return runFactsTool(orgId, tool, args, { lang: ctx.locale === "en" || ctx.locale === "ar" ? ctx.locale : "he" });
      }
      case "sop.lookup":
      case "sop.propose": {
        // upgrade 8 / stage B: standard operating procedures (the model can only PROPOSE a change; the owner decides)
        const { runOrgTool } = await import("./org8-data");
        return runOrgTool(orgId, tool, args, { lang: ctx.locale === "en" || ctx.locale === "ar" ? ctx.locale : "he" });
      }
      default:
        return { ok: false, summary: "", error: "unknown_tool" };
    }
  } catch (e) {
    return { ok: false, summary: "", error: (e as Error).message.slice(0, 300) };
  }
}
