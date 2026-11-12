import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ToolRun } from "./engine-core";
import { pipelineSummary, threadSummary, validContactStatus } from "./tools-plus10-core";

/**
 * Upgrade 10 — executors for the tools in tools-plus10-core. Every query is scoped to the business (organization_id);
 * nothing here contacts a customer or spends money. Never throws: errors come back as { ok: false, error }.
 */
type Args = Record<string, string | number>;
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const clamp = (v: unknown, min: number, max: number, dflt: number) => Math.max(min, Math.min(max, Number(v) || dflt));

export const PLUS10_KEYS = ["crm.recent_leads", "inbox.thread", "deals.pipeline", "appointments.upcoming", "tasks.complete", "crm.set_status", "social.update_draft"] as const;

export async function runPlus10Tool(orgId: string, tool: string, args: Args): Promise<ToolRun> {
  const db = createAdminClient();
  try {
    switch (tool) {
      case "crm.recent_leads": {
        const days = clamp(args.days, 1, 60, 7);
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const { data } = await db.from("contacts").select("id, first_name, last_name, status, source, phone, email, created_at").eq("organization_id", orgId).eq("is_demo", false).gte("created_at", since).order("created_at", { ascending: false }).limit(15);
        const rows = (data ?? []) as { id: string; first_name: string; last_name: string | null; status: string; source: string; phone: string | null; email: string | null; created_at: string }[];
        return { ok: true, data: rows.map((r) => ({ id: r.id, status: r.status })), summary: rows.length ? rows.map((r) => `${`${r.first_name} ${r.last_name ?? ""}`.trim()} (id ${r.id}, ${r.status}, from ${r.source}, ${r.created_at.slice(0, 10)}${r.phone ? ", phone" : ""}${r.email ? ", email" : ""})`).join("; ") : `no new contacts in ${days} days`, link: "/contacts" };
      }
      case "inbox.thread": {
        const contact = s(args.contact_id);
        const { data: conv } = await db.from("conversations").select("id, channel").eq("organization_id", orgId).eq("contact_id", contact).order("last_message_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        if (!conv) return { ok: true, summary: "no conversation with this contact yet" };
        const { data } = await db.from("messages").select("direction, body, created_at").eq("organization_id", orgId).eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(20);
        const rows = ((data ?? []) as { direction: string; body: string | null; created_at: string }[]).reverse();
        return { ok: true, summary: `channel ${conv.channel}:\n${threadSummary(rows)}`, link: "/inbox" };
      }
      case "deals.pipeline": {
        const { data: pipe } = await db.from("pipelines").select("id").eq("organization_id", orgId).order("created_at").limit(1).maybeSingle();
        if (!pipe) return { ok: true, summary: "no pipeline yet" };
        const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const [{ data: stages }, { data: open }, { data: closed }] = await Promise.all([
          db.from("pipeline_stages").select("id, name, position").eq("organization_id", orgId).eq("pipeline_id", pipe.id),
          db.from("deals").select("stage_id, value").eq("organization_id", orgId).eq("pipeline_id", pipe.id).eq("status", "open").limit(2000),
          db.from("deals").select("status, value").eq("organization_id", orgId).in("status", ["won", "lost"]).gte("closed_at", since).limit(2000),
        ]);
        const sum = pipelineSummary((stages ?? []) as { id: string; name: string; position: number }[], (open ?? []) as { stage_id: string; value: number }[]);
        const c = (closed ?? []) as { status: string; value: number | string }[];
        const won = c.filter((d) => d.status === "won");
        const lost = c.length - won.length;
        return { ok: true, summary: `open: ${sum.openCount} deals, ${sum.openValue}. ${sum.lines.join("; ")}. Last 30 days: ${won.length} won (${Math.round(won.reduce((a, d) => a + (Number(d.value) || 0), 0))}), ${lost} lost.`.slice(0, 2500), link: "/pipelines" };
      }
      case "appointments.upcoming": {
        const days = clamp(args.days, 1, 30, 7);
        const now = new Date();
        const { data } = await db.from("appointments").select("id, title, starts_at, ends_at, status, contact_id").eq("organization_id", orgId).in("status", ["scheduled", "confirmed"]).gte("starts_at", now.toISOString()).lte("starts_at", new Date(now.getTime() + days * 86_400_000).toISOString()).order("starts_at").limit(25);
        const rows = (data ?? []) as { id: string; title: string; starts_at: string; ends_at: string; status: string; contact_id: string | null }[];
        return { ok: true, summary: rows.length ? rows.map((a) => `${a.starts_at.slice(0, 16).replace("T", " ")}–${a.ends_at.slice(11, 16)} ${a.title} (${a.status}${a.contact_id ? `, contact ${a.contact_id}` : ""})`).join("; ") : `no meetings in the next ${days} days`, link: "/appointments" };
      }
      case "tasks.complete": {
        const id = s(args.task_id);
        const { data: task } = await db.from("tasks").select("id, title, status, description").eq("organization_id", orgId).eq("id", id).maybeSingle();
        if (!task) return { ok: false, summary: "", error: "task_not_found" };
        if (task.status === "done") return { ok: true, summary: `task already done: ${String(task.title).slice(0, 100)}` };
        const note = s(args.note).trim().slice(0, 500);
        const description = note ? `${String(task.description ?? "").trim()}${task.description ? "\n\n" : ""}✓ ${note}`.slice(0, 5000) : (task.description as string | null);
        const { error } = await db.from("tasks").update({ status: "done", description }).eq("organization_id", orgId).eq("id", id);
        return error ? { ok: false, summary: "", error: error.message.slice(0, 200) } : { ok: true, summary: `task done: ${String(task.title).slice(0, 100)}`, link: "/tasks" };
      }
      case "crm.set_status": {
        const status = validContactStatus(args.status);
        if (!status) return { ok: false, summary: "", error: "status must be one of: lead, qualified, customer, inactive" };
        const id = s(args.contact_id);
        const { data, error } = await db.from("contacts").update({ status }).eq("organization_id", orgId).eq("id", id).select("id, first_name").maybeSingle();
        if (error) return { ok: false, summary: "", error: error.message.slice(0, 200) };
        return data ? { ok: true, summary: `${data.first_name} is now "${status}"`, link: `/contacts/${data.id}` } : { ok: false, summary: "", error: "contact_not_found" };
      }
      case "social.update_draft": {
        const { cleanPostBody } = await import("@/lib/social/post-hygiene-core");
        const cleaned = cleanPostBody(s(args.text));
        if (!cleaned.ok) return { ok: false, summary: "", error: cleaned.reason === "not_a_post" ? "not_a_post: send only the post text a customer will read (no notes, ids or confirmations)" : "too_short" };
        const id = s(args.post_id);
        const { data: post } = await db.from("social_posts").select("id, status").eq("organization_id", orgId).eq("id", id).maybeSingle();
        if (!post) return { ok: false, summary: "", error: "post_not_found" };
        if (post.status !== "draft") return { ok: false, summary: "", error: `only drafts can be changed (this post is ${post.status})` };
        const { error } = await db.from("social_posts").update({ body: cleaned.text }).eq("organization_id", orgId).eq("id", id).eq("status", "draft");
        return error ? { ok: false, summary: "", error: error.message.slice(0, 200) } : { ok: true, summary: `draft ${id} updated — still waiting for the owner on the posts board`, link: "/social" };
      }
      default:
        return { ok: false, summary: "", error: "unknown_tool" };
    }
  } catch (e) {
    return { ok: false, summary: "", error: (e as Error).message.slice(0, 300) };
  }
}
