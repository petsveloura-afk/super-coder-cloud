import { describe, expect, it } from "vitest";
import { ACTION_TYPES, AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, automationActionSchema, automationSchema } from "../src/automations";
import {
  ACTION_CATEGORIES,
  TRIGGER_CATEGORIES,
  analyzeAutomation,
  automationHealth,
  contactPresence,
  dailyBuckets,
  delayParts,
  describeFlow,
  matchesQuery,
  recipeCategory,
  suggestActions,
  summarizeRuns,
  templateVariables,
  triggerCategory,
  variablesForTrigger,
} from "../src/automation-intel";

const codes = (d: Parameters<typeof analyzeAutomation>[0]) => analyzeAutomation(d).insights.map((i) => i.code);

describe("catalogue coverage", () => {
  it("every trigger belongs to exactly one category", () => {
    const all = Object.values(TRIGGER_CATEGORIES).flat() as string[];
    for (const t of AUTOMATION_TRIGGERS) expect(all.filter((x) => x === t), t).toHaveLength(1);
    expect(new Set(all).size).toBe(AUTOMATION_TRIGGERS.length);
  });
  it("every action belongs to exactly one category", () => {
    const all = Object.values(ACTION_CATEGORIES).flat() as string[];
    for (const a of ACTION_TYPES) expect(all.filter((x) => x === a), a).toHaveLength(1);
    expect(all).toHaveLength(ACTION_TYPES.length);
  });
  it("every recipe resolves to a category and passes the analyzer without errors", () => {
    for (const r of AUTOMATION_RECIPES) {
      expect(recipeCategory(r.key, r.trigger_type)).toBeTruthy();
      const a = analyzeAutomation({ trigger_type: r.trigger_type, trigger_config: r.trigger_config, conditions: r.conditions, actions: r.actions });
      expect(a.counts.error, `${r.key}: ${JSON.stringify(a.insights)}`).toBe(0);
    }
  });
});

describe("analyzer", () => {
  it("flags an empty automation and missing fields", () => {
    expect(codes({ trigger_type: "contact.created", actions: [] })).toContain("noActions");
    const a = analyzeAutomation({ trigger_type: "contact.created", actions: [{ type: "create_task", config: { title: "  " } }] });
    expect(a.insights.find((i) => i.code === "emptyField")?.actionIndex).toBe(0);
    expect(a.grade).toBe("risky");
  });
  it("detects self-triggering loops", () => {
    expect(codes({ trigger_type: "contact.tagged", trigger_config: { tag: "vip" }, actions: [{ type: "add_tag", config: { tag: "vip" } }] })).toContain("loopTag");
    expect(codes({ trigger_type: "contact.status_changed", actions: [{ type: "set_contact_status", config: { status: "customer" } }] })).toContain("loopStatus");
    expect(codes({ trigger_type: "deal.stage_changed", actions: [{ type: "set_deal_stage", config: { stage_id: "x" } }] })).toContain("loopStage");
    expect(codes({ trigger_type: "contact.tagged", trigger_config: { tag: "a" }, actions: [{ type: "add_tag", config: { tag: "b" } }] })).not.toContain("loopTag");
  });
  it("knows which records a trigger carries", () => {
    expect(contactPresence("contact.created")).toBe("always");
    expect(contactPresence("order.created")).toBe("maybe");
    expect(codes({ trigger_type: "contact.created", actions: [{ type: "set_deal_stage", config: { stage_id: "x" } }] })).toContain("dealUnavailable");
    expect(codes({ trigger_type: "contact.created", actions: [{ type: "notify", config: { text: "{{deal.title}}" } }] })).toContain("varDealUnavailable");
    expect(codes({ trigger_type: "deal.won", actions: [{ type: "notify", config: { text: "{{deal.title}}" } }] })).not.toContain("varDealUnavailable");
  });
  it("catches unknown and malformed variables", () => {
    expect(codes({ trigger_type: "deal.won", actions: [{ type: "notify", config: { text: "{{foo.bar}}" } }] })).toContain("varUnknown");
    expect(codes({ trigger_type: "deal.won", actions: [{ type: "notify", config: { text: "{{Contact.Name}}" } }] })).toContain("varMalformed");
  });
  it("catches hygiene problems: duplicates, tag conflicts, noisy outbound", () => {
    const dup = { type: "add_tag", config: { tag: "x" } };
    expect(codes({ trigger_type: "contact.created", actions: [dup, { ...dup }] })).toContain("duplicateAction");
    expect(codes({ trigger_type: "contact.created", actions: [dup, { type: "remove_tag", config: { tag: "x" } }] })).toContain("tagConflict");
    expect(codes({ trigger_type: "message.received", actions: [{ type: "send_sms", config: { text: "hi" } }] })).toContain("broadOutbound");
    expect(codes({ trigger_type: "message.received", conditions: [{ field: "contact.status", op: "eq", value: "lead" }], actions: [{ type: "send_sms", config: { text: "hi" } }] })).not.toContain("broadOutbound");
  });
  it("validates conditions", () => {
    expect(codes({ trigger_type: "contact.created", conditions: [{ field: "contact.source", op: "eq", value: "" }], actions: [{ type: "add_tag", config: { tag: "a" } }] })).toContain("emptyConditionValue");
    expect(codes({ trigger_type: "contact.created", conditions: [{ field: "deal.value", op: "gt", value: "5" }], actions: [{ type: "add_tag", config: { tag: "a" } }] })).toContain("conditionDealUnavailable");
    expect(codes({ trigger_type: "deal.won", conditions: [{ field: "deal.value", op: "gt", value: "abc" }], actions: [{ type: "add_tag", config: { tag: "a" } }] })).toContain("numericOnly");
  });
  it("scores a clean automation as excellent and never exceeds 0–100", () => {
    const a = analyzeAutomation({ trigger_type: "deal.won", conditions: [{ field: "deal.value", op: "gt", value: "1000" }], actions: [{ type: "notify", config: { to: "all", text: "🏆 {{deal.title}}" } }, { type: "add_note", config: { body: "won" } }] });
    expect(a.score).toBeGreaterThanOrEqual(92);
    expect(a.grade).toBe("excellent");
    const bad = analyzeAutomation({ trigger_type: "contact.created", actions: Array.from({ length: 20 }, () => ({ type: "create_task", config: { title: "" } })) });
    expect(bad.score).toBe(0);
  });
  it("sorts insights by severity", () => {
    const a = analyzeAutomation({ trigger_type: "contact.created", actions: [{ type: "create_task", config: { title: "" } }, { type: "send_whatsapp", config: { text: "hi" } }] });
    const sev = a.insights.map((i) => i.severity);
    expect(sev).toEqual([...sev].sort((x, y) => ["error", "warning", "tip", "ok"].indexOf(x) - ["error", "warning", "tip", "ok"].indexOf(y)));
  });
  it("never throws on sloppy builder state", () => {
    expect(() => analyzeAutomation({ trigger_type: "x", actions: [{ type: "weird", config: undefined as unknown as Record<string, unknown> }], conditions: [{ field: "a", op: "eq" }] })).not.toThrow();
  });
});

