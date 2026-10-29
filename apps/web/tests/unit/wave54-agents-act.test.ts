import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OP_MAX_ACTIONS, OP_TOOLS, firstJsonObject, matchOption, operatorSystemPrompt, parsePlan, phoneDigits, planRef, runStatus, wallTimeToUtc } from "@/lib/operator/operator-core";
import { agentActionsInstructions, bookingText, leadMemories, memoryBlock, parseActionMarkers, parseDelay } from "@/lib/ai/agent-actions-core";
import { AGENTS_PLUS, PLUS_DEFAULTS, PLUS_FIELDS, cleanCheckIn, cleanPlusConfig, isPlusAgent, reengageFallback, reviewRequestText } from "@/lib/agents/plus-core";

describe("wave 54 — AI operator: plan parsing", () => {
  it("keeps known tools + known args, drops unknown tools and actions without required args", () => {
    const raw =
      "Sure!\n```json\n" +
      JSON.stringify({
        reply: "I'll do it",
        actions: [
          { tool: "create_task", args: { title: "Call Moshe", due: "2026-11-03T10:00", evil: "x" } },
          { tool: "rm_rf", args: {} },
          { tool: "add_note", args: { contact: "Moshe" } },
          { tool: "create_deal", args: { title: "Alpha", value: 12000, contact: "null" } },
        ],
      }) +
      "\n```";
    const p = parsePlan(raw);
    expect(p.reply).toBe("I'll do it");
    expect(p.actions).toEqual([
      { tool: "create_task", args: { title: "Call Moshe", due: "2026-11-03T10:00" } },
      { tool: "create_deal", args: { title: "Alpha", value: 12000 } },
    ]);
    expect(p.dropped).toBe(2);
  });

  it("bounds the plan size and tolerates garbage", () => {
    const many = { actions: Array.from({ length: 15 }, (_, i) => ({ tool: "create_task", args: { title: `t${i}` } })) };
    const p = parsePlan(JSON.stringify(many));
    expect(p.actions).toHaveLength(OP_MAX_ACTIONS);
    expect(p.dropped).toBe(5);
    expect(parsePlan("no json here")).toEqual({ reply: "", actions: [], dropped: 0 });
    expect(firstJsonObject("{bad")).toBeNull();
  });

  it("the system prompt documents every tool", () => {
    const s = operatorSystemPrompt({ lang: "he", timeZone: "Asia/Jerusalem", nowText: "x", me: "Tom", members: [], stages: [], channels: ["email"], currency: "ILS" });
    for (const t of OP_TOOLS) expect(s).toContain(`- ${t} →`);
    expect(s).toContain("Hebrew");
  });
});

describe("wave 54 — AI operator: resolution helpers", () => {
  it("converts local wall time to UTC across DST", () => {
    expect(wallTimeToUtc("2026-07-01T10:00", "Asia/Jerusalem")).toBe("2026-07-01T07:00:00.000Z");
    expect(wallTimeToUtc("2026-12-01T10:00", "Asia/Jerusalem")).toBe("2026-12-01T08:00:00.000Z");
    expect(wallTimeToUtc("next week", "Asia/Jerusalem")).toBeNull();
  });

  it("matches names: exact beats partial, ambiguity returns candidates", () => {
    const list = [{ label: "Moshe Cohen" }, { label: "Moshe Levi" }, { label: "Dana" }];
    expect(matchOption(list, "dana").match?.label).toBe("Dana");
    expect(matchOption(list, "cohen moshe").match?.label).toBe("Moshe Cohen");
    const amb = matchOption(list, "Moshe");
    expect(amb.match).toBeNull();
    expect(amb.candidates).toHaveLength(2);
  });

  it("plan refs, phones and status", () => {
    expect(planRef("$2")).toBe(2);
    expect(planRef("Moshe")).toBeNull();
    expect(phoneDigits("050-123-4567")).toEqual(["0501234567", "972501234567"]);
    expect(phoneDigits("12")).toEqual([]);
    expect(runStatus([{ ok: true }, { ok: true }])).toBe("executed");
    expect(runStatus([{ ok: true }, { ok: false }])).toBe("partial");
    expect(runStatus([])).toBe("failed");
  });
});

