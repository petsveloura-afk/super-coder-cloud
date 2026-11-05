import "server-only";
import { limitErrorKey } from "@scc/shared/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateRouted } from "@/lib/ai/router";
import { parseBrief } from "@/lib/ai/image-director-core";
import { VIDEO_DIRECTOR_SYSTEM, clipSeconds, composeVideoPrompt, videoChain, videoCredits, videoDirectorUser, videoModel, type VideoAspect, type VideoProvider, type VideoStyle } from "@/lib/ai/video-core";

/**
 * AI video jobs for posts.
 *   create   → the video director writes the prompt (free text call) → N credits reserved in ONE usage row
 *              (reserve_ai_credits_bulk) → the first configured engine starts the clip (the next one if it refuses)
 *   advance  → checks the engine; a finished clip is copied into the business's media folder and the credits are kept;
 *              a failure / a clip that never came (25 min) is finalized as an error — the credits are given back
 * Advanced by the screen (every few seconds while it is open) and by the social clock (every 5 minutes), so a clip
 * finishes even when the person closed the page.
 */
export interface VideoJobRow {
  id: string;
  organization_id: string;
  request: string;
  prompt: string;
  aspect: VideoAspect;
  seconds: number;
  style: string | null;
  provider: string | null;
  model: string | null;
  provider_ref: Record<string, string>;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  video_url: string | null;
  error: string | null;
  credits: number;
  usage_id: number | null;
  attempts: number;
  created_at: string;
}

const COLS = "id, organization_id, request, prompt, aspect, seconds, style, provider, model, provider_ref, status, video_url, error, credits, usage_id, attempts, created_at";
const GIVE_UP_MS = 25 * 60_000;

export type CreateVideoResult = { ok: true; job: VideoJobRow } | { ok: false; error: string };

async function directPrompt(input: { request: string; aspect: VideoAspect; seconds: number; style: VideoStyle; business: string | null; brandVoice: string | null; brandColors: string[] }) {
  let brief: (ReturnType<typeof parseBrief> & { camera?: string }) | null = null;
  try {
    const r = await generateRouted({
      system: VIDEO_DIRECTOR_SYSTEM,
      messages: [{ role: "user", content: videoDirectorUser(input) }],
      json: true,
      temperature: 0.6,
      maxTokens: 500,
      budgetMs: 12_000,
      maxCalls: 2,
    });
    brief = parseBrief(r.text);
  } catch (e) {
    console.error("video director failed", (e as Error).message);
  }
  return composeVideoPrompt(brief as never, input);
}

async function finalize(usageId: number | null, provider: string | null, model: string | null, ok: boolean) {
  if (usageId === null || usageId === undefined) return;
  await createAdminClient().rpc("finalize_ai_usage_bulk", { p_usage_id: usageId, p_provider: provider ?? "none", p_model: model ?? "none", p_ok: ok });
}

/** starts the clip on the first engine that accepts it; returns the fields to store on the job */
async function startOnChain(chain: VideoProvider[], from: number, prompt: string, negative: string, aspect: VideoAspect, wanted: number) {
  const { startVideo } = await import("@/lib/ai/video-providers");
  let lastError = "no_provider";
  for (let i = from; i < chain.length; i++) {
    const p = chain[i]!;
    const seconds = clipSeconds(p, wanted);
    try {
      const s = await startVideo(p, { prompt, negative, aspect, seconds });
      return { ok: true as const, provider: p, model: videoModel(p, process.env), seconds, start: s, index: i };
    } catch (e) {
      lastError = (e as Error).message;
      console.error(`video start failed on ${p}`, lastError.slice(0, 200));
    }
  }
  return { ok: false as const, error: lastError };
}