describe("flow, delays and variables", () => {
  it("describes trigger → conditions → actions in order", () => {
    const f = describeFlow({ trigger_type: "deal.won", conditions: [{ field: "deal.value", op: "gt", value: "1" }], actions: [{ type: "notify", config: { text: "x", delay_minutes: 60 } }] });
    expect(f.map((n) => n.kind)).toEqual(["trigger", "condition", "action"]);
    expect(f[2]).toMatchObject({ kind: "action", delayMinutes: 60, category: "team" });
  });
  it("turns minutes into friendly parts", () => {
    expect(delayParts(0)).toEqual({ value: 0, unit: "now" });
    expect(delayParts(5)).toEqual({ value: 5, unit: "minutes" });
    expect(delayParts(60)).toEqual({ value: 1, unit: "hours" });
    expect(delayParts(1440)).toEqual({ value: 1, unit: "days" });
    expect(delayParts(20160)).toEqual({ value: 2, unit: "weeks" });
  });
  it("offers trigger-aware variables", () => {
    expect(variablesForTrigger("deal.won")).toContain("deal.title");
    expect(variablesForTrigger("contact.created")).not.toContain("deal.title");
    expect(variablesForTrigger("order.created")).toContain("payload.total");
    expect(templateVariables({ a: "{{ contact.first_name }} and {{deal.title}}", n: 3 }).sort()).toEqual(["contact.first_name", "deal.title"]);
  });
});

