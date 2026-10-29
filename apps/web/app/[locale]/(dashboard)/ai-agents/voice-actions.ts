"use server";

import { revalidatePath } from "next/cache";
import { uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, type ActionState } from "@/lib/action-state";
import { normalizeVoice } from "@/lib/ai/voice-persona-core";

/** Wave 55 — the agent's voice persona (ElevenLabs / OpenAI settings + speech-to-text glossary). */
const loc = (l: unknown) => (l === "ar" || l === "en" ? l : "he") as "he" | "ar" | "en";

export async function saveVoiceAction(input: { locale: string; agentId: string; voice: unknown }): Promise<ActionState> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const id = uuidSchema.safeParse(input.agentId);
  if (!id.success) return { error: "validation.invalidId" };
  const voice = normalizeVoice(input.voice);
  if (voice.preset === "custom" && !voice.voice_id) return { error: "voicePersona.needVoiceId" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (voice.preset !== "default" && !(await orgHasFeature(ctx.org.id, "voice_notes"))) return { error: "plans.locked.voice_notes.title" };
  const supabase = await createClient();
  const { error } = await supabase.from("ai_agents").update({ voice }).eq("id", id.data).eq("organization_id", ctx.org.id);
  if (error) return { error: dbErrorKey(error) };
  revalidatePath(`/${locale}/ai-agents/${id.data}/setup`);
  return { ok: true, message: "voicePersona.saved" };
}

/** Plays a short sample with the settings on screen (not saved). Returns a data: URL. */
export async function previewVoiceAction(input: { locale: string; voice: unknown; text: string }): Promise<ActionState<{ url: string; provider: string }>> {
  const locale = loc(input.locale);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("ai.manage")) return { error: "errors.forbidden" };
  const text = String(input.text ?? "").trim().slice(0, 220);
  if (text.length < 2) return { error: "voicePersona.previewEmpty" };
  const { orgHasFeature } = await import("@/lib/billing/features");
  if (!(await orgHasFeature(ctx.org.id, "voice_notes"))) return { error: "plans.locked.voice_notes.title" };
  const { ttsConfigured } = await import("@/lib/ai/tts");
  if (!ttsConfigured()) return { error: "voicePersona.noKey" };
  const { synthesizePersonaVoice } = await import("@/lib/ai/voice-persona");
  const audio = await synthesizePersonaVoice(text, locale, normalizeVoice(input.voice), { force: true, maxChars: 220 });
  if (!audio) return { error: "voicePersona.previewFailed" };
  return { ok: true, data: { url: `data:${audio.mime};base64,${audio.buf.toString("base64")}`, provider: audio.provider } };
}
