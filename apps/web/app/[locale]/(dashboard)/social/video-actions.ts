"use server";

import { z } from "zod";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { VIDEO_ASPECTS, VIDEO_STYLES, videoChain, videoCredits, videoErrorKey } from "@/lib/ai/video-core";

/** AI video for posts — the screen's actions (the work is in lib/social/video-jobs.ts). Paid by credits. */
const loc = (l: string) => (l === "ar" || l === "en" ? l : "he");

export interface VideoJobView {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  request: string;
  aspect: string;
  seconds: number;
  videoUrl: string | null;
  errorKey: string | null;
  credits: number;
  provider: string | null;
  createdAt: string;
}

type Row = { id: string; status: VideoJobView["status"]; request: string; aspect: string; seconds: number; video_url: string | null; error: string | null; credits: number; provider: string | null; created_at: string };
const view = (r: Row): VideoJobView => ({
  id: r.id,
  status: r.status,
  request: r.request,
  aspect: r.aspect,
  seconds: r.seconds,
  videoUrl: r.video_url,
  errorKey: r.status === "failed" ? videoErrorKey(r.error) : null,
  credits: r.credits,
  provider: r.provider,
  createdAt: r.created_at,
});

/** is video available here and what does a clip cost (shown on the button before anything is spent) */
export async function videoConfigAction(input: { locale: string }): Promise<ActionState<{ configured: boolean; credits: number; providers: string[] }>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const chain = videoChain(process.env);
  return { ok: true, data: { configured: chain.length > 0 && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), credits: videoCredits(process.env), providers: chain } };
}

const startSchema = z.object({
  request: z.string().trim().min(4).max(2000),
  aspect: z.enum(VIDEO_ASPECTS as [string, ...string[]]),
  seconds: z.number().int().min(2).max(20).optional(),
  style: z.enum(VIDEO_STYLES).optional(),
  postId: uuidSchema.optional().nullable(),
});

export async function startVideoAction(input: { locale: string; request: string; aspect: string; seconds?: number; style?: string; postId?: string | null }): Promise<ActionState<{ job: VideoJobView }>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("campaigns.manage") || !ctx.can("ai.use")) return { error: "errors.forbidden" };
  const p = startSchema.safeParse(input);
  if (!p.success) return { error: "validation.invalid" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "social.video.err.notConfigured" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data: allowed } = await admin.rpc("public_rate_limit", { p_bucket: `socialvideo:${ctx.org.id}`, p_limit: 4, p_window_seconds: 120 });
  if (allowed === false) return { error: "ai.busy" };
  // at most 3 clips in the making at once per business
  const { count } = await admin.from("social_video_jobs").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).in("status", ["queued", "running"]);
  if ((count ?? 0) >= 3) return { error: "social.video.err.tooMany" };
  const { createVideoJob } = await import("@/lib/social/video-jobs");
  const r = await createVideoJob({ orgId: ctx.org.id, userId: ctx.userId, request: p.data.request, aspect: p.data.aspect as never, seconds: p.data.seconds ?? 8, style: p.data.style ?? "auto", postId: p.data.postId ?? null });
  if (!r.ok) return { error: r.error };
  return { ok: true, data: { job: view(r.job as unknown as Row) } };
}

export async function videoStatusAction(input: { locale: string; id: string }): Promise<ActionState<{ job: VideoJobView }>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  if (!uuidSchema.safeParse(input.id).success) return { error: "validation.invalid" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "errors.generic" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data } = await createAdminClient().from("social_video_jobs").select("id, organization_id").eq("id", input.id).maybeSingle();
  if (!data || data.organization_id !== ctx.org.id) return { error: "errors.notFound" };
  const { advanceVideoJob } = await import("@/lib/social/video-jobs");
  const j = await advanceVideoJob(input.id);
  if (!j) return { error: "errors.notFound" };
  return { ok: true, data: { job: view(j as unknown as Row) } };
}

export async function listVideosAction(input: { locale: string }): Promise<ActionState<{ jobs: VideoJobView[] }>> {
  const ctx = await getOrgContext(loc(input.locale));
  if (!ctx.can("campaigns.manage")) return { error: "errors.forbidden" };
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_video_jobs")
    .select("id, status, request, aspect, seconds, video_url, error, credits, provider, created_at")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) return { ok: true, data: { jobs: [] } };
  return { ok: true, data: { jobs: ((data ?? []) as Row[]).map(view) } };
}
