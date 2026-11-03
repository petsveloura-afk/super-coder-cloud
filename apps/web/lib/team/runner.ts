import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLES, STARTER_TEAM, isRoleKey, type RoleKey } from "./roles";
import { assign, goalPrompt, parseGoalPlan, readyTasks, runEmployeeTask, type EngineDeps, type EngineMember, type EngineSettings, type EngineTask, type Outcome, type TeamContext } from "./engine-core";
import { learnFromFeedback, supersededBy, type MemoryItem } from "./memory-core";
import { cleanRoutingRow, routeFor, type RoutingPref, type TaskKind } from "./routing-core";
import { initiatives, knownFacts, meetingFacts, memberStats, profilePrompt, type MemberStats, type ProfileFacts, type Signals } from "./insight-core";
import { TOOL_MAP, validateArgs } from "./tools-core";
import { withRoleExtras } from "./tools-plus-core";
import { withRoleExtras7 } from "./tools-plus7-core";
import { withRoleExtras7c } from "./tools-plus7c-core";
import { automatedContactIds, runTeamTool } from "./tools";
import { playbookPrompt } from "./playbooks";
import { REPORT_STANDARD, WORKING_DOCTRINE, expertisePrompt } from "./doctrine";
import { SAFETY_RULES, asData } from "./safety-core";
import { healthyRoute, maintainTeam, noteModelResult } from "./runner-plus";
import { pickResumable, resumeBudget } from "./resume-core";
import { cachedProfile, loadOps, recentToolCalls, runDailyOps, writeShared } from "./runner-ops";
import { isQuietHour, findDuplicateTask } from "./ops-core";
import { redactSensitive, needsDoubleApproval } from "./safety-plus-core";
import { buildIndex, candidatesFor, clientSubject } from "./memory-plus-core";
import { guardInbound, guardOutbound, prioritizeTasks, preTask, dailyTick } from "./plus8b-hooks";

/**
 * The digital team — server runner. Connects the pure engine to the database, the existing AI router (with
 * routing by kind of work), the existing credits, the real tools, approvals, memory, initiative and the weekly
 * team meeting. Everything is scoped to one business, and nothing runs unless the flag `team_v1` is on for the
 * business AND the business turned the team on AND the emergency stop is off.
 */
type Db = ReturnType<typeof createAdminClient>;
const db = (): Db => createAdminClient();

export interface TeamSettingsRow {
  enabled: boolean;
  emergency_stop: boolean;
  routing_pref: RoutingPref;
  daily_credit_cap: number;
  max_depth: number;
  max_steps: number;
  initiative: boolean;
}

export const DEFAULT_SETTINGS: TeamSettingsRow = { enabled: false, emergency_stop: false, routing_pref: "balanced", daily_credit_cap: 200, max_depth: 3, max_steps: 12, initiative: true };

/* ------------------------------------------------------------------ flag + settings */

/** the feature flag: a row for the business, else the platform-wide row (organization_id null) */
export async function teamFlagOn(orgId: string): Promise<boolean> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return false;
  const { data } = await db().from("feature_flags").select("organization_id, enabled").eq("key", "team_v1").or(`organization_id.eq.${orgId},organization_id.is.null`);
  const rows = (data ?? []) as { organization_id: string | null; enabled: boolean }[];
  const own = rows.find((r) => r.organization_id === orgId);
  return own ? own.enabled : Boolean(rows.find((r) => r.organization_id === null)?.enabled);
}

/** The digital team is a paid feature: the existing "ai_team" plan feature (Pro and up, or an active 7-day trial). */
export async function teamPlanOn(orgId: string): Promise<boolean> {
  const { orgHasFeatureAdmin } = await import("@/lib/billing/features");
  return orgHasFeatureAdmin(orgId, "ai_team").catch(() => false);
}

export async function loadSettings(orgId: string): Promise<TeamSettingsRow> {
  const { data } = await db().from("team_settings").select("enabled, emergency_stop, routing_pref, daily_credit_cap, max_depth, max_steps, initiative").eq("organization_id", orgId).maybeSingle();
  return data ? { ...DEFAULT_SETTINGS, ...(data as Partial<TeamSettingsRow>) } : { ...DEFAULT_SETTINGS };
}

async function dayCredits(orgId: string): Promise<number> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await db().from("team_tasks").select("credits_used").eq("organization_id", orgId).gte("updated_at", since).limit(1000);
  return ((data ?? []) as { credits_used: number }[]).reduce((a, r) => a + (r.credits_used || 0), 0);
}

/* ------------------------------------------------------------------ the live business profile */

