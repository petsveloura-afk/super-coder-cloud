/** Shapes the AI team screen receives from the server page (plain JSON, no secrets). */
export type MemberStatus = "active" | "paused";
export type LiveState = "idle" | "working" | "waiting" | "success" | "error" | "paused";

export interface AvatarSpec {
  hue?: number;
  accessory?: string;
  face?: "smile" | "focus" | "cheer" | "calm";
  skin?: "light" | "tan" | "brown" | "dark";
  hair?: "short" | "long" | "curly" | "bun" | "none";
}

export interface TeamMemberView {
  id: string;
  role_key: string;
  name: string;
  title: string | null;
  avatar: AvatarSpec;
  tone: string | null;
  instructions: string;
  tools: string[];
  autonomy: "suggest" | "approve" | "auto";
  auto_actions: string[];
  reports_to: string | null;
  status: MemberStatus;
  limits: { max_steps?: number; max_credits?: number };
  position: number;
  live: LiveState;
  working_on: string | null;
  last_learned: string | null;
}

export interface TeamTaskView {
  id: string;
  title: string;
  brief: string;
  status: string;
  priority: number;
  assignee_id: string | null;
  goal_id: string | null;
  parent_id: string | null;
  origin: string;
  question: string | null;
  depends_on: string[];
  credits_used: number;
  created_at: string;
  finished_at: string | null;
  plan: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface ApprovalView {
  id: string;
  task_id: string | null;
  member_id: string | null;
  tool: string;
  preview: string;
  reason: string;
  sensitivity: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MemoryView {
  id: string;
  member_id: string | null;
  layer: "episodic" | "semantic";
  kind: string;
  subject: string | null;
  content: string;
  confidence: number;
  status: string;
  created_at: string;
}

export interface ActivityView {
  id: number;
  task_id: string | null;
  member_id: string | null;
  phase: string;
  summary: string;
  ok: boolean;
  created_at: string;
}

export interface StatsView {
  done: number;
  failed: number;
  approvedClean: number;
  edited: number;
  rejected: number;
  escalations: number;
  avgMinutes: number | null;
  credits: number;
  approvalRate: number | null;
  rejectionRate: number | null;
}

export interface TeamSettingsView {
  enabled: boolean;
  emergency_stop: boolean;
  routing_pref: "quality" | "balanced" | "speed" | "cost";
  daily_credit_cap: number;
  max_depth: number;
  max_steps: number;
  initiative: boolean;
}

/** upgrade 2: the team health card (optional — absent when the data could not be loaded) */
export interface TeamHealthData {
  level: "ok" | "degraded" | "down";
  issues: string[];
  models: { key: string; circuit: "closed" | "open" | "half_open"; openForMs: number; lastError: string | null; failRate: number; total: number }[];
  failures: { id: string; title: string; reason: string; error: string | null; at: string | null }[];
  stuck: number;
  failed24h: number;
}

/** upgrade 3: operating rules + first-response time + work templates (all optional on the screen) */
export interface TeamOpsData {
  quiet: { enabled: boolean; start: number; end: number };
  sla: { targetMin: number };
  digest: { daily: boolean; weekly: boolean };
  dedupe: boolean;
  protect: { rateLimits: boolean; anomalyFreeze: boolean; recipientCap: number };
}
export interface TeamSlaData {
  targetMin: number;
  total: number;
  breached: number;
  warning: number;
  avgMinutes: number;
}

export interface TeamPageData {
  /** server time of the snapshot (live states + relative times use it) */
  now: number;
  canManage: boolean;
  platformAdmin: boolean;
  settings: TeamSettingsView;
  members: TeamMemberView[];
  tasks: TeamTaskView[];
  approvals: ApprovalView[];
  memory: MemoryView[];
  activity: ActivityView[];
  stats: Record<string, StatsView>;
  playbookExtras: Record<string, string>;
  meeting: { created_at: string; narrative: string | null; facts: Record<string, unknown> } | null;
  routing: { kind: string; models: { provider: string; model: string }[] }[];
  models: { provider: string; model: string }[];
  toolCatalog: { key: string; kind: string; sensitivity: string; about: string }[];
  dayCredits: number;
  health?: TeamHealthData;
  ops?: TeamOpsData;
  sla?: TeamSlaData;
  templates?: { id: string; role: string; brief: string }[];
  /** upgrade 7: versioned business facts (absent when the migration was not run) */
  facts?: TeamFactsData;
}

export interface TeamFactsData {
  rows: import("@/lib/team/business-facts-core").FactVersion[];
}
