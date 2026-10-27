import "server-only";
import type { z } from "zod";
import type { siteSchema } from "@scc/shared/engagement";
import type { Locale } from "@/lib/i18n/config";
import { runAI } from "./run";
import { extractJson, normalizeAiSite, siteJsonInstructionsPro } from "./site-json";
import { FREE_TEMPLATES, ALL_TEMPLATES } from "@/lib/site/templates";
import { blockTexts, detectSiteLanguage, restoreKept, siteEditOverrides } from "./site-edit-rules";

/**
 * Wave 13 — edit an existing site with the AI ("make it more modern", "add pricing",
 * "rewrite in English"). The model gets the current JSON and returns the whole
 * updated JSON; the result is validated exactly like a newly built site, and form /
 * booking embeds and uploaded images are kept.
 */
type Site = z.infer<typeof siteSchema>;

export async function editSiteWithAI(input: { orgId: string; locale: Locale; instruction: string; site: Site; proTemplates: boolean }): Promise<{ ok: true; site: { name: string; theme: Record<string, unknown>; seo: { title: string; description: string }; blocks: unknown[] } } | { ok: false; error: string }> {
  const templates = input.proTemplates ? ALL_TEMPLATES.map((t) => t.key) : FREE_TEMPLATES;
  // keep the current template first so the model only switches when asked
  const ordered = input.site.theme.template && templates.includes(input.site.theme.template) ? [input.site.theme.template, ...templates.filter((t) => t !== input.site.theme.template)] : templates;
  const form = input.site.blocks.find((b) => b.type === "form");
  const booking = input.site.blocks.find((b) => b.type === "booking");
  const ctx = { formSlug: form?.type === "form" ? form.data.form_slug || null : null, bookingSlug: booking?.type === "booking" ? booking.data.booking_slug || null : null };
  const current = { name: input.site.name, accent: input.site.theme.accent, mode: input.site.theme.mode, template: input.site.theme.template ?? ordered[0], accent2: input.site.theme.accent2, font: input.site.theme.font, radius: input.site.theme.radius, seo: input.site.seo, blocks: input.site.blocks };
  const system = [
    "You are editing an EXISTING website. Apply the owner's instruction and return the COMPLETE updated website JSON (same shape as below).",
    "Keep everything the instruction does not mention: section order, texts, image_url values, links, form_slug / booking_slug, contact details. Never invent phone numbers, emails, prices, reviews or client names.",
    "If asked to change the language, translate every visible text. If asked to change the style, you may change template / accent / accent2 / font / radius / mode.",
    "",
    siteJsonInstructionsPro("full", input.locale, ctx, ordered),
    "",
    // wave 33: edit-specific rules (keep language + every section, add requested sections even without data)
    siteEditOverrides(detectSiteLanguage([input.site.name, ...blockTexts(input.site.blocks)])),
  ].join("\n");
  const currentJson = JSON.stringify(current);
  // wave 33: big sites need more room for the full JSON answer (a cut-off answer was reported as "invalid")
  const maxTokens = Math.min(12000, Math.max(8000, Math.ceil(currentJson.length / 2.2) + 3000));
  const ask = (extra = "") =>
    runAI({
      orgId: input.orgId,
      feature: "site_builder",
      system: extra ? `${system}\n${extra}` : system,
      messages: [{ role: "user", content: `Instruction: ${input.instruction}\n\nCurrent website JSON:\n${currentJson.slice(0, 60000)}` }],
      temperature: 0.4,
      maxTokens,
      json: true,
    });
  const t0 = Date.now();
  let out = await ask();
  if (!out.ok) return { ok: false, error: out.error };
  // wave 33: one quiet retry when the answer was not usable JSON (cut off / chatter) — never on provider errors
  // (wave 34: only when there is time left — a second full call after a slow first one would run into the platform limit)
  if (extractJson(out.text) === null && Date.now() - t0 < 25_000) {
    const again = await ask("IMPORTANT: your previous answer could not be parsed. Reply with ONE complete, valid JSON object only — no markdown, no comments — and keep texts concise.");
    if (again.ok) out = again;
  }
  const site = normalizeAiSite(extractJson(out.text), "full", ctx, input.site.name, { maxBlocks: 40, templates: ordered, keepOrder: true });
  if (!site) {
    console.error("ai site edit unusable", out.text.slice(0, 300));
    return { ok: false, error: "websites.aiInvalid" };
  }
  // a blank image in the answer never wipes an image the business uploaded
  const prevImages = new Map(input.site.blocks.map((b, i) => [i, "image_url" in b.data ? (b.data as { image_url?: string }).image_url : undefined]));
  site.blocks.forEach((b, i) => {
    if ("image_url" in b.data && !(b.data as { image_url?: string }).image_url && prevImages.get(i) && input.site.blocks[i]?.type === b.type) (b.data as { image_url?: string }).image_url = prevImages.get(i);
  });
  // wave 34: contact details / images the model forgot come back (matched by section type, not by position)
  restoreKept(input.site.blocks as unknown as { type: string; data: Record<string, unknown> }[], site.blocks as unknown as { type: string; data: Record<string, unknown> }[], input.instruction);
  return { ok: true, site: { name: site.name, theme: { ...input.site.theme, ...site.theme }, seo: site.seo, blocks: site.blocks } };
}