export async function loadProfile(orgId: string): Promise<ProfileFacts> {
  const a = db();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [org, agent, products, kb, social, contacts, deals, convs, reviews, posts, sites, msgs, semantic] = await Promise.all([
    a.from("organizations").select("name, locale, timezone, currency").eq("id", orgId).maybeSingle(),
    a.from("ai_agents").select("instructions").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle(),
    a.from("products").select("name, unit_price, description").eq("organization_id", orgId).eq("active", true).order("created_at").limit(15),
    a.from("kb_articles").select("title, body, category").eq("organization_id", orgId).eq("published", true).order("position").limit(10),
    a.from("social_settings").select("brand_voice").eq("organization_id", orgId).maybeSingle(),
    a.from("contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    a.from("deals").select("value").eq("organization_id", orgId).eq("status", "open").limit(500),
    a.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", orgId).gte("created_at", since30),
    a.from("reviews").select("rating").eq("organization_id", orgId).not("rating", "is", null).limit(500),
    a.from("social_posts").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "published").gte("scheduled_at", since30),
    a.from("sites").select("name, status").eq("organization_id", orgId).eq("status", "published").limit(5),
    a.from("messages").select("body").eq("organization_id", orgId).eq("direction", "in").gte("created_at", new Date(Date.now() - 21 * 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(150),
    a.from("team_memory").select("subject, content, kind").eq("organization_id", orgId).is("member_id", null).eq("layer", "semantic").eq("status", "active").limit(40),
  ]);
  const kbRows = (kb.data ?? []) as { title: string; body: string; category: string | null }[];
  const sem = (semantic.data ?? []) as { subject: string | null; content: string; kind: string }[];
  const pick = (re: RegExp) => sem.filter((m) => re.test(`${m.subject ?? ""}`)).map((m) => m.content).join(" · ");
  const ratings = ((reviews.data ?? []) as { rating: number }[]).map((r) => r.rating);
  const { customerSignals } = await import("@/lib/social/brain-plus-core");
  const signals = customerSignals(((msgs.data ?? []) as { body: string | null }[]).map((m) => m.body ?? ""));
  return {
    name: (org.data?.name as string) ?? "",
    locale: (org.data?.locale as string) ?? "he",
    timezone: (org.data?.timezone as string) ?? "Asia/Jerusalem",
    currency: (org.data?.currency as string)?.trim() || "ILS",
    about: String(agent.data?.instructions ?? "").slice(0, 3000),
    audience: pick(/audience|קהל/i),
    tone: String(social.data?.brand_voice ?? "") || pick(/tone|voice|טון/i),
    products: ((products.data ?? []) as { name: string; unit_price: number | string; description: string | null }[]).map((p) => ({ name: p.name, price: Number(p.unit_price) || 0, description: p.description ?? "" })),
    faq: kbRows.filter((k) => !/policy|מדיניות/i.test(k.category ?? "")).map((k) => ({ q: k.title, a: k.body.replace(/\s+/g, " ").slice(0, 400) })),
    policies: [...kbRows.filter((k) => /policy|מדיניות/i.test(k.category ?? "")).map((k) => `${k.title}: ${k.body.replace(/\s+/g, " ").slice(0, 300)}`), ...sem.filter((m) => m.kind === "policy").map((m) => m.content)],
    hours: pick(/hours|שעות/i),
    competitors: pick(/competitor|מתחר/i),
    goals: pick(/goal|יעד/i),
    numbers: {
      contacts: contacts.count ?? 0,
      openDeals: (deals.data ?? []).length,
      pipelineValue: Math.round(((deals.data ?? []) as { value: number }[]).reduce((s, d) => s + Number(d.value || 0), 0)),
      conversations30: convs.count ?? 0,
      reviewsAvg: ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null,
      reviewsCount: ratings.length,
      posts30: posts.count ?? 0,
      sites: ((sites.data ?? []) as { name: string }[]).map((s) => s.name),
    },
    topQuestions: signals.questions,
  };
}

/* ------------------------------------------------------------------ AI with routing by kind of work */

let routingCache: { at: number; rows: Record<string, { provider: string; model: string }[]> } | null = null;
async function routingOverrides(): Promise<Record<string, { provider: string; model: string }[]>> {
  if (routingCache && Date.now() - routingCache.at < 60_000) return routingCache.rows;
  const { data } = await db().from("ai_routing").select("task_kind, models");
  const rows: Record<string, { provider: string; model: string }[]> = {};
  for (const r of (data ?? []) as { task_kind: string; models: unknown }[]) {
    const c = cleanRoutingRow(r.task_kind, r.models);
    if (c) rows[c.kind] = c.models;
  }
  routingCache = { at: Date.now(), rows };
  return rows;
}

/** the provider/model pairs that really have keys (from the existing router) */
export async function availableModels(): Promise<{ provider: string; model: string }[]> {
  const { buildCandidates } = await import("@/lib/ai/router-core");
  return buildCandidates({ env: process.env, random: () => 0 }).map((c) => ({ provider: c.provider, model: c.model }));
}

function teamAi(orgId: string, pref: RoutingPref, onRoute: (kind: TaskKind, chosen: string, used: string) => void): EngineDeps["ai"] {
  return async (kind, system, user, maxTokens) => {
    const [avail, overrides] = await Promise.all([availableModels(), routingOverrides()]);
    const route0 = await healthyRoute(routeFor(kind, avail, { pref, override: overrides[kind] }));
    // upgrade 8: engines that cannot help right now (no key, wrong kind of work, resting, over quota) are left out of THIS attempt
    const route = await import("./runner-plus8").then((m) => m.guardTeamRoute(kind, route0)).catch(() => route0);
    const first = route[0];
    const { runAISystem } = await import("@/lib/ai/run-system");
    const plus8 = await import("./runner-plus8").catch(() => null);
    plus8?.markCallStart(first?.provider);
    const res = await runAISystem({ orgId, feature: "copilot", system, messages: [{ role: "user", content: user }], temperature: kind === "classify" || kind === "review" || kind === "plan" ? 0.2 : 0.6, maxTokens, patienceMs: 30_000, routeProvider: first?.provider ?? null, routeModel: first?.model ?? null });
    // upgrade 2: the circuit breaker learns from every call (a model that keeps failing is skipped for a while)
    // upgrade 8 (bug fix): a call that SUCCEEDED through a fallback no longer counts as a failure of the first engine
    // (it used to be written as "fallback_used" every time, which made every model look sick) — see stability-core.healthUpdates
    const updates = plus8?.healthUpdatesFor({ first: first ? { provider: first.provider, model: first.model } : null, used: res.ok && res.provider && res.model ? { provider: String(res.provider), model: String(res.model) } : null, ok: res.ok, error: res.ok ? null : res.error }) ?? [];
    for (const u of updates) void noteModelResult(u.provider, u.model, u.ok, u.error);
    void plus8?.markCallEnd(res.ok ? String(res.provider ?? first?.provider ?? "") : first?.provider, res.ok, res.ok ? null : res.error);
    if (res.ok) onRoute(kind, first ? `${first.provider}/${first.model}` : "router", `${res.provider}/${res.model}`);
    return res.ok ? { ok: true, text: res.text, credits: res.credits ?? 1, provider: res.provider, model: res.model } : { ok: false, text: "", credits: 0, error: res.error };
  };
}

/* ------------------------------------------------------------------ members + tasks */

interface MemberRow {
  id: string;
  role_key: string;
  name: string;
  tone: string | null;
  instructions: string;
  tools: string[];
  autonomy: "suggest" | "approve" | "auto";
  auto_actions: string[];
  status: "active" | "paused";
  limits: Record<string, number>;
  reports_to: string | null;
  linked: Record<string, string>;
}
const MEMBER_COLS = "id, role_key, name, tone, instructions, tools, autonomy, auto_actions, status, limits, reports_to, linked";

function toEngine(m: MemberRow): EngineMember {
  return { id: m.id, role: isRoleKey(m.role_key) ? m.role_key : "custom", name: m.name, tone: m.tone, instructions: m.instructions, tools: withRoleExtras7c(m.role_key, withRoleExtras7(m.role_key, withRoleExtras(m.role_key, m.tools))), autonomy: m.autonomy, auto_actions: m.auto_actions, status: m.status, limits: { max_steps: m.limits?.max_steps, max_credits: m.limits?.max_credits } };
}

async function members(orgId: string): Promise<MemberRow[]> {
  const { data } = await db().from("team_members").select(MEMBER_COLS).eq("organization_id", orgId).order("position");
  return (data ?? []) as MemberRow[];
}

async function loads(orgId: string): Promise<Map<string, number>> {
  const { data } = await db().from("team_tasks").select("assignee_id").eq("organization_id", orgId).in("status", ["pending", "in_progress", "awaiting_approval", "awaiting_input"]).limit(2000);
  const m = new Map<string, number>();
  for (const r of (data ?? []) as { assignee_id: string | null }[]) if (r.assignee_id) m.set(r.assignee_id, (m.get(r.assignee_id) ?? 0) + 1);
  return m;
}

/** a starter team (manager → lead → workers + quality control), linked to the existing agents */
export async function seedStarterTeam(orgId: string, userId: string, lang: "he" | "en" | "ar"): Promise<number> {
  const a = db();
  // idempotent: only the starter roles the business does not have yet are added (hand-hired employees are kept)
  const { data: existing } = await a.from("team_members").select("id, role_key").eq("organization_id", orgId).order("position");
  const have = (existing ?? []) as { id: string; role_key: string }[];
  if (STARTER_TEAM.every((r) => have.some((m) => m.role_key === r))) return 0;
  const { data: agent } = await a.from("ai_agents").select("id").eq("organization_id", orgId).eq("enabled", true).order("created_at").limit(1).maybeSingle();
  const NAMES: Record<string, Record<RoleKey, string>> = {
    he: { manager: "נועה — מנהלת", team_lead: "איתי — ראש צוות", customer_service: "מאיה — שירות", sales: "דניאל — מכירות", marketing: "שירה — שיווק", content_writer: "יואב — תוכן", web_builder: "עומר — אתרים", analyst: "תמר — נתונים", project_coordinator: "רון — תיאום", quality_control: "גל — בקרת איכות", collections: "אבי — גבייה", reputation: "ליה — מוניטין", custom: "עובד/ת" },
    en: { manager: "Noa — Manager", team_lead: "Itai — Team lead", customer_service: "Maya — Support", sales: "Daniel — Sales", marketing: "Shira — Marketing", content_writer: "Yoav — Content", web_builder: "Omer — Websites", analyst: "Tamar — Data", project_coordinator: "Ron — Coordination", quality_control: "Gal — Quality", collections: "Avi — Collections", reputation: "Lia — Reputation", custom: "Employee" },
    ar: { manager: "نوعا — مديرة", team_lead: "إيتاي — قائد فريق", customer_service: "مايا — خدمة", sales: "دانيال — مبيعات", marketing: "شيرا — تسويق", content_writer: "يوآف — محتوى", web_builder: "عومر — مواقع", analyst: "تمار — بيانات", project_coordinator: "رون — تنسيق", quality_control: "غال — جودة", collections: "أفي — تحصيل", reputation: "ليا — سمعة", custom: "موظف" },
  };
  const ids = new Map<RoleKey, string>();
  for (const m of have) if (!ids.has(m.role_key as RoleKey)) ids.set(m.role_key as RoleKey, m.id);
  let pos = have.length;
  let added = 0;
  for (const role of STARTER_TEAM) {
    if (ids.has(role)) continue;
    const def = ROLES[role];
    const reportsTo = def.reportsTo ? ids.get(def.reportsTo) ?? ids.get("manager") ?? null : null;
    const { data } = await a
      .from("team_members")
      .insert({ organization_id: orgId, role_key: role, name: NAMES[lang]![role], avatar: def.avatar, tools: def.tools, autonomy: def.autonomy, reports_to: reportsTo, position: pos++, linked: role === "customer_service" && agent ? { ai_agent_id: agent.id } : {}, created_by: userId })
      .select("id")
      .single();
    if (data) {
      ids.set(role, data.id as string);
      added++;
    }
  }
  return added;
}

async function chainOf(orgId: string, parentId: string | null): Promise<{ role: string; title: string }[]> {
  const out: { role: string; title: string }[] = [];
  let cur = parentId;
  for (let i = 0; cur && i < 6; i++) {
    const { data } = await db().from("team_tasks").select("parent_id, title, team_members(role_key)").eq("organization_id", orgId).eq("id", cur).maybeSingle();
    if (!data) break;
    const tm = (data as { team_members?: { role_key?: string } | { role_key?: string }[] | null }).team_members;
    out.push({ role: (Array.isArray(tm) ? tm[0]?.role_key : tm?.role_key) ?? "", title: (data.title as string) ?? "" });
    cur = (data.parent_id as string | null) ?? null;
  }
  return out;
}

async function logActivity(orgId: string, taskId: string | null, memberId: string | null, phase: string, summary: string, details: Record<string, unknown> = {}, ok = true, actorUser: string | null = null) {
  // upgrade 3: card / ID / IBAN / secret-looking numbers never reach the log (e-mail and phone stay — the team needs them)
  const mask = (x: unknown): unknown => (typeof x === "string" ? redactSensitive(x).text : Array.isArray(x) ? x.map(mask) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, mask(v)])) : x);
  await db().from("team_activity").insert({ organization_id: orgId, task_id: taskId, member_id: memberId, actor_user: actorUser, phase, summary: redactSensitive(summary).text.slice(0, 1000) || "—", details: mask(details) as Record<string, unknown>, ok }).then(
    () => undefined,
    () => undefined,
  );
}

