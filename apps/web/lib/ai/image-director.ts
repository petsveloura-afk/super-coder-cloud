import "server-only";
import { generateRouted } from "./router";
import { ART_DIRECTOR_SYSTEM, artDirectorUser, composeImagePrompt, defaultBrief, mergeBrief, parseBrief, type DirectInput, type DirectedImage } from "./image-director-core";

/**
 * The image director: one short text-model call (free router, no credit) turns the request into a full art-direction
 * brief, then the pure composer writes the professional prompt. Never blocks: when the text model is busy or answers
 * badly, the deterministic brief (industry scenes + style + quality rules) is used — still far richer than a one-liner.
 */
export async function directImage(input: DirectInput, opts: { budgetMs?: number } = {}): Promise<DirectedImage & { directed: boolean }> {
  const base = defaultBrief(input);
  try {
    const r = await generateRouted({
      system: ART_DIRECTOR_SYSTEM,
      messages: [{ role: "user", content: artDirectorUser(input) }],
      temperature: 0.6,
      maxTokens: 420,
      json: true,
      budgetMs: opts.budgetMs ?? 9000,
      maxCalls: 2,
      lane: "interactive",
      hint: "fast",
    });
    const brief = mergeBrief(parseBrief(r.text), base);
    return { ...composeImagePrompt(brief, input), directed: brief.subject !== base.subject || Boolean(brief.lighting || brief.composition) };
  } catch (e) {
    console.error("image director: text model unavailable, using the built-in brief", (e as Error).message);
    return { ...composeImagePrompt(base, input), directed: false };
  }
}
