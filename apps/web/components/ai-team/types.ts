/** Shapes the AI team screen receives from the server page (plain JSON, no secrets). */
import type { OwnerLogEntry } from "@/lib/team/owner-control-core";

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
  /** why a failed / blocked task stopped (technical code — shown to the owner as one clear sentence) */
  error?: string | null;
  attempts?: number | null;
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
  /** wave 67: how many identical rows were merged into this one (absent = 1) */
  count?: number;
  /** wave 67: the stored text before display translation (what an edit starts from) */
  raw?: string;
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

/** wave 68: today's health for the owner */
export interface DayHealthView {
  windowHours: number;
  done: number;
  failed: number;
  reasons: { code: string; count: number }[];
  providers: { provider: string; calls: number; successPct: number | null; status: "healthy" | "neutral" | "shaky" | "degraded" }[];
  /** false = the AI providers list is hidden (platform-admin detail); missing = shown */
  showProviders?: boolean;
}

/** upgrade 2: the team health card (optional — absent when the data could not be loaded) */
export interface TeamHealthData {
  level: "ok" | "degraded" | "down";
  issues: string[];
  models: { key: string; circuit: "closed" | "open" | "half_open"; openForMs: number; lastError: string | null; failRate: number; total: number }[];
  failures: { id: string; title: string; reason: string; error: string | null; at: string | null }[];
  stuck: number;
  failed24h: number;
  /** false = the AI models list is not shown (it is for the platform admin); missing = shown (old behaviour) */
  showModels?: boolean;
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
  /** upgrade 8: the business id (passed to the part-B panels) */
  orgId?: string;
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
  /** today's cap including credits bought in the last 24h (the cap the team really works against) */
  dayCap?: number;
  health?: TeamHealthData;
  /** wave 68: today's health card (absent when it could not be loaded) */
  dayHealth?: DayHealthView;
  /** wave 70: the team log in the owner's words (absent when it could not be loaded) */
  ownerLog?: OwnerLogEntry[];
  ops?: TeamOpsData;
  sla?: TeamSlaData;
  templates?: { id: string; role: string; brief: string }[];
  /** upgrade 7: versioned business facts (absent when the migration was not run) */
  facts?: TeamFactsData;
  /** upgrade 7 / stages C–J (each part absent when its migration was not run) */
  plus7?: TeamPlus7Data;
  /** upgrade 8: stability (skipped engines, tasks needing attention, response queue) — absent when it could not be loaded */
  plus8?: TeamPlus8Data;
}

export interface TeamPlus8Data {
  skipped: { key: string; reason: string; text: string; help: string | null }[];
  attention: { id: string; title: string; status: string; label: string; action: string; reason: string; ageDays: number }[];
  staleBlocked: number;
  response?: { targetMin: number; line: string; alert: { level: "none" | "warn" | "alert"; text: string }; queue: { id: string; waitingMin: number; state: "ok" | "warning" | "breached" }[] };
}

export interface TeamPlus7Data {
  goals?: { goal: import("@/lib/team/goals-core").Goal; forecast: import("@/lib/team/goals-core").Forecast }[];
  experiments?: import("@/lib/team/experiments-core").Experiment[];
  decisions?: { id: string; task_id: string; route: "fast" | "deep"; route_reasons: string[]; record: Omit<import("@/lib/team/decision-core").DecisionRecord, "id" | "hash" | "prev_hash" | "seq">; confidence: number; audit_verdict: string | null; created_at: string }[];
  standup?: string[];
  report?: { title: string; text: string; period_start: string };
  brief?: { text: string };
}

export interface TeamFactsData {
  rows: import("@/lib/team/business-facts-core").FactVersion[];
}