async function completeWith(job: Pick<VideoJobRow, "id" | "organization_id" | "usage_id" | "provider" | "model">, source: string, needsKey: boolean) {
  const admin = createAdminClient();
  const { storeVideo } = await import("@/lib/ai/video-providers");
  let url: string;
  let note: string | null = null;
  try {
    url = await storeVideo(job.organization_id, source, needsKey);
  } catch (e) {
    // the clip exists but could not be copied: keep the engine's own link (it works for a while) rather than lose a paid clip
    if (!/^https:\/\//.test(source) || needsKey) throw e;
    url = source;
    note = `stored_external:${(e as Error).message}`.slice(0, 300);
  }
  await admin.from("social_video_jobs").update({ status: "done", video_url: url, error: note, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
  await finalize(job.usage_id, job.provider, job.model, true);
  return url;
}

async function fail(job: Pick<VideoJobRow, "id" | "usage_id" | "provider" | "model">, error: string) {
  await createAdminClient()
    .from("social_video_jobs")
    .update({ status: "failed", error: error.slice(0, 480), credits: 0, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .in("status", ["queued", "running"]);
  await finalize(job.usage_id, job.provider, job.model, false);
}

export async function createVideoJob(input: {
  orgId: string;
  userId: string | null;
  request: string;
  aspect: VideoAspect;
  seconds?: number | null;
  style?: VideoStyle | null;
  postId?: string | null;
}): Promise<CreateVideoResult> {
  const chain = videoChain(process.env);
  if (!chain.length) return { ok: false, error: "social.video.err.notConfigured" };
  const admin = createAdminClient();
  const [{ data: org }, { data: social }] = await Promise.all([
    admin.from("organizations").select("name").eq("id", input.orgId).maybeSingle(),
    admin.from("social_settings").select("brand_voice").eq("organization_id", input.orgId).maybeSingle(),
  ]);
  const { brandColors } = await import("./studio-image");
  const wanted = clipSeconds(chain[0]!, input.seconds ?? 8);
  const directed = await directPrompt({
    request: input.request,
    aspect: input.aspect,
    seconds: wanted,
    style: input.style ?? "auto",
    business: (org?.name as string | null) ?? null,
    brandVoice: (social?.brand_voice as string | null) ?? null,
    brandColors: await brandColors(input.orgId),
  });
  const credits = videoCredits(process.env);
  const { data: usageId, error: reserveError } = await admin.rpc("reserve_ai_credits_bulk", { p_org: input.orgId, p_feature: "video_gen", p_credits: credits, p_agent: null });
  if (reserveError || usageId === null || usageId === undefined) return { ok: false, error: limitErrorKey(reserveError?.message) ?? "social.video.err.failed" };

  const { data: row, error: insErr } = await admin
    .from("social_video_jobs")
    .insert({
      organization_id: input.orgId,
      created_by: input.userId,
      request: input.request.slice(0, 2000),
      prompt: directed.prompt.slice(0, 4000),
      aspect: input.aspect,
      seconds: wanted,
      style: directed.style,
      status: "queued",
      credits,
      usage_id: usageId as number,
      post_id: input.postId ?? null,
    })
    .select(COLS)
    .single();
  if (insErr || !row) {
    await finalize(usageId as number, null, null, false);
    return { ok: false, error: "social.video.err.failed" };
  }
  const job = row as VideoJobRow;
  const started = await startOnChain(chain, 0, directed.prompt, directed.negative, input.aspect, wanted);
  if (!started.ok) {
    await fail({ ...job, provider: chain[0]!, model: videoModel(chain[0]!, process.env) }, started.error);
    return { ok: false, error: /429|rate|quota|busy|503/i.test(started.error) ? "social.video.err.busy" : "social.video.err.failed" };
  }
  const patch = { provider: started.provider, model: started.model, seconds: started.seconds, attempts: 1, updated_at: new Date().toISOString() };
  if ("done" in started.start) {
    await admin.from("social_video_jobs").update({ ...patch, status: "running", provider_ref: { kind: "direct", index: String(started.index) } }).eq("id", job.id);
    try {
      const url = await completeWith({ ...job, ...patch }, started.start.done, Boolean(started.start.needsKey));
      return { ok: true, job: { ...job, ...patch, status: "done", video_url: url } };
    } catch (e) {
      await fail({ ...job, ...patch }, (e as Error).message);
      return { ok: false, error: "social.video.err.failed" };
    }
  }
  const ref = { ...started.start.ref, index: String(started.index) };
  await admin.from("social_video_jobs").update({ ...patch, status: "running", provider_ref: ref }).eq("id", job.id);
  return { ok: true, job: { ...job, ...patch, status: "running", provider_ref: ref } };
}

/** one check of one job (safe to call often and from two places at once: a finished job is left alone) */
export async function advanceVideoJob(jobId: string): Promise<VideoJobRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("social_video_jobs").select(COLS).eq("id", jobId).maybeSingle();
  const job = data as VideoJobRow | null;
  if (!job || (job.status !== "running" && job.status !== "queued")) return job;
  if (Date.now() - new Date(job.created_at).getTime() > GIVE_UP_MS) {
    await fail(job, "timeout");
    return { ...job, status: "failed", error: "timeout" };
  }
  if (!job.provider_ref?.kind || job.provider_ref.kind === "direct") return job;
  const { pollVideo } = await import("@/lib/ai/video-providers");
  let r: Awaited<ReturnType<typeof pollVideo>>;
  try {
    r = await pollVideo(job.provider_ref);
  } catch (e) {
    // a network hiccup is not a failure: count it and try again next time (gives up after many)
    const attempts = job.attempts + 1;
    await admin.from("social_video_jobs").update({ attempts, updated_at: new Date().toISOString() }).eq("id", job.id);
    if (attempts > 40) {
      await fail(job, (e as Error).message);
      return { ...job, status: "failed" };
    }
    return { ...job, attempts };
  }
  if (r.state === "running") {
    await admin.from("social_video_jobs").update({ updated_at: new Date().toISOString() }).eq("id", job.id);
    return job;
  }
  if (r.state === "failed") {
    // the engine refused / failed: give the next engine in the chain one chance with the same prompt and credits
    const chain = videoChain(process.env);
    const from = Number(job.provider_ref.index ?? chain.indexOf(job.provider as VideoProvider)) + 1;
    if (from > 0 && from < chain.length && !/filtered|safety|policy|rai/i.test(r.error)) {
      const negative = composeVideoPrompt(null, { request: job.request, aspect: job.aspect, seconds: job.seconds }).negative;
      const again = await startOnChain(chain, from, job.prompt, negative, job.aspect, job.seconds);
      if (again.ok && "ref" in again.start) {
        const ref = { ...again.start.ref, index: String(again.index) };
        await admin.from("social_video_jobs").update({ provider: again.provider, model: again.model, provider_ref: ref, attempts: job.attempts + 1, error: r.error.slice(0, 480), updated_at: new Date().toISOString() }).eq("id", job.id);
        return { ...job, provider: again.provider, model: again.model, provider_ref: ref };
      }
      if (again.ok && "done" in again.start) {
        const url = await completeWith({ ...job, provider: again.provider, model: again.model }, again.start.done, Boolean(again.start.needsKey)).catch(() => null);
        if (url) return { ...job, status: "done", video_url: url };
      }
    }
    await fail(job, r.error);
    return { ...job, status: "failed", error: r.error };
  }
  // done (a link) or inline bytes
  const source = r.state === "inline" ? `data:${r.mime};base64,${r.data}` : r.url;
  const needsKey = r.state === "done" ? Boolean(r.needsKey) : false;
  // claim it first, so the screen and the clock never store the same clip twice
  const { data: claimed } = await admin
    .from("social_video_jobs")
    .update({ provider_ref: { ...job.provider_ref, kind: "direct", was: job.provider_ref.kind }, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .in("status", ["queued", "running"])
    .eq("provider_ref->>kind", job.provider_ref.kind)
    .select("id");
  if (!claimed?.length) return job;
  try {
    const url = await completeWith(job, source, needsKey);
    return { ...job, status: "done", video_url: url };
  } catch (e) {
    await fail(job, (e as Error).message);
    return { ...job, status: "failed", error: (e as Error).message };
  }
}

/** the clock: every open job, oldest check first, within the time it has */
export async function advancePendingVideoJobs(budgetMs = 15_000): Promise<{ checked: number; done: number; failed: number }> {
  const t0 = Date.now();
  const { data } = await createAdminClient().from("social_video_jobs").select("id").in("status", ["queued", "running"]).order("updated_at", { ascending: true }).limit(20);
  const out = { checked: 0, done: 0, failed: 0 };
  for (const r of (data ?? []) as { id: string }[]) {
    if (Date.now() - t0 > budgetMs) break;
    const j = await advanceVideoJob(r.id).catch(() => null);
    out.checked++;
    if (j?.status === "done") out.done++;
    if (j?.status === "failed") out.failed++;
  }
  return out;
}
