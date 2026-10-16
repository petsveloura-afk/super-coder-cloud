/**
 * Tool protocol between an agent's answer and the platform (pure, unit-tested).
 * The model ends its reply with one control line, e.g. "[[BUILD_SITE:landing]]";
 * the server strips it from the visible text and runs the tool.
 */
export type SiteKind = "landing" | "full";

const MARKER = /\[\[\s*BUILD_SITE\s*(?::\s*(landing|full))?\s*\]\]/i;

export function parseAgentReply(text: string): { text: string; buildSite: SiteKind | null } {
  const m = text.match(MARKER);
  if (!m) return { text: text.trim(), buildSite: null };
  const kind = (m[1]?.toLowerCase() as SiteKind | undefined) ?? "landing";
  return { text: text.replace(new RegExp(MARKER.source, "gi"), "").replace(/\n{3,}/g, "\n\n").trim(), buildSite: kind };
}

export function siteToolInstructions(opts: { canBuild: boolean; full: boolean; images: boolean }): string {
  if (!opts.canBuild) return "";
  return [
    "PLATFORM TOOL — website builder:",
    "You can create a real, professionally designed landing page (or full website) for the customer inside this platform; it is saved as a draft the team reviews and publishes.",
    "• When the customer asks for a landing page / website / דף נחיתה / אתר / موقع and you know at least the business name, what it offers and who it is for,",
    "  answer with a short confirmation of what will be built, then put EXACTLY one control line at the very end:",
    "  [[BUILD_SITE:landing]]  — a one-page landing page",
    opts.full ? "  [[BUILD_SITE:full]]     — a full multi-section website (when they ask for a full site)" : "  (Full websites and AI images are not included in this workspace's plan: offer a landing page and mention that a full site needs a paid plan.)",
    "• If essential details are missing, ask at most 2 short questions first (no control line yet).",
    "• Never paste HTML or code and never claim the site is published — the platform builds it and shows a link.",
    opts.images ? "• The site gets an AI-generated hero image automatically." : "",
  ]
    .filter(Boolean)
    .join("\n");
}
