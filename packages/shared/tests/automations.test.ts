import { describe, expect, it } from "vitest";
import { ACTION_TYPES, AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, automationSchema } from "../src/automations";

describe("automation schema", () => {
  it("accepts a valid automation and applies defaults", () => {
    const r = automationSchema.parse({
      name: "Welcome",
      trigger_type: "contact.created",
      actions: [{ type: "create_task", config: { title: "Call {{contact.first_name}}", due_in_days: "2" } }],
    });
    expect(r.enabled).toBe(true);
    expect(r.conditions).toEqual([]);
    expect(r.actions[0]).toEqual({ type: "create_task", config: { title: "Call {{contact.first_name}}", due_in_days: 2 } });
  });

  it("rejects unknown triggers/actions, empty actions, http webhooks and bad condition paths", () => {
    expect(automationSchema.safeParse({ name: "x", trigger_type: "nope", actions: [{ type: "add_tag", config: { tag: "a" } }] }).success).toBe(false);
    expect(automationSchema.safeParse({ name: "x", trigger_type: "deal.won", actions: [{ type: "rm_rf", config: {} }] }).success).toBe(false);
    expect(automationSchema.safeParse({ name: "x", trigger_type: "deal.won", actions: [] }).success).toBe(false);
    expect(automationSchema.safeParse({ name: "x", trigger_type: "deal.won", actions: [{ type: "send_webhook", config: { url: "http://x.io" } }] }).success).toBe(false);
    expect(automationSchema.safeParse({ name: "x", trigger_type: "deal.won", conditions: [{ field: "contact.email; drop", op: "eq", value: "" }], actions: [{ type: "add_tag", config: { tag: "a" } }] }).success).toBe(false);
  });

  it("every recipe is valid against the schema", () => {
    for (const r of AUTOMATION_RECIPES) {
      expect(automationSchema.safeParse({ name: r.key, trigger_type: r.trigger_type, trigger_config: r.trigger_config, conditions: r.conditions, actions: r.actions }).success, r.key).toBe(true);
    }
  });

  it("catalogue matches the SQL CHECK list", () => {
    // 14 (wave 9) + 5 behavior & sales triggers (wave 17, migration 0034)
    expect(AUTOMATION_TRIGGERS).toHaveLength(25);
    expect(ACTION_TYPES).toHaveLength(13);
  });
});
