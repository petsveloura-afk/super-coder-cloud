import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIDEO_DIRECTOR_SYSTEM,
  clipSeconds,
  composeVideoPrompt,
  falInput,
  readFalResult,
  readFalStatus,
  readInteraction,
  readReplicate,
  readSelfhost,
  readVeoOperation,
  replicateInput,
  videoChain,
  videoCredits,
  videoDirectorUser,
  videoErrorKey,
  videoModel,
  videoProviderConfigured,
} from "@/lib/ai/video-core";
import { COPY_FRAMEWORKS, frameworkDirection, polishPostCopy, postQuality } from "@/lib/social/post-quality";
import { PLAYBOOKS, playbook, playbookValue, unfilledPlaceholders } from "@/lib/campaigns/templates";
import { CAMPAIGN_SORTS, sortCampaigns, sortCampaignsKey } from "@/lib/campaigns/list-core";
import { campaignSchema } from "@scc/shared/engagement";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const TOKEN = "r8_" + "x".repeat(30);

describe("AI video — engines, price, director", () => {
  it("only configured engines are used, in the asked order; Google only when explicitly turned on", () => {
    expect(videoChain({})).toEqual([]);
    expect(videoChain({ GEMINI_API_KEY: "k".repeat(30) })).toEqual([]);
    expect(videoChain({ GEMINI_API_KEY: "k".repeat(30), AI_GEMINI_VIDEO: "on" })).toEqual(["google"]);
    expect(videoChain({ REPLICATE_API_TOKEN: TOKEN, VIDEO_SELFHOST_URL: "https://gpu.example.com/video" })).toEqual(["selfhost", "replicate"]);
    expect(videoChain({ REPLICATE_API_TOKEN: TOKEN, FAL_KEY: "f".repeat(30), VIDEO_PROVIDERS: "fal, replicate, bogus" })).toEqual(["fal", "replicate"]);
    expect(videoProviderConfigured("replicate", { REPLICATE_API_TOKEN: "short" })).toBe(false);
    expect(videoProviderConfigured("selfhost", { VIDEO_SELFHOST_URL: "ftp://x" })).toBe(false);
    expect(videoModel("replicate", {})).toBe("wan-video/wan-2.2-t2v-fast");
    expect(videoModel("google", {})).toBe("gemini-omni-1.1-flash");
    expect(videoModel("fal", { FAL_VIDEO_MODEL: "fal-ai/wan/v2.2-a14b/text-to-video" })).toBe("fal-ai/wan/v2.2-a14b/text-to-video");
  });

  it("a symbolic, platform-set price (never 0) and engine-safe lengths", () => {
    expect(videoCredits({})).toBe(15);
    expect(videoCredits({ VIDEO_CREDITS: "8" })).toBe(8);
    expect(videoCredits({ VIDEO_CREDITS: "0" })).toBe(15);
    expect(videoCredits({ VIDEO_CREDITS: "9999" })).toBe(500);
    expect(clipSeconds("google", 20)).toBe(8);
    expect(clipSeconds("google", 2)).toBe(4);
    expect(clipSeconds("replicate", null)).toBe(8);
    expect(clipSeconds("selfhost", 15)).toBe(15);
  });

  it("the video director: the post's real subject + motion + frame, never text on screen, no photo-only words", () => {
    const d = composeVideoPrompt({ subject: "a hairstylist applying caramel balayage", camera: "slow dolly-in" } as never, { request: "צבע לשיער במספרה", aspect: "9:16", seconds: 8 });
    expect(d.prompt.startsWith("Video: a hairstylist applying caramel balayage")).toBe(true);
    for (const k of ["Motion: one continuous 8-second shot, slow dolly-in", "vertical 9:16 frame", "No on-screen text", "no cuts"]) expect(d.prompt).toContain(k);
    expect(d.prompt).not.toMatch(/Camera: |photography|Strictly no text/);
    expect(d.negative).toMatch(/text, letters/);
    const auto = composeVideoPrompt(null, { request: "מבצע על פיצה במסעדה", aspect: "16:9", seconds: 5 });
    expect(auto.style).toBe("lifestyle");
    expect(auto.prompt).toMatch(/dish|restaurant/);
    expect(composeVideoPrompt(null, { request: "x y", aspect: "1:1", seconds: 5, style: "energetic" }).prompt).toContain("dynamic push-in");
    expect(VIDEO_DIRECTOR_SYSTEM).toContain("Never text");
    expect(videoDirectorUser({ request: "פוסט על תספורת לכלבים", aspect: "9:16", seconds: 8 })).toContain("Industry: pets");
  });

  it("reads every engine's answer (running / done / failed) and never takes a non-https link", () => {
    expect(readReplicate({ status: "processing" })).toEqual({ state: "running" });
    expect(readReplicate({ status: "succeeded", output: "https://r.example/v.mp4" })).toEqual({ state: "done", url: "https://r.example/v.mp4" });
    expect(readReplicate({ status: "succeeded", output: ["https://r.example/a.mp4"] })).toMatchObject({ url: "https://r.example/a.mp4" });
    expect(readReplicate({ status: "succeeded", output: "http://insecure/v.mp4" }).state).toBe("failed");
    expect(readReplicate({ status: "failed", error: "nsfw" })).toMatchObject({ state: "failed" });
    expect(readFalStatus({ status: "IN_QUEUE" })).toBe("running");
    expect(readFalStatus({ status: "COMPLETED" })).toBe("completed");
    expect(readFalResult({ video: { url: "https://fal.media/v.mp4" } })).toMatchObject({ url: "https://fal.media/v.mp4" });
    expect(readVeoOperation({ done: false })).toEqual({ state: "running" });
    expect(readVeoOperation({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/x:download" } }] } } })).toMatchObject({ state: "done", needsKey: true });
    expect(readVeoOperation({ done: true, response: { generateVideoResponse: { raiMediaFilteredReasons: ["child"] } } })).toMatchObject({ state: "failed" });
    expect(readInteraction({ status: "in_progress" })).toEqual({ state: "running" });
    expect(readInteraction({ status: "completed", steps: [{ content: [{ type: "text", text: "ok" }, { type: "video", uri: "https://generativelanguage.googleapis.com/f/v" }] }] })).toMatchObject({ state: "done", needsKey: true });
    expect(readInteraction({ status: "completed", outputs: [{ type: "video", data: "A".repeat(2000), mime_type: "video/mp4" }] })).toMatchObject({ state: "inline", mime: "video/mp4" });
    expect(readInteraction({ status: "completed", steps: [] })).toMatchObject({ state: "failed" });
    expect(readSelfhost({ status: "running" })).toEqual({ state: "running" });
    expect(readSelfhost({ status: "done", video_url: "https://gpu.example/v.mp4" })).toMatchObject({ state: "done" });
    expect(readSelfhost({ status: "failed", error: "oom" })).toMatchObject({ state: "failed" });
  });

  it("model inputs: Wan gets frames + 720p, LTX gets length; errors map to friendly keys", () => {
    expect(replicateInput("wan-video/wan-2.2-t2v-fast", "p", "n", "9:16", 5)).toMatchObject({ prompt: "p", negative_prompt: "n", aspect_ratio: "9:16", num_frames: 81, resolution: "720p" });
    expect(replicateInput("lightricks/ltx-video", "p", "n", "1:1", 5)).toMatchObject({ length: 121 });
    expect(falInput("fal-ai/ltx-video", "p", "n", "16:9", 8)).toMatchObject({ duration: "8", num_inference_steps: 40 });
    expect(videoErrorKey("plan_limit:ai_credits")).toBe("social.video.err.credits");
    expect(videoErrorKey("veo_filtered:x")).toBe("social.video.err.safety");
    expect(videoErrorKey("replicate_429:busy")).toBe("social.video.err.busy");
    expect(videoErrorKey("timeout")).toBe("social.video.err.timeout");
    expect(videoErrorKey("weird")).toBe("social.video.err.failed");
  });

  it("wiring: credits in one usage row, refunds on failure, jobs advanced by the screen and the social clock", () => {
    const mig = read("../../supabase/migrations/20261106000001_ai_video.sql");
    for (const k of ["'video_gen'", "reserve_ai_credits_bulk", "finalize_ai_usage_bulk", "'refund'", "social_video_jobs", "enable row level security", "revoke insert, update, delete on public.social_video_jobs from authenticated"]) expect(mig, k).toContain(k);
    const jobs = read("lib/social/video-jobs.ts");
    expect(jobs).toContain('rpc("reserve_ai_credits_bulk"');
    expect(jobs).toContain('rpc("finalize_ai_usage_bulk"');
    expect(jobs).toContain('.eq("provider_ref->>kind", job.provider_ref.kind)');
    expect(read("app/api/cron/social/route.ts")).toContain("advancePendingVideoJobs(");
    expect(read("lib/ai/video-providers.ts")).toContain("`${orgId}/ai-video/${randomUUID()}.${ext}`");
    const pp = read("components/social/post-power.tsx");
    expect(pp).toContain("<AiVideoPanel body={props.body} ig={props.ig} onVideo={props.setVideo} />");
    expect(pp).toContain("<PostQualityPanel body={props.body} setBody={props.setBody} ig={props.ig} />");
    const env = read("../../.env.example");
    for (const k of ["REPLICATE_API_TOKEN", "FAL_KEY", "VIDEO_SELFHOST_URL", "VIDEO_CREDITS", "AI_GEMINI_VIDEO"]) expect(env, k).toContain(k);
  });
});

describe("post copy — score, tidy-up, professional rewrite", () => {
  it("a strong Instagram post scores high, a flat one gets concrete tips", () => {
    const strong = "רוצים שיער שזוהר כל הקיץ? ☀️\n\nבלאיאז' קרמל חדש במספרה\nצבע עמיד, מבריק ועדין לשיער\nמתאים לכל אורך\n\nשלחו לנו הודעה וקבעו תור 💬\n\n#בלאיאז #שיער #מספרה #קיץ";
    const q = postQuality(strong, "instagram");
    expect(q.score).toBeGreaterThanOrEqual(80);
    expect(q.grade).toBe("great");
    const weak = postQuality("אנחנו מספרה טובה מאוד ויש לנו שירותים רבים לכל המשפחה במחירים טובים בואו לבקר", "instagram");
    expect(weak.score).toBeLessThan(55);
    expect(weak.tips.slice(0, 3)).toEqual(expect.arrayContaining(["hook"]));
    expect(postQuality("", "facebook").score).toBe(0);
    expect(postQuality("Check this out https://x.co #a #b #c", "instagram").checks.find((c) => c.key === "noLinksIg")?.ok).toBe(false);
  });

  it("tidy-up never changes words: spacing, empty lines, duplicate hashtags gathered at the end", () => {
    expect(polishPostCopy("שלום  עולם !\n\n\n\nשורה שנייה   \n#a\n#b #A")).toBe("שלום עולם!\n\nשורה שנייה\n\n#a #b");
    expect(polishPostCopy("טקסט רגיל")).toBe("טקסט רגיל");
  });

  it("six rewrite frameworks; the AI keeps every fact and the post's language", () => {
    expect(COPY_FRAMEWORKS).toEqual(["hook", "aida", "pas", "story", "short", "list"]);
    expect(frameworkDirection("aida")).toMatch(/Attention/);
    const a = read("app/[locale]/(dashboard)/social/copy-actions.ts");
    expect(a).toContain("COPY_RULES");
    expect(read("lib/social/post-quality.ts")).toContain("Keep EVERY fact from the original");
    // the full-post writer also got the top-brand copy rules and the image director
    expect(read("app/[locale]/(dashboard)/social/studio-actions.ts")).toContain("Write like a copywriter of a top brand");
  });
});

describe("campaigns — playbooks, placeholders, sorting", () => {
  it("10 playbooks, 3 languages each, only the safe merge variables, every one a valid campaign", () => {
    expect(PLAYBOOKS.length).toBe(10);
    for (const p of PLAYBOOKS) {
      for (const l of ["he", "en", "ar"] as const) {
        const v = playbookValue(p, l);
        const vars = `${v.subject} ${v.body}`.match(/\{\{[^}]+\}\}/g) ?? [];
        for (const x of vars) expect(["{{contact.first_name}}", "{{org.name}}"], `${p.id}.${l}`).toContain(x);
        const ok = campaignSchema.safeParse({ ...v, subject: v.subject || "x" });
        expect(ok.success, `${p.id}.${l}`).toBe(true);
        if (v.channel === "sms") expect(v.body.length, `${p.id}.${l} sms`).toBeLessThanOrEqual(220);
      }
    }
    expect(playbook("nope")).toBeNull();
    // a suggested channel that is not connected falls back to e-mail when e-mail works
    expect(playbookValue(playbook("winback")!, "he", { whatsapp: false, email: true }).channel).toBe("email");
    expect(playbookValue(playbook("winback")!, "he", { whatsapp: false, email: true }).subject.length).toBeGreaterThan(0);
  });

  it("[placeholders] to fill are found (and real text is not)", () => {
    expect(unfilledPlaceholders("רק היום: [ההטבה] עד [שעה]", "[ההטבה]")).toEqual(["ההטבה", "שעה"]);
    expect(unfilledPlaceholders("שלום {{contact.first_name}}", "[1]")).toEqual([]);
    expect(read("components/campaigns/campaign-editor.tsx")).toContain("<PlaceholderWarning");
    expect(read("app/[locale]/(dashboard)/campaigns/new/page.tsx")).toContain("<NewCampaignWorkspace");
  });

  it("sorting the list (newest first stays the default)", () => {
    const rows = [
      { name: "ב", created_at: "2026-01-02T00:00:00Z", stats: { recipients: 10, sent: 5 } },
      { name: "א", created_at: "2026-01-03T00:00:00Z", stats: { recipients: 100, sent: 99 } },
      { name: "ג", created_at: "2026-01-01T00:00:00Z", stats: null },
    ];
    expect(sortCampaignsKey("x")).toBe("newest");
    expect(sortCampaigns(rows, "newest").map((r) => r.name)).toEqual(["ב", "א", "ג"]);
    expect(sortCampaigns(rows, "oldest").map((r) => r.name)).toEqual(["ג", "ב", "א"]);
    expect(sortCampaigns(rows, "recipients")[0]!.name).toBe("א");
    expect(sortCampaigns(rows, "delivery").map((r) => r.name)).toEqual(["א", "ב", "ג"]);
    expect(CAMPAIGN_SORTS).toContain("name");
  });

  it("every new label exists in Hebrew, English and Arabic", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const p of PLAYBOOKS) expect(typeof d.campaigns.playbooks.items[p.id], `${l}.${p.id}`).toBe("string");
      for (const s of CAMPAIGN_SORTS) expect(typeof d.campaigns.sort[s], `${l}.sort.${s}`).toBe("string");
      for (const k of ["title", "hint", "price", "create", "making", "ready", "use", "refund", "notConfigured"]) expect(typeof d.social.video[k], `${l}.video.${k}`).toBe("string");
      for (const k of ["credits", "notConfigured", "safety", "busy", "timeout", "failed", "tooMany"]) expect(typeof d.social.video.err[k], `${l}.video.err.${k}`).toBe("string");
      for (const f of COPY_FRAMEWORKS) expect(typeof d.social.quality.fw[f], `${l}.fw.${f}`).toBe("string");
      for (const c of postQuality("x".repeat(20)).checks) {
        expect(typeof d.social.quality.tip[c.key], `${l}.tip.${c.key}`).toBe("string");
        expect(typeof d.social.quality.ok[c.key], `${l}.ok.${c.key}`).toBe("string");
      }
      expect(typeof d.social.power.aiVideo).toBe("string");
    }
  });
});

describe("AI video — the still camera line never leaks into the motion prompt", () => {
  it("lens numbers like f/2.0 are removed with their whole sentence", () => {
    const p = composeVideoPrompt(null, { request: "a test scene", aspect: "1:1", seconds: 8 }).prompt;
    expect(p).not.toMatch(/Camera: |^Video: [^.]*\. [^.]*\. 0,|\b0, shallow/);
    expect(p).toContain("Lighting:");
  });
});

describe("polish — dialogs stay centered (found in CI E2E)", () => {
  it("open animations never touch `translate` (Tailwind v4 centers dialogs with it) and keep nothing after they end", () => {
    const css = read("app/globals.css");
    for (const k of ["dlg-in", "ov-in", "pop-in"]) {
      const kf = css.match(new RegExp(`@keyframes ${k} \\{[^\\n]*\\}`))?.[0] ?? "";
      expect(kf, k).not.toBe("");
      expect(kf, k).not.toContain("translate");
      expect(css).toMatch(new RegExp(`animation: ${k} [^;]*backwards;`));
    }
    expect(read("components/ui/dialog.tsx")).toContain("sm:-translate-y-1/2");
  });
});
