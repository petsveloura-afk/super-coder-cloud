/**
 * The digital team — role catalog (pure data, extendable). Each role is a job description: level in the org chart,
 * domain, who it reports to, the tools it may use by default and its default autonomy. The professional standard of
 * every role lives in its playbook (lib/team/playbooks/<role>.ts) — data, not code.
 */
export const ROLE_KEYS = [
  "manager",
  "team_lead",
  "customer_service",
  "sales",
  "marketing",
  "content_writer",
  "web_builder",
  "analyst",
  "project_coordinator",
  "quality_control",
  "collections",
  "reputation",
  "custom",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type Level = "manager" | "lead" | "worker";
export type Domain = "management" | "content" | "sites" | "sales" | "support" | "data" | "finance" | "quality";
export type Autonomy = "suggest" | "approve" | "auto";

export interface RoleDef {
  key: RoleKey;
  level: Level;
  domain: Domain;
  reportsTo: RoleKey | null;
  tools: string[];
  autonomy: Autonomy;
  /** avatar defaults (the person can change them) */
  avatar: { hue: number; accessory: "tie" | "headset" | "pen" | "chart" | "brush" | "clipboard" | "shield" | "coin" | "star" | "spark" | "laptop" | "megaphone" | "none" };
  /** what makes this employee the right owner of a sub-task (the orchestrator matches on these) */
  skills: string[];
}

const READ = ["crm.find_contacts", "crm.contact_brief", "tasks.open", "analytics.day_metrics"];

export const ROLES: Record<RoleKey, RoleDef> = {
  manager: { key: "manager", level: "manager", domain: "management", reportsTo: null, tools: [...READ, "deals.stuck", "inbox.unanswered", "reviews.recent", "social.performance", "team.handoff", "team.ask_user", "crm.create_task"], autonomy: "approve", avatar: { hue: 222, accessory: "tie" }, skills: ["plan", "coordinate", "decide", "report", "goal"] },
  team_lead: { key: "team_lead", level: "lead", domain: "management", reportsTo: "manager", tools: [...READ, "team.handoff", "team.ask_user", "crm.create_task"], autonomy: "approve", avatar: { hue: 262, accessory: "clipboard" }, skills: ["review", "coordinate", "approve"] },
  customer_service: { key: "customer_service", level: "worker", domain: "support", reportsTo: "team_lead", tools: [...READ, "inbox.unanswered", "inbox.send_message", "crm.add_note", "crm.add_tag", "crm.remember", "crm.create_task", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 168, accessory: "headset" }, skills: ["support", "answer", "customer", "message", "complaint", "inbox"] },
  sales: { key: "sales", level: "worker", domain: "sales", reportsTo: "team_lead", tools: [...READ, "deals.stuck", "deals.create", "deals.move", "inbox.send_message", "crm.add_note", "crm.add_tag", "crm.remember", "crm.create_task", "calendar.book", "agents.run_sales_manager", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 142, accessory: "star" }, skills: ["sales", "lead", "deal", "follow", "meeting", "quote", "offer"] },
  marketing: { key: "marketing", level: "worker", domain: "content", reportsTo: "team_lead", tools: [...READ, "social.performance", "social.draft_post", "social.plan_week", "social.schedule_post", "campaigns.draft", "agents.run_marketing", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 330, accessory: "megaphone" }, skills: ["marketing", "social", "post", "campaign", "content", "ads", "instagram", "facebook"] },
  content_writer: { key: "content_writer", level: "worker", domain: "content", reportsTo: "team_lead", tools: [...READ, "social.draft_post", "campaigns.draft", "crm.create_task", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 28, accessory: "pen" }, skills: ["write", "copy", "article", "text", "email", "content"] },
  web_builder: { key: "web_builder", level: "worker", domain: "sites", reportsTo: "team_lead", tools: [...READ, "sites.list", "sites.build", "sites.audit", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 200, accessory: "brush" }, skills: ["site", "website", "landing", "page", "design", "seo"] },
  analyst: { key: "analyst", level: "worker", domain: "data", reportsTo: "team_lead", tools: [...READ, "deals.stuck", "social.performance", "reviews.recent", "agents.run_analyst", "crm.create_task", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 190, accessory: "chart" }, skills: ["report", "data", "numbers", "analysis", "kpi", "metrics", "why"] },
  project_coordinator: { key: "project_coordinator", level: "worker", domain: "management", reportsTo: "manager", tools: [...READ, "crm.create_task", "calendar.book", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 45, accessory: "clipboard" }, skills: ["schedule", "coordinate", "timeline", "task", "project", "deadline"] },
  quality_control: { key: "quality_control", level: "worker", domain: "quality", reportsTo: "manager", tools: [...READ, "team.ask_user"], autonomy: "approve", avatar: { hue: 280, accessory: "shield" }, skills: ["review", "quality", "check", "proofread"] },
  collections: { key: "collections", level: "worker", domain: "finance", reportsTo: "team_lead", tools: [...READ, "finance.overdue", "collections.send_reminder", "agents.run_collections", "crm.add_note", "crm.create_task", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 95, accessory: "coin" }, skills: ["invoice", "payment", "collect", "debt", "overdue", "finance"] },
  reputation: { key: "reputation", level: "worker", domain: "support", reportsTo: "team_lead", tools: [...READ, "reviews.recent", "reviews.draft_reply", "crm.add_note", "crm.create_task", "team.handoff", "team.ask_user"], autonomy: "approve", avatar: { hue: 50, accessory: "star" }, skills: ["review", "reputation", "google", "rating", "complaint"] },
  custom: { key: "custom", level: "worker", domain: "support", reportsTo: "team_lead", tools: [...READ, "crm.add_note", "crm.create_task", "team.handoff", "team.ask_user"], autonomy: "suggest", avatar: { hue: 210, accessory: "spark" }, skills: [] },
};

export function isRoleKey(v: unknown): v is RoleKey {
  return typeof v === "string" && (ROLE_KEYS as readonly string[]).includes(v);
}

/** a starter team for a new business: manager → lead → the core workers + quality control */
export const STARTER_TEAM: RoleKey[] = ["manager", "team_lead", "customer_service", "sales", "marketing", "analyst", "quality_control"];

export const LEVEL_ORDER: Record<Level, number> = { manager: 0, lead: 1, worker: 2 };
