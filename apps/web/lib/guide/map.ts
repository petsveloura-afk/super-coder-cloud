/**
 * Wave 23 — the in-app user guide (/[locale]/guide) and the help button on every screen.
 * Pure mapping, unit-tested:
 *   guideLinks(locale)   step → the screen it explains ("open this screen in the system")
 *   stepForPath(path)    the screen the user is on → the guide step that explains it
 */
const SCREEN: Record<string, string | null> = {
  "s01-signup": null,
  "s02-onboarding": null,
  "s03-overview-new": "overview",
  "s04-quick-agent": "ai-agents",
  "s20-agent-setup": "ai-agents",
  "s20b-hours": "ai-agents",
  "s21-guardrails": "ai-agents",
  "s05-wa-hero": "integrations",
  "s06-wa-qr": "integrations",
  "s07-wa-code": "integrations",
  "s22-telegram": "integrations",
  "s08-overview": "overview",
  "s09-inbox": "inbox",
  "s10-handoff": "inbox",
  "s11-crm": "crm",
  "s12-contact": "crm",
  "s13-pipelines": "pipelines",
  "s14-tasks": "tasks",
  "s15-appointments": "appointments",
  "s16-automations": "automations",
  "s17-campaigns": "campaigns",
  "s18-websites": "websites",
  "s19-analytics": "analytics",
  "s24-team": "team",
  "s23-billing": "billing",
  "s25-settings": "settings",
  "m01-phone-overview": "overview",
  "m02-phone-inbox": "inbox",
  "m03-phone-more": "overview",
};

export const GUIDE_STEPS = Object.keys(SCREEN);

export function guideLinks(locale: string): Record<string, string | null> {
  return Object.fromEntries(Object.entries(SCREEN).map(([k, v]) => [k, v ? `/${locale}/${v}` : null]));
}

/** "/he/crm/123" → "s12-contact"; unknown screens → null (the guide opens at the start). */
export function stepForPath(pathname: string): string | null {
  const parts = pathname.split("?")[0]!.split("#")[0]!.split("/").filter(Boolean);
  const [, mod, sub] = parts;
  switch (mod) {
    case "overview":
      return "s08-overview";
    case "inbox":
      return "s09-inbox";
    case "crm":
      return sub ? "s12-contact" : "s11-crm";
    case "companies":
      return "s11-crm";
    case "pipelines":
      return "s13-pipelines";
    case "tasks":
      return "s14-tasks";
    case "appointments":
      return "s15-appointments";
    case "automations":
      return "s16-automations";
    case "campaigns":
      return "s17-campaigns";
    case "websites":
      return "s18-websites";
    case "analytics":
      return "s19-analytics";
    case "ai-agents":
      return pathname.includes("/setup") ? "s20-agent-setup" : "s04-quick-agent";
    case "agents":
      return "s04-quick-agent";
    case "integrations":
      return "s05-wa-hero";
    case "team":
      return "s24-team";
    case "billing":
      return "s23-billing";
    case "settings":
      return "s25-settings";
    default:
      return null;
  }
}

/** The guide page itself never shows the help button. */
export function isGuidePath(pathname: string): boolean {
  return /^\/[a-z]{2}\/guide(\/|$|#|\?)/.test(pathname);
}
