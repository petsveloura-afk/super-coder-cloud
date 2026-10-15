import type { Permission } from "@scc/shared/permissions";
import type { TKey } from "@/lib/i18n/translate";

export type NavSection = "core" | "growth" | "ops";

export interface NavItem {
  key: string;
  label: TKey;
  section: NavSection;
  /** null → implemented and live. A number → scheduled build phase (shown honestly as not implemented). */
  phase: number | null;
  permission?: Permission;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "nav.overview", section: "core", phase: null, permission: "analytics.read" },
  { key: "crm", label: "nav.crm", section: "core", phase: null, permission: "contacts.read" },
  { key: "pipelines", label: "nav.pipelines", section: "core", phase: 2, permission: "deals.read" },
  { key: "inbox", label: "nav.inbox", section: "core", phase: 5 },
  { key: "automations", label: "nav.automations", section: "growth", phase: 3 },
  { key: "ai-agents", label: "nav.aiAgents", section: "growth", phase: null, permission: "ai.use" },
  { key: "campaigns", label: "nav.campaigns", section: "growth", phase: 5 },
  { key: "websites", label: "nav.websites", section: "growth", phase: 6 },
  { key: "forms", label: "nav.forms", section: "growth", phase: 5 },
  { key: "appointments", label: "nav.appointments", section: "ops", phase: 5 },
  { key: "analytics", label: "nav.analytics", section: "ops", phase: 2 },
  { key: "support", label: "nav.support", section: "ops", phase: 6 },
  { key: "finance", label: "nav.finance", section: "ops", phase: 6 },
  { key: "integrations", label: "nav.integrations", section: "ops", phase: 3 },
  { key: "team", label: "nav.team", section: "ops", phase: null, permission: "members.read" },
  { key: "billing", label: "nav.billing", section: "ops", phase: null, permission: "billing.read" },
  { key: "settings", label: "nav.settings", section: "ops", phase: null },
];

export const MOBILE_PRIMARY = ["overview", "crm", "team", "settings"] as const;

export function findNavItem(key: string) {
  return NAV_ITEMS.find((i) => i.key === key);
}