async function memoriesFor(orgId: string, memberId: string | null): Promise<MemoryItem[]> {
  let q = db().from("team_memory").select("id, member_id, layer, kind, subject, content, tags, confidence, status, expires_at, created_at, uses").eq("organization_id", orgId).eq("status", "active").order("created_at", { ascending: false }).limit(300);
  q = memberId ? q.or(`member_id.is.null,member_id.eq.${memberId}`) : q.is("member_id", null);
  const { data } = await q;
  return (data ?? []) as MemoryItem[];
}

/** writes memories with contradiction resolution (same subject → the older one expires) */
export async function writeMemories(orgId: string, memberId: string | null, items: { layer: "episodic" | "semantic"; kind: MemoryItem["kind"]; content: string; subject?: string | null; confidence: number; status: "active" | "proposed" }[]) {
  if (!items.length) return;
  const existing = await memoriesFor(orgId, memberId);
  for (const it of items) {
    const old = it.status === "active" ? supersededBy({ subject: it.subject ?? null, member_id: memberId, layer: it.layer }, existing) : [];
    const { data } = await db().from("team_memory").insert({ organization_id: orgId, member_id: memberId, layer: it.layer, kind: it.kind, subject: it.subject ?? null, content: it.content.slice(0, 2000), confidence: it.confidence, source: it.kind === "outcome" ? "agent" : "feedback", status: it.status, supersedes: old[0] ?? null, expires_at: it.layer === "episodic" ? new Date(Date.now() + 120 * 86_400_000).toISOString() : null }).select("id").single();
    if (data && old.length) await db().from("team_memory").update({ status: "expired", updated_at: new Date().toISOString() }).eq("organization_id", orgId).in("id", old);
  }
}

/* ------------------------------------------------------------------ run ONE task */

