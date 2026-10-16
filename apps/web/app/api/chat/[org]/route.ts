import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { visitorHash } from "@/lib/visitor";
import { extractContactInfo } from "@/lib/ai/autopilot-core";
import { handleInboundWithAI } from "@/lib/ai/autopilot";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Website chat (no setup needed): visitors of the business's sites — or of any
 * site that embeds /widget.js — talk to the business's AI agent. Messages land
 * in the inbox (channel "web"); the team can take over at any time.
 *
 *   GET  /api/chat/{org}?v={visitor}  → { enabled, org, agent, greeting, messages[] }
 *   POST /api/chat/{org} { v, text, name?, email?, phone? } → same, after the agent answered
 */

const ORG_RE = /^[a-z0-9][a-z0-9-]{1,60}$/;
const VISITOR_RE = /^[a-f0-9]{32,64}$/;

interface ChatMsg {
  id: string;
  from: "me" | "agent" | "team";
  text: string;
  at: string;
  buttons?: string[];
  askPhone?: boolean;
  image?: string;
}

async function state(org: string, visitor: string | null) {
  const admin = createAdminClient();
  const { data: cfg } = await admin.rpc("web_chat_config", { p_org_slug: org });
  if (!cfg) return null;
  let messages: ChatMsg[] = [];
  let mode: string | null = null;
  if (visitor) {
    const { data: o } = await admin.from("organizations").select("id").eq("slug", org).maybeSingle();
    if (o) {
      const { data: conv } = await admin.from("conversations").select("id, ai_mode").eq("organization_id", o.id).eq("channel", "web").eq("external_id", `v:${visitor}`).maybeSingle();
      if (conv) {
        mode = conv.ai_mode as string;
        const { data: rows } = await admin
          .from("messages")
          .select("id, direction, body, created_at, ai_agent_id, sent_by, meta")
          .eq("conversation_id", conv.id)
          .order("created_at", { ascending: false })
          .limit(60);
        messages = ((rows ?? []) as { id: string; direction: string; body: string; created_at: string; ai_agent_id: string | null; sent_by: string | null; meta: { buttons?: string[]; ask_phone?: boolean; media?: { url?: string } } | null }[])
          .reverse()
          .map((m) => ({
            id: m.id,
            from: m.direction === "in" ? "me" : m.ai_agent_id ? "agent" : "team",
            text: m.body,
            at: m.created_at,
            ...(m.direction === "out" && m.meta?.buttons?.length ? { buttons: m.meta.buttons.slice(0, 3) } : {}),
            ...(m.direction === "out" && m.meta?.ask_phone ? { askPhone: true } : {}),
            ...(m.direction === "out" && m.meta?.media?.url && (/^https:\/\//.test(m.meta.media.url) || m.meta.media.url.startsWith(`${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "")}/storage/v1/object/public/`)) ? { image: m.meta.media.url } : {}),
          }));
      }
    }
  }
  // wave 8: the agent's menu buttons (shown under the greeting)
  let menu: string[] = [];
  if ((cfg as { enabled?: boolean }).enabled) {
    const { data: o } = await admin.from("organizations").select("id").eq("slug", org).maybeSingle();
    if (o) {
      const { data: a } = await admin.from("ai_agents").select("profile").eq("organization_id", o.id).eq("enabled", true).contains("autopilot_channels", ["web"]).order("created_at").limit(1).maybeSingle();
      menu = (((a?.profile as { menu?: string[] } | null)?.menu ?? []) as string[]).filter((x) => typeof x === "string" && x.trim()).slice(0, 8);
    }
  }
  return { ...(cfg as Record<string, unknown>), mode, messages, menu };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!ORG_RE.test(org) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ enabled: false }, { status: 404 });
  const v = request.nextUrl.searchParams.get("v");
  const s = await state(org, v && VISITOR_RE.test(v) ? v : null);
  if (!s) return NextResponse.json({ enabled: false }, { status: 404 });
  return NextResponse.json(s, { headers: { "Cache-Control": "no-store" } });
}

const postSchema = z.object({
  v: z.string().regex(VISITOR_RE),
  text: z.string().trim().min(1).max(2000),
  name: z.string().trim().max(80).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  if (!ORG_RE.test(org) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { v, text } = parsed.data;
  const admin = createAdminClient();

  // abuse protection: per visitor and per IP (hashed)
  const ip = await visitorHash();
  const [{ data: okVisitor }, { data: okIp }] = await Promise.all([
    admin.rpc("public_rate_limit", { p_bucket: `webchat:v:${v}`, p_limit: 12, p_window_seconds: 60 }),
    admin.rpc("public_rate_limit", { p_bucket: `webchat:ip:${org}:${ip}`, p_limit: 60, p_window_seconds: 600 }),
  ]);
  if (okVisitor === false || okIp === false) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data: cfg } = await admin.rpc("web_chat_config", { p_org_slug: org });
  if (!cfg || !(cfg as { enabled?: boolean }).enabled) return NextResponse.json({ error: "disabled" }, { status: 409 });

  const found = extractContactInfo(text);
  const { data: res, error } = await admin.rpc("ingest_web_message", {
    p_org_slug: org,
    p_visitor: v,
    p_name: parsed.data.name ?? null,
    p_email: parsed.data.email || found.email || null,
    p_phone: parsed.data.phone || found.phone || null,
    p_text: text,
    p_meta: { page: (request.headers.get("referer") ?? "").slice(0, 300) },
  });
  if (error || !res) return NextResponse.json({ error: "failed" }, { status: 500 });
  const r = res as { conversation_id: string; ai_mode: string };
  if (r.ai_mode === "auto") {
    try {
      await handleInboundWithAI({ conversationId: r.conversation_id });
    } catch (e) {
      console.error("web chat autopilot failed", (e as Error).message);
    }
  }
  const s = await state(org, v);
  return NextResponse.json(s, { headers: { "Cache-Control": "no-store" } });
}
