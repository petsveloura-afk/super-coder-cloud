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
  /** Only shown to platform administrators (not an org permission). */
  platformOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "overview", label: "nav.overview", section: "core", phase: null, permission: "analytics.read" },
  { key: "crm", label: "nav.crm", section: "core", phase: null, permission: "contacts.read" },
  { key: "companies", label: "nav.companies", section: "core", phase: null, permission: "companies.read" },
  { key: "pipelines", label: "nav.pipelines", section: "core", phase: null, permission: "deals.read" },
  { key: "tasks", label: "nav.tasks", section: "core", phase: null, permission: "tasks.read" },
  { key: "inbox", label: "nav.inbox", section: "core", phase: null, permission: "inbox.read" },
  { key: "automations", label: "nav.automations", section: "growth", phase: null, permission: "automations.manage" },
  { key: "ai-agents", label: "nav.aiAgents", section: "growth", phase: null, permission: "ai.use" },
  { key: "campaigns", label: "nav.campaigns", section: "growth", phase: null, permission: "campaigns.manage" },
  { key: "websites", label: "nav.websites", section: "growth", phase: null, permission: "websites.manage" },
  { key: "forms", label: "nav.forms", section: "growth", phase: null, permission: "forms.manage" },
  { key: "appointments", label: "nav.appointments", section: "ops", phase: null, permission: "appointments.read" },
  { key: "analytics", label: "nav.analytics", section: "ops", phase: null, permission: "analytics.read" },
  { key: "support", label: "nav.support", section: "ops", phase: null, permission: "tickets.read" },
  { key: "finance", label: "nav.finance", section: "ops", phase: null, permission: "finance.read" },
  { key: "integrations", label: "nav.integrations", section: "ops", phase: null, permission: "integrations.manage" },
  { key: "team", label: "nav.team", section: "ops", phase: null, permission: "members.read" },
  { key: "billing", label: "nav.billing", section: "ops", phase: null, permission: "billing.read" },
  { key: "settings", label: "nav.settings", section: "ops", phase: null },
  { key: "admin", label: "nav.admin", section: "ops", phase: null, platformOnly: true },
];

export const MOBILE_PRIMARY = ["overview", "crm", "team", "settings"] as const;

export function findNavItem(key: string) {
  return NAV_ITEMS.find((i) => i.key === key);
}