describe("wave 54 — the customer agent acts (markers)", () => {
  it("extracts and strips the markers, bounded per kind", () => {
    const raw = "Great, talk soon!\n[[REMEMBER: prefers evening calls]]\n[[TASK: send a quote | due=2d]]\n[[TAG: #VIP client]]\n[[FOLLOWUP: 3d | Did you get a chance to look?]]\n[[BOOK: 2026-11-03 9:30 | haircut]]\n[[BOOK: 2026-11-04 9:30]]";
    const r = parseActionMarkers(raw);
    expect(r.text).toBe("Great, talk soon!");
    expect(r.actions).toEqual([
      { kind: "remember", fact: "prefers evening calls" },
      { kind: "task", title: "send a quote", dueDays: 2 },
      { kind: "tag", tag: "vip-client" },
      { kind: "followup", delayMinutes: 3 * 24 * 60, text: "Did you get a chance to look?" },
      { kind: "book", local: "2026-11-03T09:30", service: "haircut" },
    ]);
  });

  it("parses delays in English and Hebrew", () => {
    expect(parseDelay("2h")).toBe(120);
    expect(parseDelay("מחר")).toBe(1440);
    expect(parseDelay("בעוד 3 ימים")).toBe(3 * 1440);
    expect(parseDelay("1w")).toBe(7 * 1440);
    expect(parseDelay("soon")).toBeNull();
  });

  it("instructions, booking texts and memory block", () => {
    expect(agentActionsInstructions({ canBook: true, hasContact: true })).toContain("[[BOOK:");
    expect(agentActionsInstructions({ canBook: false, hasContact: true })).not.toContain("[[BOOK:");
    expect(bookingText("en", "ok", { when: "Tue 10:00", service: "Intro" })).toContain("Tue 10:00");
    expect(bookingText("he", "details")).toContain("טלפון");
    expect(leadMemories({ need: "website", budget: "5k" }).map((m) => m.kind)).toEqual(["need", "budget"]);
    const block = memoryBlock([{ fact: "likes <b>blue</b>" }, { fact: "LIKES <b>BLUE</b>" }, { fact: "has a dog" }]);
    expect(block).toContain("<customer_memory>");
    expect(block).not.toContain("<b>");
    expect(block.match(/^- /gm)).toHaveLength(2);
    expect(memoryBlock([])).toBe("");
  });
});

describe("wave 54 — new team agents", () => {
  it("config is cleaned and clamped", () => {
    expect(AGENTS_PLUS.every((k) => isPlusAgent(k))).toBe(true);
    expect(isPlusAgent("hacker")).toBe(false);
    const c = cleanPlusConfig("reviews_requester", { review_url: "javascript:alert(1)", days_after: 99, deals: "false", junk: 1 });
    expect(c).toEqual({ ...PLUS_DEFAULTS.reviews_requester.config, review_url: "", days_after: 14, deals: false });
    expect(cleanPlusConfig("reengage", { target: "everyone", inactive_days: 1 })).toMatchObject({ target: "both", inactive_days: 7 });
    for (const k of AGENTS_PLUS) for (const f of PLUS_FIELDS[k]) expect(PLUS_DEFAULTS[k].config).toHaveProperty(f.key);
  });

  it("messages are personal and include the link", () => {
    expect(reviewRequestText("en", { name: "Dana Levi", org: "Acme", url: "https://g.page/r/x", reason: "deal" })).toMatch(/^Hi Dana! .*\n.*https:\/\/g\.page\/r\/x/s);
    expect(reviewRequestText("he", { name: null, org: "Acme", url: null, reason: "meeting" })).toContain("1 עד 5");
    expect(reengageFallback("ar", { name: "Sami", org: "Acme", customer: true })).toContain("Sami");
    expect(cleanCheckIn('"Hi Dana, how is the new kitchen going?" [[TAG: x]]')).toBe("Hi Dana, how is the new kitchen going?");
    expect(cleanCheckIn("hi")).toBeNull();
  });
});

describe("wave 54 — migration is additive and RLS-protected", () => {
  const sql = readFileSync(join(__dirname, "../../../../supabase/migrations/20261029000007_agents_actions_memory.sql"), "utf8");
  it("creates the tables with RLS and keeps every existing agent", () => {
    expect(sql).toMatch(/create table if not exists public\.contact_memories/i);
    expect(sql).toMatch(/create table if not exists public\.operator_runs/i);
    expect(sql.match(/enable row level security/gi)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).not.toMatch(/drop table/i);
    for (const a of ["reviews_requester", "reengage", "operator"]) expect(sql).toContain(`'${a}'`);
  });
});