export async function runTask(orgId: string, taskId: string, opts: { interactive: boolean; actorUser: string | null }): Promise<Outcome | { notRun: string }> {
  if (!(await teamFlagOn(orgId))) return { notRun: "team_flag_off" };
  if (!(await teamPlanOn(orgId))) return { notRun: "plan_locked" };
  const a = db();
  // claim: only a pending task, once
  const { data: claimed } = await a.from("team_tasks").update({ status: "in_progress", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", taskId).eq("status", "pending").select("id, parent_id, goal_id, title, brief, assignee_id, depth, steps_used, credits_used, review_rounds, result, created_by").maybeSingle();
  if (!claimed) return { notRun: "not_pending" };
  // upgrade 6: independent reads start together (was one after another)
  const [settings, all] = await Promise.all([loadSettings(orgId), members(orgId)]);
  const row = all.find((m) => m.id === claimed.assignee_id);
  if (!row) {
    await a.from("team_tasks").update({ status: "blocked", error: "no_assignee", updated_at: new Date().toISOString() }).eq("id", taskId);
    return { notRun: "no_assignee" };
  }
  const member = toEngine(row);
  const { data: org } = await a.from("organizations").select("locale, timezone").eq("id", orgId).maybeSingle();
  const lang = (org?.locale === "en" || org?.locale === "ar" ? org.locale : "he") as "he" | "en" | "ar";
  const actorUser = opts.actorUser ?? (claimed.created_by as string | null) ?? null;
  const reviewerRow = all.find((m) => m.role_key === "quality_control" && m.status === "active") ?? all.find((m) => m.id === row.reports_to && m.status === "active") ?? null;
  const routes: { kind: string; chosen: string; used: string }[] = [];
  const [{ data: extra }, { data: reviewerExtra }] = await Promise.all([
    a.from("team_playbooks").select("extra").eq("organization_id", orgId).eq("role_key", member.role).maybeSingle(),
    reviewerRow ? a.from("team_playbooks").select("extra").eq("organization_id", orgId).eq("role_key", reviewerRow.role_key).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const log = (phase: string, summary: string, details: Record<string, unknown> = {}, ok = true) => logActivity(orgId, taskId, member.id, phase, summary, details, ok);
  const ops = await loadOps(orgId);
  const orgTz = org; // same row (one query instead of two)
  // upgrade 8 (part B contract): extra context from the pre-task hook (empty with the stub) — added to the worker's business context
  let extraCtx = "";
  const deps: EngineDeps = {
    ops: { quietEnabled: ops.quiet.enabled, quietNow: ops.quiet.enabled && isQuietHour(Date.now(), (orgTz?.timezone as string) || "Asia/Jerusalem", ops.quiet.start, ops.quiet.end), rateLimits: ops.protect.rateLimits, anomalyFreeze: ops.protect.anomalyFreeze, recipientCap: ops.protect.recipientCap },
    recentCalls: (tool, sinceMs) => recentToolCalls(orgId, member.id, tool, sinceMs),
    share: (items) => writeShared(orgId, items),
    rememberClient: (contactId, items) => writeShared(orgId, items.map((i) => ({ ...i, subject: i.subject.startsWith(clientSubject(contactId)) ? i.subject : `${clientSubject(contactId)}:${i.subject}` }))),
    lang,
    interactive: opts.interactive,
    ai: teamAi(orgId, settings.routing_pref, (kind, chosen, used) => routes.push({ kind, chosen, used })),
    runTool: async (tool, args) => {
      // upgrade 8 (part B contract): text that leaves the business passes the outbound guard; if it is not ok it becomes an approval
      const outTool = TOOL_MAP[tool] && (TOOL_MAP[tool]!.sensitivity === "customer" || TOOL_MAP[tool]!.sensitivity === "money");
      const key = typeof args.text === "string" ? "text" : typeof args.body === "string" ? "body" : null;
      if (outTool && key) {
        try {
          const g = guardOutbound(String(args[key]));
          if (!g.ok) {
            const id = await deps.approval({ tool, payload: { ...args, [key]: g.text }, preview: g.text.slice(0, 1500), reason: g.reasons.join("; ").slice(0, 400) || "outbound_guard", sensitivity: TOOL_MAP[tool]!.sensitivity });
            return { ok: true, summary: id ? "held for the owner's approval (outbound check)" : "held (outbound check)" };
          }
          if (g.text !== args[key]) args = { ...args, [key]: g.text };
        } catch {
          /* the guard never blocks the team by failing */
        }
      }
      const r = await runTeamTool(orgId, tool, args, { actorUser, locale: lang, interactive: opts.interactive });
      // customer text read by a tool passes the inbound guard before it reaches the worker's context
      if (r.ok && r.summary && ["inbox.unanswered", "crm.contact_brief", "reviews.recent", "crm.find_contacts"].includes(tool)) {
        try {
          r.summary = guardInbound(r.summary).text;
        } catch {
          /* optional */
        }
      }
      return r;
    },
    log: (phase, summary, details, ok) => log(phase, summary, details, ok),
    approval: async (input) => {
      const { data } = await a.from("team_approvals").insert({ organization_id: orgId, task_id: taskId, member_id: member.id, tool: input.tool, payload: input.payload, preview: input.preview.slice(0, 4000), reason: input.reason.slice(0, 2000), sensitivity: ["internal", "customer", "irreversible", "money"].includes(input.sensitivity) ? input.sensitivity : "customer" }).select("id").single();
      return (data?.id as string) ?? null;
    },
    handoff: async (input) => {
      if (!isRoleKey(input.role)) return { ok: false, error: "unknown_role" };
      const l = await loads(orgId);
      const target = all.filter((m) => m.role_key === input.role && m.status === "active").sort((x, y) => (l.get(x.id) ?? 0) - (l.get(y.id) ?? 0))[0];
      if (!target) return { ok: false, error: "no_employee_with_role" };
      // upgrade 3: the same work is not handed over twice (only between employees — the owner's own tasks are never blocked)
      if (ops.dedupe) {
        const { data: open } = await a.from("team_tasks").select("id, title, assignee_id").eq("organization_id", orgId).eq("assignee_id", target.id).in("status", ["pending", "in_progress", "awaiting_approval", "awaiting_input"]).limit(200);
        const dup = findDuplicateTask({ role: input.role, title: input.title }, ((open ?? []) as { id: string; title: string }[]).map((o) => ({ id: o.id, role: input.role, title: o.title })));
        if (dup) return { ok: true, taskId: dup };
      }
      const { data } = await a.from("team_tasks").insert({ organization_id: orgId, parent_id: taskId, goal_id: claimed.goal_id ?? null, title: input.title.slice(0, 300), brief: input.brief.slice(0, 6000), assignee_id: target.id, depth: (claimed.depth as number) + 1, origin: "handoff", created_by: actorUser }).select("id").single();
      if (!data) return { ok: false, error: "create_failed" };
      await a.from("team_messages").insert({ organization_id: orgId, task_id: data.id, from_member: member.id, to_member: target.id, kind: "handoff", body: { title: input.title, brief: input.brief.slice(0, 2000), from_task: taskId } });
      return { ok: true, taskId: data.id as string };
    },
    message: async (kind, toMember, body) => {
      await a.from("team_messages").insert({ organization_id: orgId, task_id: taskId, from_member: member.id, to_member: toMember, kind, body });
    },
    remember: (items) => writeMemories(orgId, member.id, items),
    context: async (): Promise<TeamContext> => {
      const profile = await cachedProfile(orgId, () => loadProfile(orgId));
      const allMemories = await memoriesFor(orgId, member.id);
      // a long memory list is narrowed to what shares terms with the task (hard rules always stay)
      const memories = allMemories.length > 150 ? candidatesFor(buildIndex(allMemories), `${claimed.title as string} ${(claimed.brief as string) ?? ""}`, 80) : allMemories;
      // upgrade 7: versioned business facts relevant to this task (empty when none / migration not run)
      const goalsBlock = member.role === "manager" || member.role === "analyst" ? await import("./goals").then((m) => m.goalsPromptFor(orgId, lang)).catch(() => "") : "";
      const factsBlock0 = await import("./business-facts").then((m) => m.factsPromptFor(orgId, `${claimed.title as string} ${(claimed.brief as string) ?? ""}`)).catch(() => "");
      const factsBlock = [factsBlock0, goalsBlock, extraCtx].filter(Boolean).join("\n\n");
      return { profile: factsBlock ? `${profilePrompt(profile)}\n\n${factsBlock}` : profilePrompt(profile), known: knownFacts(profile), memories, playbookExtra: (extra?.extra as string) ?? "", reviewer: reviewerRow && reviewerRow.id !== member.id ? toEngine(reviewerRow) : null, reviewerExtra: (reviewerExtra as { extra?: string } | null)?.extra ?? "" };
    },
  };
  const safeBrief = (() => {
    try {
      return guardInbound(((claimed.brief as string) ?? "")).text;
    } catch {
      return (claimed.brief as string) ?? "";
    }
  })();
  const task: EngineTask = { id: taskId, title: claimed.title as string, brief: safeBrief, depth: claimed.depth as number, steps_used: claimed.steps_used as number, credits_used: claimed.credits_used as number, review_rounds: claimed.review_rounds as number, chain: await chainOf(orgId, (claimed.parent_id as string | null) ?? null), answer: ((claimed.result as Record<string, unknown>)?.answer as string | undefined) ?? null };
  const engineSettings: EngineSettings = { enabled: settings.enabled, emergency_stop: settings.emergency_stop, max_depth: settings.max_depth, max_steps: settings.max_steps, daily_credit_cap: settings.daily_credit_cap, day_credits: await dayCredits(orgId) };
  // upgrade 8 (part B contract): pre-task hook — extra context, or a stop that needs the owner's approval (a failure never stops the task)
  try {
    const pre = await preTask({ orgId, taskId, memberRole: member.role, title: task.title, brief: task.brief, lang });
    if (pre.extraContext) extraCtx = pre.extraContext.slice(0, 4000);
    if (pre.blocked) {
      const reason = pre.blocked.reason.slice(0, 600);
      const id = await deps.approval({ tool: "team.ask_user", payload: { question: reason }, preview: reason, reason, sensitivity: "internal" });
      await a.from("team_tasks").update({ status: "awaiting_approval", result: { ...((claimed.result as Record<string, unknown>) ?? {}), approvals: id ? [id] : [], held_by: "pre_task" }, updated_at: new Date().toISOString() }).eq("id", taskId);
      await log("approval", reason, { held_by: "pre_task" });
      return { status: "awaiting_approval", report: reason, output: null, question: null, credits: 0, steps: task.steps_used, approvals: id ? [id] : [], handoffs: [], error: null, plan: null } as Outcome;
    }
  } catch {
    /* part B is optional — the task runs as usual */
  }
  // upgrade 7 (stages D + E): understanding + decision layer around the unchanged work cycle (fails soft)
  const { layerDeps, foldHeld } = await import("./runner-plus7");
  const layer = await layerDeps(orgId, deps, member, task);
  const out0 = await runEmployeeTask(layer.deps, member, task, engineSettings).catch((e: Error) => ({ status: "failed", report: "", output: null, question: null, credits: 0, steps: 0, approvals: [], handoffs: [], error: e.message.slice(0, 300), plan: null }) as Outcome);
  const out = foldHeld(out0, layer.held());
  // routing transparency: which engine was chosen and which one answered (a fallback is visible in the log)
  const fallbacks = routes.filter((r) => r.chosen !== "router" && r.chosen !== r.used);
  if (fallbacks.length) await log("system", `Model fallback used ${fallbacks.length}× (${fallbacks.map((f) => `${f.kind}: ${f.chosen} → ${f.used}`).join("; ")}).`, { routes: fallbacks });
  const status = out.status === "done" && out.handoffs.length ? "done" : out.status === "blocked" ? "blocked" : out.status;
  // upgrade 8: a task that only needs a connection is "requires_connection" (not "failed"); the failure kind is stored for the screen
  const fin = await import("./runner-plus8").then((m) => m.finishPatch(status, out.error)).catch(() => ({ status } as { status: string; failure_kind?: string }));
  const writeFinal = (withKind: boolean) =>
    a
      .from("team_tasks")
      .update({
      status: fin.status === "awaiting_input" ? "awaiting_input" : fin.status,
      ...(withKind && fin.failure_kind ? { failure_kind: fin.failure_kind } : {}),
      question: out.question,
      steps_used: out.steps,
      credits_used: (claimed.credits_used as number) + out.credits,
      plan: out.plan ? (out.plan as unknown as Record<string, unknown>) : {},
      result: { ...((claimed.result as Record<string, unknown>) ?? {}), report: out.report, output: out.output, approvals: out.approvals, handoffs: out.handoffs, routes: routes.slice(0, 12) },
      error: out.error,
      updated_at: new Date().toISOString(),
      finished_at: ["done", "failed", "blocked", "requires_connection"].includes(fin.status) ? new Date().toISOString() : null,
    })
      .eq("id", taskId);
  const wrote = await writeFinal(true);
  // migration 8 not applied yet (status CHECK / column missing): write the original status exactly as before
  if (wrote.error) {
    fin.status = status;
    delete fin.failure_kind;
    await writeFinal(false);
  }
  if (claimed.goal_id) await refreshGoal(orgId, claimed.goal_id as string);
  return out;
}

/* ------------------------------------------------------------------ goals (the manager plans) */

export async function planGoal(orgId: string, goal: string, actorUser: string): Promise<{ ok: true; goalId: string } | { ok: false; error: string }> {
  if (!(await teamFlagOn(orgId))) return { ok: false, error: "aiTeam.err.flagOff" };
  const settings = await loadSettings(orgId);
  if (!settings.enabled) return { ok: false, error: "aiTeam.err.off" };
  if (settings.emergency_stop) return { ok: false, error: "aiTeam.err.stopped" };
  const all = (await members(orgId)).filter((m) => m.status === "active");
  const manager = all.find((m) => m.role_key === "manager");
  if (!manager) return { ok: false, error: "aiTeam.err.noManager" };
  const l = await loads(orgId);
  const profile = await loadProfile(orgId);
  const roles = all.filter((m) => m.role_key !== "manager").map((m) => ({ role: (isRoleKey(m.role_key) ? m.role_key : "custom") as RoleKey, name: m.name, load: l.get(m.id) ?? 0 }));
  // upgrade 8: the same goal is not planned twice, and new titles are written in the business's language
  const plus8 = await import("./runner-plus8").catch(() => null);
  const existingGoal = plus8 ? await plus8.existingTaskFor(orgId, { title: goal, assignee: manager.id }) : null;
  if (existingGoal) return { ok: true, goalId: existingGoal };
  const titleLang = profile.locale === "en" || profile.locale === "ar" ? profile.locale : "he";
  const system = [`You are ${manager.name}, the general manager of this business's AI team.`, playbookPrompt("manager"), WORKING_DOCTRINE, expertisePrompt("manager"), SAFETY_RULES, plus8 ? plus8.titleInstruction(titleLang) : "", `THE BUSINESS:\n${profilePrompt(profile)}`].filter(Boolean).join("\n\n");
  const ai = teamAi(orgId, settings.routing_pref, () => undefined);
  const res = await ai("plan", system, goalPrompt(goal, roles), 1800);
  if (!res.ok) return { ok: false, error: res.error ?? "ai.failed" };
  const available = [...new Set(roles.map((r) => r.role))];
  const plan = parseGoalPlan(res.text, available.length ? available : ["custom"]);
  if (!plan || (!plan.tasks.length && !plan.question)) return { ok: false, error: "aiTeam.err.planUnreadable" };
  const who = assign(plan.tasks, all.map((m) => ({ id: m.id, role: (isRoleKey(m.role_key) ? m.role_key : "custom") as RoleKey, status: m.status, load: l.get(m.id) ?? 0 })));
  const { data } = await db()
    .from("team_tasks")
    .insert({ organization_id: orgId, title: goal.slice(0, 300), brief: plan.understanding, assignee_id: manager.id, status: "draft", origin: "user", question: plan.question, credits_used: res.credits, plan: { goal: true, understanding: plan.understanding, tasks: plan.tasks.map((t) => ({ ...t, assignee: who[t.key] })), risks: plan.risks, estimate: plan.estimate }, created_by: actorUser })
    .select("id")
    .single();
  if (!data) return { ok: false, error: "common.error" };
  await logActivity(orgId, data.id as string, manager.id, "plan", `Plan for "${goal.slice(0, 120)}": ${plan.tasks.length} tasks, est. ${plan.estimate} credits.`, { tasks: plan.tasks.length }, true, actorUser);
  return { ok: true, goalId: data.id as string };
}

/** the owner approved the manager's plan → the tasks go on the board with their real dependencies */
export async function confirmGoal(orgId: string, goalId: string, actorUser: string): Promise<{ ok: boolean; error?: string; created?: number }> {
  const a = db();
  const { data: goal } = await a.from("team_tasks").select("id, plan, status, assignee_id").eq("organization_id", orgId).eq("id", goalId).maybeSingle();
  if (!goal || goal.status !== "draft") return { ok: false, error: "aiTeam.err.notDraft" };
  const plan = (goal.plan ?? {}) as { tasks?: { key: string; title: string; brief: string; role: string; depends_on: string[]; priority: number; assignee: string | null }[] };
  const tasks = plan.tasks ?? [];
  const ids = new Map<string, string>();
  const plus8 = await import("./runner-plus8").catch(() => null);
  for (const t of tasks) {
    // upgrade 8: an open task with the same intent for the same employee is reused instead of creating a duplicate
    const same = plus8 ? await plus8.existingTaskFor(orgId, { title: t.title, assignee: t.assignee }) : null;
    if (same) {
      ids.set(t.key, same);
      continue;
    }
    const { data } = await a.from("team_tasks").insert({ organization_id: orgId, parent_id: goalId, goal_id: goalId, plan_key: t.key.slice(0, 40), title: t.title, brief: t.brief, assignee_id: t.assignee, priority: t.priority, status: "pending", depth: 1, origin: "goal", created_by: actorUser }).select("id").single();
    if (data) ids.set(t.key, data.id as string);
  }
  for (const t of tasks) {
    const deps = t.depends_on.map((k) => ids.get(k)).filter((x): x is string => Boolean(x));
    if (deps.length && ids.get(t.key)) await a.from("team_tasks").update({ depends_on: deps }).eq("id", ids.get(t.key)!);
  }
  await a.from("team_tasks").update({ status: "in_progress", started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", goalId);
  await logActivity(orgId, goalId, goal.assignee_id as string, "deliver", `Plan approved — ${ids.size} tasks on the board.`, {}, true, actorUser);
  return { ok: true, created: ids.size };
}

/** the manager's executive summary of a finished goal: one prioritised answer instead of a list of task reports (best effort) */
async function synthesizeGoal(orgId: string, managerId: string | null, title: string, rows: { title: string; status: string; result: { report?: string; output?: string } }[]): Promise<string | null> {
  const done = rows.filter((r) => r.status === "done");
  if (done.length < 2) return null;
  const settings = await loadSettings(orgId);
  if (!settings.enabled || settings.emergency_stop) return null;
  const { data: m } = managerId ? await db().from("team_members").select("name").eq("id", managerId).maybeSingle() : { data: null };
  const profile = await loadProfile(orgId);
  const system = [`You are ${(m?.name as string) ?? "the manager"}, the general manager of this business's AI team. Write for the business owner in the business's language.`, WORKING_DOCTRINE, expertisePrompt("manager"), SAFETY_RULES, `THE BUSINESS:\n${profilePrompt(profile)}`].join("\n\n");
  const material = done.map((r, i) => `${i + 1}. ${r.title}\n${asData("task result", String(r.result?.output ?? r.result?.report ?? "").slice(0, 2500), 2500)}`).join("\n\n");
  const user = [`GOAL: ${title.slice(0, 300)}`, "Your team finished its tasks. Their results:", material, "Now synthesise ONE executive summary for the owner. Combine the findings, resolve contradictions, rank what matters by impact and effort, and say what is still unknown.", REPORT_STANDARD, "Answer with the final text only."].join("\n\n");
  const ai = teamAi(orgId, settings.routing_pref, () => undefined);
  const res = await ai("summarize", system, user, 2200);
  return res.ok && res.text.trim().length > 20 ? res.text.trim().slice(0, 8000) : null;
}

/** goal status from its tasks; when all are done the manager writes the summary report */
async function refreshGoal(orgId: string, goalId: string) {
  const a = db();
  const { data: goal } = await a.from("team_tasks").select("id, title, status, assignee_id, result").eq("id", goalId).maybeSingle();
  if (!goal || !["in_progress", "blocked"].includes(goal.status as string)) return;
  const { data } = await a.from("team_tasks").select("id, title, status, result").eq("goal_id", goalId).neq("id", goalId);
  const rows = ((data ?? []) as { id: string; title: string; status: string; result: { report?: string } }[]).filter((r) => r.status !== "merged");
  if (!rows.length) return;
  // upgrade 8: "merged" duplicates are ignored, "requires_connection" counts as stopped (not as still running)
  const open = rows.filter((r) => !["done", "failed", "canceled", "blocked", "requires_connection", "merged"].includes(r.status));
  if (open.length) return;
  const failed = rows.filter((r) => r.status === "failed" || r.status === "blocked" || r.status === "requires_connection");
  const report = rows.map((r) => `${r.status === "done" ? "✅" : "⚠️"} ${r.title}: ${(r.result?.report ?? r.status).slice(0, 300)}`).join("\n");
  const synthesis = await synthesizeGoal(orgId, goal.assignee_id as string | null, goal.title as string, rows).catch(() => null);
  await a.from("team_tasks").update({ status: failed.length === rows.length ? "failed" : "done", result: { ...((goal.result as Record<string, unknown>) ?? {}), report, ...(synthesis ? { summary: synthesis } : {}), done: rows.length - failed.length, failed: failed.length }, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", goalId);
  await logActivity(orgId, goalId, goal.assignee_id as string, "learn", `Goal finished: ${rows.length - failed.length}/${rows.length} tasks done.`, { failed: failed.length });
}

/* ------------------------------------------------------------------ approvals (the owner decides) */

export async function decideApproval(orgId: string, approvalId: string, decision: { kind: "approve" | "reject" | "edit"; note?: string; text?: string }, userId: string): Promise<{ ok: boolean; error?: string; result?: string }> {
  const a = db();
  const { data: ap } = await a.from("team_approvals").select("id, task_id, member_id, tool, payload, preview, status, sensitivity").eq("organization_id", orgId).eq("id", approvalId).maybeSingle();
  if (!ap || ap.status !== "pending") return { ok: false, error: "aiTeam.err.approvalGone" };
  const settings = await loadSettings(orgId);
  if (settings.emergency_stop && decision.kind !== "reject") return { ok: false, error: "aiTeam.err.stopped" };
  const payload = { ...((ap.payload ?? {}) as Record<string, unknown>) };
  const before = String(payload.text ?? payload.body ?? ap.preview ?? "");
  if (decision.kind === "edit" && decision.text) {
    if ("text" in payload) payload.text = decision.text;
    else if ("body" in payload) payload.body = decision.text;
    else payload.text = decision.text;
  }
  const now = new Date().toISOString();
  // upgrade 3: money / irreversible actions need a SECOND explicit confirmation (a fresh click). Without the new column
  // (migration not run) this step is skipped and the single approval works exactly as before.
  if (decision.kind !== "reject" && needsDoubleApproval(String(ap.sensitivity ?? ""))) {
    const { data: conf, error: confErr } = await a.from("team_approvals").select("confirmations").eq("id", ap.id).maybeSingle();
    const have = confErr ? null : Number((conf as { confirmations?: number } | null)?.confirmations ?? 0);
    if (have !== null && have < 1) {
      const patch: Record<string, unknown> = { confirmations: 1 };
      if (decision.kind === "edit" && decision.text) patch.payload = payload; // the edited text is what the second click confirms
      await a.from("team_approvals").update(patch).eq("id", ap.id).eq("status", "pending");
      await logActivity(orgId, ap.task_id as string, ap.member_id as string, "approval", `First confirmation (${String(ap.sensitivity)}) — a second confirmation is needed before it runs.`, { tool: ap.tool, sensitivity: ap.sensitivity }, true, userId);
      return { ok: true, result: "second_needed" };
    }
  }
  if (decision.kind === "reject") {
    await a.from("team_approvals").update({ status: "rejected", decided_by: userId, decided_at: now, decision_note: decision.note?.slice(0, 1000) ?? null }).eq("id", ap.id);
    await writeMemories(orgId, (ap.member_id as string | null) ?? null, learnFromFeedback({ tool: ap.tool as string, preview: before, feedback: { kind: "rejected", note: decision.note } }));
    await logActivity(orgId, ap.task_id as string, ap.member_id as string, "approval", `Rejected by the owner${decision.note ? `: ${decision.note.slice(0, 200)}` : ""}.`, { tool: ap.tool }, true, userId);
  } else {
    const v = TOOL_MAP[ap.tool as string] ? validateArgs(ap.tool as string, payload) : null;
    let result: { ok: boolean; summary: string; error?: string } = { ok: true, summary: "noted" };
    if (v && v.ok && ap.tool !== "team.ask_user") {
      const { data: org } = await a.from("organizations").select("locale").eq("id", orgId).maybeSingle();
      result = await runTeamTool(orgId, ap.tool as string, v.args, { actorUser: userId, locale: (org?.locale as string) ?? "he", interactive: true });
    } else if (v && !v.ok) result = { ok: false, summary: "", error: v.error };
    const edited = decision.kind === "edit" && Boolean(decision.text) && decision.text !== before;
    await a.from("team_approvals").update({ status: result.ok ? "executed" : "failed", decided_by: userId, decided_at: now, decision_note: decision.note?.slice(0, 1000) ?? null, edited_payload: edited ? payload : null, result: { ok: result.ok, summary: result.summary, error: result.error ?? null } }).eq("id", ap.id);
    await writeMemories(orgId, (ap.member_id as string | null) ?? null, learnFromFeedback({ tool: ap.tool as string, preview: before, feedback: edited ? { kind: "edited", before, after: decision.text!, note: decision.note } : { kind: "approved" } }));
    await logActivity(orgId, ap.task_id as string, ap.member_id as string, "approval", result.ok ? `Approved${edited ? " (edited)" : ""} and done: ${result.summary.slice(0, 200)}` : `Approved but failed: ${result.error}`, { tool: ap.tool, edited }, result.ok, userId);
    if (!result.ok) return { ok: false, error: "aiTeam.err.executeFailed", result: result.error };
  }
  // the task is finished when nothing waits for the owner any more
  if (ap.task_id) {
    const { count } = await a.from("team_approvals").select("id", { count: "exact", head: true }).eq("task_id", ap.task_id).eq("status", "pending");
    if (!count) {
      const { data: t } = await a.from("team_tasks").update({ status: "done", finished_at: now, updated_at: now }).eq("id", ap.task_id).eq("status", "awaiting_approval").select("goal_id").maybeSingle();
      if (t?.goal_id) await refreshGoal(orgId, t.goal_id as string);
    }
  }
  return { ok: true };
}

/** the owner answered an employee's question → the task runs again with the answer */
export async function answerQuestion(orgId: string, taskId: string, answer: string): Promise<boolean> {
  const a = db();
  const { data: t } = await a.from("team_tasks").select("result, status").eq("organization_id", orgId).eq("id", taskId).maybeSingle();
  if (!t || t.status !== "awaiting_input") return false;
  const { error } = await a.from("team_tasks").update({ status: "pending", result: { ...((t.result as Record<string, unknown>) ?? {}), answer: answer.slice(0, 2000) }, question: null, updated_at: new Date().toISOString() }).eq("id", taskId);
  return !error;
}

/* ------------------------------------------------------------------ the clock: ready tasks, initiative, meeting */

async function signals(orgId: string, tz: string): Promise<Signals> {
  const a = db();
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const [{ data: leads }, { count: badReviews }, { data: convs }, { count: stuck }, { count: overdue }, { data: lastPost }] = await Promise.all([
    a.from("contacts").select("id").eq("organization_id", orgId).eq("status", "lead").gte("created_at", day(1)).lt("created_at", new Date(Date.now() - 2 * 3_600_000).toISOString()).limit(50),
    a.from("reviews").select("id", { count: "exact", head: true }).eq("organization_id", orgId).lte("rating", 3).is("reply", null).gte("created_at", day(14)),
    a.from("conversations").select("contact_id, last_customer_at, last_human_at, last_ai_at, last_auto_at").eq("organization_id", orgId).eq("status", "open").gte("last_customer_at", day(7)).limit(300),
    a.from("deals").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "open").lt("updated_at", day(7)),
    a.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("kind", "invoice").in("status", ["sent", "accepted"]).lt("due_date", new Date().toISOString().slice(0, 10)),
    a.from("social_posts").select("scheduled_at").eq("organization_id", orgId).eq("status", "published").order("scheduled_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const t = (v: string | null) => (v ? Date.parse(v) : 0);
  const rows = (convs ?? []) as { contact_id: string | null; last_customer_at: string; last_human_at: string | null; last_ai_at: string | null; last_auto_at: string | null }[];
  const answered = new Set(rows.filter((c) => Math.max(t(c.last_human_at), t(c.last_ai_at), t(c.last_auto_at)) > 0).map((c) => c.contact_id));
  const robots = await automatedContactIds(orgId, rows.map((c) => c.contact_id)).catch(() => new Set<string>());
  const waiting = rows.filter((c) => !(c.contact_id && robots.has(c.contact_id)) && t(c.last_customer_at) < Date.now() - 30 * 60_000 && t(c.last_customer_at) > Math.max(t(c.last_human_at), t(c.last_ai_at), t(c.last_auto_at))).length;
  let leadsY = 0;
  let leadsAvg = 0;
  try {
    const { metricsFor } = await import("@/lib/agents/run");
    const m = await metricsFor(orgId, tz);
    leadsY = m.y.leads;
    leadsAvg = m.avg.leads;
  } catch {
    /* metrics are best effort */
  }
  return {
    newLeadsUncontacted: ((leads ?? []) as { id: string }[]).filter((l) => !answered.has(l.id)).length,
    negativeReviewsOpen: badReviews ?? 0,
    unansweredConversations: waiting,
    stuckDeals: stuck ?? 0,
    overdueInvoices: overdue ?? 0,
    leadsYesterday: leadsY,
    leadsAvg,
    daysSinceLastPost: lastPost?.scheduled_at ? Math.floor((Date.now() - Date.parse(lastPost.scheduled_at as string)) / 86_400_000) : null,
  };
}

async function runInitiative(orgId: string, tz: string) {
  const a = db();
  const day = new Date().toLocaleDateString("en-CA", { timeZone: tz || "Asia/Jerusalem" });
  const all = (await members(orgId)).filter((m) => m.status === "active");
  const proposals = initiatives(await signals(orgId, tz), day);
  for (const p of proposals) {
    const key = `init-${p.key.split(":")[0]}-${day.replace(/-/g, "")}`.slice(0, 40);
    const { count } = await a.from("team_tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("plan_key", key);
    if (count) continue;
    const m = all.find((x) => x.role_key === p.role);
    if (!m) continue;
    // "suggest only" employees propose (the owner starts it); the others start — customer actions still wait for approval
    await a.from("team_tasks").insert({ organization_id: orgId, plan_key: key, title: p.title, brief: p.brief, assignee_id: m.id, priority: p.priority, status: m.autonomy === "suggest" ? "draft" : "pending", origin: "initiative" });
    await logActivity(orgId, null, m.id, "initiative", `${m.name} noticed: ${p.title}`, { key: p.key });
  }
}

/** member stats of the last 30 days (for the cards, the performance dashboard and the meeting) */
export async function teamStats(orgId: string): Promise<Record<string, MemberStats>> {
  const a = db();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: tasks }, { data: approvals }] = await Promise.all([
    a.from("team_tasks").select("assignee_id, status, credits_used, started_at, finished_at, question").eq("organization_id", orgId).gte("created_at", since).limit(3000),
    a.from("team_approvals").select("member_id, status, edited_payload").eq("organization_id", orgId).gte("created_at", since).limit(3000),
  ]);
  const by = new Map<string, { tasks: { status: string; credits_used: number; started_at: string | null; finished_at: string | null; question: string | null }[]; approvals: { status: string; edited: boolean }[] }>();
  const get = (id: string) => by.get(id) ?? by.set(id, { tasks: [], approvals: [] }).get(id)!;
  for (const t of (tasks ?? []) as { assignee_id: string | null; status: string; credits_used: number; started_at: string | null; finished_at: string | null; question: string | null }[]) if (t.assignee_id) get(t.assignee_id).tasks.push(t);
  for (const x of (approvals ?? []) as { member_id: string | null; status: string; edited_payload: unknown }[]) if (x.member_id) get(x.member_id).approvals.push({ status: x.status, edited: x.edited_payload !== null });
  const out: Record<string, MemberStats> = {};
  for (const [id, v] of by) out[id] = memberStats(v);
  return out;
}

async function weeklyMeeting(orgId: string, tz: string) {
  const a = db();
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz || "Asia/Jerusalem" }));
  if (local.getDay() !== 0 || local.getHours() < 8) return;
  const key = `meeting-${now.toISOString().slice(0, 10).replace(/-/g, "")}`;
  const { count } = await a.from("team_tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("plan_key", key);
  if (count) return;
  const all = await members(orgId);
  const manager = all.find((m) => m.role_key === "manager");
  if (!manager) return;
  const stats = await teamStats(orgId);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: learn }, { count: pending }, { count: blocked }] = await Promise.all([
    a.from("team_memory").select("content, member_id, status").eq("organization_id", orgId).gte("created_at", since).in("status", ["proposed", "active"]).eq("layer", "semantic").limit(30),
    a.from("team_approvals").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "pending"),
    a.from("team_tasks").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "blocked"),
  ]);
  const facts = meetingFacts({ members: all.map((m) => ({ id: m.id, name: m.name, role: m.role_key })), stats, learnings: (learn ?? []) as { content: string; member_id: string | null; status: string }[], pendingApprovals: pending ?? 0, blocked: blocked ?? 0 });
  const settings = await loadSettings(orgId);
  const ai = teamAi(orgId, settings.routing_pref, () => undefined);
  const { data: org } = await a.from("organizations").select("locale").eq("id", orgId).maybeSingle();
  const lang = org?.locale === "en" ? "English" : org?.locale === "ar" ? "Arabic" : "Hebrew";
  const res = await ai("summarize", [`You are ${manager.name}, the team's general manager.`, playbookPrompt("manager"), SAFETY_RULES].join("\n\n"), `Write the weekly team meeting summary for the owner in ${lang} (max 12 short lines): what was done, what we learned, what to change. Use ONLY these facts:\n${asData("week facts", JSON.stringify(facts), 3000)}`, 900);
  await a.from("team_tasks").insert({ organization_id: orgId, plan_key: key, title: "Weekly team meeting", assignee_id: manager.id, status: "done", origin: "schedule", credits_used: res.credits, result: { meeting: true, facts, narrative: res.ok ? res.text : null }, finished_at: new Date().toISOString() });
  await logActivity(orgId, null, manager.id, "learn", "Weekly team meeting summary is ready.", { done: facts.done });
}

/** upgrade 5: tasks held by the daily credit cap go back to the queue by themselves once credits are available (oldest first, a few per tick) */
export async function resumeHeldTasks(orgId: string): Promise<number> {
  const a = db();
  const settings = await loadSettings(orgId);
  const n = resumeBudget(settings.daily_credit_cap, await dayCredits(orgId));
  if (n <= 0) return 0;
  const { data } = await a.from("team_tasks").select("id, status, error, created_at").eq("organization_id", orgId).eq("status", "blocked").eq("error", "daily_credit_cap").order("created_at").limit(20);
  const picked = pickResumable((data ?? []) as { id: string; status: string; error: string | null; created_at: string }[], n);
  for (const r of picked) {
    await a.from("team_tasks").update({ status: "pending", error: null, finished_at: null, updated_at: new Date().toISOString() }).eq("organization_id", orgId).eq("id", r.id).eq("status", "blocked").eq("error", "daily_credit_cap");
  }
  return picked.length;
}

/** the team clock (cron): for every business with the team on — run ready tasks, initiative once a day, meeting weekly */
export async function teamTick(budgetMs = 50_000): Promise<{ orgs: number; ran: number; blocked: number }> {
  const started = Date.now();
  const a = db();
  const { data } = await a.from("team_settings").select("organization_id").eq("enabled", true).eq("emergency_stop", false).limit(200);
  const result = { orgs: 0, ran: 0, blocked: 0 };
  for (const { organization_id: orgId } of (data ?? []) as { organization_id: string }[]) {
    if (Date.now() - started > budgetMs) break;
    if (!(await teamFlagOn(orgId))) continue;
    if (!(await teamPlanOn(orgId))) continue;
    result.orgs++;
    const { data: org } = await a.from("organizations").select("timezone").eq("id", orgId).maybeSingle();
    const tz = (org?.timezone as string) || "Asia/Jerusalem";
    await resumeHeldTasks(orgId).catch(() => 0);
    const { data: tasks } = await a.from("team_tasks").select("id, status, depends_on, priority, assignee_id").eq("organization_id", orgId).in("status", ["pending", "done", "failed", "canceled", "in_progress", "awaiting_approval", "awaiting_input", "blocked"]).gte("updated_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).order("priority").limit(500);
    const { ready, blocked } = readyTasks((tasks ?? []) as { id: string; status: string; depends_on: string[] }[]);
    for (const b of blocked) {
      await a.from("team_tasks").update({ status: "blocked", error: "dependency_failed", updated_at: new Date().toISOString() }).eq("id", b.id).eq("status", "pending");
      result.blocked++;
    }
    await maintainTeam(orgId);
    // upgrade 8: chains blocked only by a dependency that is no longer failed come back; waiting customers get the service employee first;
    // the part-B daily tick (stub = nothing) runs once per tick, and a failure in any of them never stops the clock
    const plus8 = await import("./runner-plus8").catch(() => null);
    await plus8?.reviveChains(orgId).catch(() => 0);
    const lang8 = await a.from("organizations").select("locale").eq("id", orgId).maybeSingle().then((r) => (r.data?.locale === "en" || r.data?.locale === "ar" ? r.data.locale : "he") as "he" | "en" | "ar", () => "he" as const);
    await plus8?.ensureQueueTask(orgId, lang8, (await loadOps(orgId).catch(() => null))?.sla.targetMin ?? 60).catch(() => false);
    await dailyTick(orgId, lang8).catch(() => undefined);
    // upgrade 7: goals snapshot + alert, morning brief, weekly / monthly report (once a day per business, idempotent)
    await import("./runner-plus7").then((m) => m.dailyPlus7(orgId, tz)).catch(() => undefined);
    if (Date.now() - started < budgetMs - 20_000) {
      // upgrade 3: morning / weekly digest + daily memory upkeep (idempotent; never blocks the work below)
      try {
        const { loadTeamHealth } = await import("./runner-plus");
        const st = await loadSettings(orgId);
        const h = await loadTeamHealth(orgId, st);
        const { data: orgRow } = await a.from("organizations").select("locale").eq("id", orgId).maybeSingle();
        const l = (orgRow?.locale === "en" || orgRow?.locale === "ar" ? orgRow.locale : "he") as "he" | "en" | "ar";
        await runDailyOps(orgId, tz, l, h.verdict.level);
      } catch {
        /* optional */
      }
    }
    const toRun = plus8 ? await plus8.orderForTick(orgId, ready as ((typeof ready)[number] & { assignee_id?: string | null })[], 3, (xs) => prioritizeTasks(xs)) : ready.slice(0, 3);
    for (const t of toRun) {
      if (Date.now() - started > budgetMs - 15_000) break;
      const r = await runTask(orgId, t.id, { interactive: false, actorUser: null });
      if (!("notRun" in r)) result.ran++;
    }
    const s = await loadSettings(orgId);
    if (s.initiative && Date.now() - started < budgetMs - 10_000) await runInitiative(orgId, tz).catch(() => undefined);
    if (Date.now() - started < budgetMs - 10_000) await weeklyMeeting(orgId, tz).catch(() => undefined);
  }
  return result;
}