describe("suggestions", () => {
  it("every suggested action is valid against the real schema", () => {
    for (const trig of AUTOMATION_TRIGGERS) {
      for (const s of suggestActions({ trigger_type: trig, actions: [{ type: "add_tag", config: { tag: "x" } }] })) {
        expect(automationActionSchema.safeParse(s.action).success, `${trig}/${s.code}`).toBe(true);
      }
    }
  });
  it("never suggests something the automation already does and stays within 3", () => {
    const s = suggestActions({ trigger_type: "deal.won", actions: [{ type: "notify", config: { text: "x" } }] });
    expect(s.every((x) => x.action.type !== "notify")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(3);
  });
  it("an analyzed recipe + any suggestion still builds a valid automation", () => {
    for (const r of AUTOMATION_RECIPES) {
      const extra = suggestActions(r).map((s) => s.action);
      const res = automationSchema.safeParse({ name: r.key, trigger_type: r.trigger_type, trigger_config: r.trigger_config, conditions: r.conditions, actions: [...r.actions, ...extra].slice(0, 20) });
      expect(res.success, r.key).toBe(true);
    }
  });
});

describe("run statistics", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const runs = [
    { status: "success", created_at: "2026-11-08T10:00:00Z" },
    { status: "success", created_at: "2026-11-07T10:00:00Z" },
    { status: "partial", created_at: "2026-11-07T11:00:00Z" },
    { status: "failed", created_at: "2026-11-06T09:00:00Z" },
    { status: "skipped", created_at: "2026-11-06T09:30:00Z" },
  ];
  it("summarizes without counting skipped runs as executions", () => {
    const s = summarizeRuns(runs);
    expect(s).toMatchObject({ total: 5, success: 2, partial: 1, failed: 1, skipped: 1, executed: 4, lastRunAt: "2026-11-08T10:00:00Z" });
    expect(s.successRate).toBe(63);
    expect(summarizeRuns([]).successRate).toBeNull();
  });
  it("buckets by day (oldest → newest) and ignores skipped", () => {
    const b = dailyBuckets(runs, 3, now);
    expect(b.map((x) => x.day)).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(b.map((x) => [x.ok, x.bad])).toEqual([[0, 1], [1, 1], [1, 0]]);
  });
  it("derives health", () => {
    expect(automationHealth(false, summarizeRuns(runs))).toBe("disabled");
    expect(automationHealth(true, summarizeRuns([]))).toBe("idle");
    expect(automationHealth(true, summarizeRuns(runs))).toBe("attention");
    expect(automationHealth(true, summarizeRuns([{ status: "failed", created_at: "2026-11-08T10:00:00Z" }]))).toBe("failing");
    expect(automationHealth(true, summarizeRuns([{ status: "success", created_at: "2026-11-08T10:00:00Z" }]))).toBe("healthy");
  });
});

describe("helpers", () => {
  it("search matches every word across fields", () => {
    expect(matchesQuery(["Welcome lead", "contact.created"], "welcome created")).toBe(true);
    expect(matchesQuery(["Welcome lead"], "nope")).toBe(false);
    expect(matchesQuery([null, undefined], "")).toBe(true);
  });
  it("triggerCategory falls back safely", () => {
    expect(triggerCategory("deal.won")).toBe("sales");
    expect(triggerCategory("unknown.thing")).toBe("crm");
  });
});

describe("agent-aware check (double reply)", () => {
  const draft = (extra: Partial<Parameters<typeof analyzeAutomation>[0]> = {}) => ({
    trigger_type: "message.received",
    actions: [{ type: "send_whatsapp", config: { text: "שלום {{contact.first_name}}" } }],
    ...extra,
  });
  const agent = { name: "Dana", enabled: true, autopilotChannels: ["whatsapp"] };

  it("warns when an enabled agent already answers on the same channel", () => {
    const a = analyzeAutomation(draft(), { agents: [agent] });
    const hit = a.insights.find((i) => i.code === "agentDoubleReply");
    expect(hit?.severity).toBe("warning");
    expect(hit?.params).toEqual({ n: 1, agent: "Dana" });
  });
  it("is only a tip when the automation has a condition", () => {
    const a = analyzeAutomation(draft({ conditions: [{ field: "contact.status", op: "eq", value: "lead" }] }), { agents: [agent] });
    expect(a.insights.find((i) => i.code === "agentDoubleReply")?.severity).toBe("tip");
  });
  it("stays silent for a different channel, a disabled agent, no autopilot, another trigger, or no context", () => {
    expect(analyzeAutomation(draft(), { agents: [{ ...agent, autopilotChannels: ["telegram"] }] }).insights.some((i) => i.code === "agentDoubleReply")).toBe(false);
    expect(analyzeAutomation(draft(), { agents: [{ ...agent, enabled: false }] }).insights.some((i) => i.code === "agentDoubleReply")).toBe(false);
    expect(analyzeAutomation(draft(), { agents: [{ ...agent, autopilotChannels: [] }] }).insights.some((i) => i.code === "agentDoubleReply")).toBe(false);
    expect(analyzeAutomation(draft({ trigger_type: "contact.created" }), { agents: [agent] }).insights.some((i) => i.code === "agentDoubleReply")).toBe(false);
    expect(analyzeAutomation(draft()).insights.some((i) => i.code === "agentDoubleReply")).toBe(false);
  });
  it("never changes the result for callers that pass no context", () => {
    const d = draft();
    expect(analyzeAutomation(d)).toEqual(analyzeAutomation(d, {}));
  });
  it("matches a whatsapp_qr autopilot and email actions", () => {
    expect(analyzeAutomation(draft(), { agents: [{ ...agent, autopilotChannels: ["whatsapp_qr"] }] }).insights.some((i) => i.code === "agentDoubleReply")).toBe(true);
    const mail = draft({ actions: [{ type: "send_email", config: { subject: "x", body: "y" } }] });
    expect(analyzeAutomation(mail, { agents: [{ ...agent, autopilotChannels: ["email"] }] }).insights.some((i) => i.code === "agentDoubleReply")).toBe(true);
  });
});
