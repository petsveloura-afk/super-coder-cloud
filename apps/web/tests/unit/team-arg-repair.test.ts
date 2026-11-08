import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEmployeeTask, type EngineDeps, type EngineMember, type EngineTask } from "@/lib/team/engine-core";
import { extractUuid, failureKey, knownContactIds, MAX_FANOUT, repairArgs, repairIso } from "@/lib/team/arg-repair-core";
import { tidyActivityText } from "@/lib/team/activity-tidy-core";
import { AiGate, gateWaitMs } from "@/lib/team/ai-gate-core";
import { validateArgs } from "@/lib/team/tools-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const C = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const NOW = new Date("2026-11-08T10:00:00Z"); // 12:00 in Israel

describe("dates in any common form become real times", () => {
  it("ISO with a zone is kept; without a zone it is the business's local time", () => {
    expect(repairIso("2026-11-10T09:00:00+02:00", NOW)).toBe("2026-11-10T07:00:00.000Z");
    expect(repairIso("2026-11-10 09:00", NOW)).toBe("2026-11-10T07:00:00.000Z");
    expect(repairIso("2026-11-10T09:00 (ASSUMPTION)", NOW)).toBe("2026-11-10T07:00:00.000Z");
    expect(repairIso("2026-11-10", NOW)).toBe("2026-11-10T07:00:00.000Z");
  });
  it("day-first dates (as written in Israel), with or without a year", () => {
    expect(repairIso("10/11/2026 14:30", NOW)).toBe("2026-11-10T12:30:00.000Z");
    expect(repairIso("10.11", NOW)).toBe("2026-11-10T07:00:00.000Z");
    expect(repairIso("1/2", NOW)?.startsWith("2027-02-01")).toBe(true); // already passed this year → next year
  });
  it("relative words in Hebrew, English and Arabic", () => {
    expect(repairIso("מחר ב-10:00", NOW)).toBe("2026-11-09T08:00:00.000Z");
    expect(repairIso("tomorrow", NOW)).toBe("2026-11-09T07:00:00.000Z");
    expect(repairIso("بكرة", NOW)).toBe("2026-11-09T07:00:00.000Z");
    expect(repairIso("בעוד 3 ימים", NOW)).toBe("2026-11-11T07:00:00.000Z");
    expect(repairIso("in 2 hours", NOW)).toBe("2026-11-08T12:00:00.000Z");
    expect(repairIso("היום ב-18:00", NOW)).toBe("2026-11-08T16:00:00.000Z");
    expect(repairIso("שבוע הבא", NOW)).toBe("2026-11-15T07:00:00.000Z");
  });
  it("text that is no date at all → null", () => {
    expect(repairIso("כשיהיה זמן", NOW)).toBeNull();
    expect(repairIso("", NOW)).toBeNull();
  });
});

describe("ids and contacts are completed from what the employee already read", () => {
  it("extracts ids and lists the contacts seen in earlier results", () => {
    expect(extractUuid(`contact ${C(1)} (lead)`)).toBe(C(1));
    expect(extractUuid("no id")).toBeNull();
    const seen = knownContactIds([`Neon on email (contact ${C(1)}, waiting since …); Dana (contact ${C(2)}, …)`, `Ron Levi (id ${C(3)}, lead)`, `again contact ${C(1)}`]);
    expect(seen).toEqual([C(1), C(2), C(3)]);
  });

  const spec = { "contact_id!": "uuid", "body!": "string" };
  it("one contact read → used; several → the step runs for each (capped); none → a clear reason", () => {
    expect(repairArgs(spec, { contact_id: "the lead", body: "x" }, { known: [C(1)] }).args.contact_id).toBe(C(1));
    const many = repairArgs(spec, { contact_id: "each lead", body: "x" }, { known: [C(1), C(2), C(3), C(4), C(5), C(6)] });
    expect(many.fanOut).toHaveLength(MAX_FANOUT);
    expect(many.fanOut.map((f) => f.contact_id)).toEqual([C(1), C(2), C(3), C(4)]);
    expect(many.fanOut.every((f) => f.body === "x")).toBe(true);
    const none = repairArgs(spec, { contact_id: "Dana", body: "x" }, { known: [] });
    expect(none.blocked).toMatch(/find the contact first/);
    expect(none.blocked).not.toContain("bad:");
  });

  it("an optional unreadable date is dropped (the task is still created); a readable one is repaired", () => {
    const taskSpec = { "title!": "string", description: "string", due_iso: "iso", contact_id: "uuid" };
    const r = repairArgs(taskSpec, { title: "follow up", due_iso: "כשיהיה זמן", contact_id: "?" }, { known: [], now: NOW });
    expect(r.args.due_iso).toBeUndefined();
    expect(r.args.contact_id).toBeUndefined();
    expect(validateArgs("crm.create_task", r.args).ok).toBe(true);
    const r2 = repairArgs(taskSpec, { title: "follow up", due_iso: "2026-11-10 09:00 (ASSUMPTION)" }, { known: [], now: NOW });
    expect(validateArgs("crm.create_task", r2.args).ok).toBe(true);
  });

  it("valid arguments are never touched", () => {
    const a = { contact_id: C(7), body: "x" };
    expect(repairArgs(spec, a, { known: [C(1)] })).toEqual({ args: a, fanOut: [], notes: [], blocked: null });
    expect(failureKey("crm.add_note", `bad contact ${C(1)}`)).toBe("crm.add_note::bad contact #");
  });
});

describe("the engine: steps with unknown ids run correctly instead of failing", () => {
  const plan = (p: Record<string, unknown>) => JSON.stringify({ understanding: "goal", missing: [], question: null, assumptions: [], steps: [], more: false, deliverable: { type: "none", customer_facing: false, instructions: "" }, risks: [], estimate: { credits: 1, minutes: 1 }, ...p });
  const settings = { enabled: true, emergency_stop: false, max_depth: 3, max_steps: 20, daily_credit_cap: 200, day_credits: 0 };
  const member = { id: "m1", role: "sales", name: "איתי", tone: null, instructions: "", tools: ["inbox.unanswered", "crm.add_note", "crm.create_task"], autonomy: "auto", auto_actions: ["crm.add_note", "crm.create_task"], status: "active", limits: {} } as unknown as EngineMember;
  function harness(script: string[], tool: (t: string, a: Record<string, string | number>) => { ok: boolean; summary: string; error?: string }) {
    const rec = { calls: [] as { tool: string; args: Record<string, string | number> }[], logs: [] as string[] };
    let i = 0;
    const deps: EngineDeps = {
      lang: "he",
      tz: "Asia/Jerusalem",
      interactive: false,
      ai: async () => {
        const text = script[i++];
        return text === undefined ? { ok: false, text: "", credits: 0, error: "script_exhausted" } : { ok: true, text, credits: 1 };
      },
      runTool: async (t, a) => {
        rec.calls.push({ tool: t, args: a });
        return tool(t, a);
      },
      log: async (_p, s) => void rec.logs.push(s),
      approval: async () => "ap",
      handoff: async () => ({ ok: true, taskId: "t" }),
      message: async () => undefined,
      remember: async () => undefined,
      context: async () => ({ profile: "Name: Super Coder", known: "", memories: [], playbookExtra: "", reviewer: null }),
    };
    const run = (task: Partial<EngineTask> = {}) => runEmployeeTask(deps, member, { id: "task", title: "לחזור ללידים שלא קיבלו מענה", brief: "", depth: 0, steps_used: 0, credits_used: 0, review_rounds: 0, chain: [], answer: null, ...task }, settings);
    return { rec, run };
  }

  it("'note for each lead' with no ids → one note per lead read from the inbox; a written date → a real time", async () => {
    const steps = [
      { tool: "inbox.unanswered", args: { minutes: 60 }, why: "find leads" },
      { tool: "crm.add_note", args: { contact_id: "<contact_id from inbox.unanswered>", body: "חזרנו אליך" }, why: "note" },
      { tool: "crm.create_task", args: { title: "מעקב", due_iso: "2026-11-10 09:00 (ASSUMPTION)" }, why: "follow up" },
    ];
    const h = harness([plan({ steps })], (t) => (t === "inbox.unanswered" ? { ok: true, summary: `Dana on whatsapp (contact ${C(1)}, waiting since 2026-11-07T10:00); Ron on email (contact ${C(2)}, waiting since 2026-11-07T11:00)` } : { ok: true, summary: `${t} ok` }));
    await h.run();
    const notes = h.rec.calls.filter((c) => c.tool === "crm.add_note");
    expect(notes.map((n) => n.args.contact_id)).toEqual([C(1), C(2)]);
    const task = h.rec.calls.find((c) => c.tool === "crm.create_task");
    expect(task?.args.due_iso).toBe("2026-11-10T07:00:00.000Z");
    expect(h.rec.logs.some((l) => l.includes("invalid arguments"))).toBe(false);
  });

  it("the same failure twice → not tried a third time in the run", async () => {
    const steps = [1, 2, 3, 4].map((n) => ({ tool: "crm.add_note", args: { contact_id: C(n), body: "x" }, why: "n" }));
    const h = harness([plan({ steps })], () => ({ ok: false, summary: "", error: "contact_not_found" }));
    await h.run();
    expect(h.rec.calls.filter((c) => c.tool === "crm.add_note")).toHaveLength(2);
  });

  it("the planner is told to read ids first and to write dates as ISO", () => {
    expect(read("lib/team/engine-core.ts")).toContain("belongs in the NEXT round — read first, set more=true");
  });
});

describe("display tidy-up of the team log", () => {
  it("removes ids, codes, indexes and raw timestamps; localizes the assumption marker", () => {
    const line = `עסקאות תקועות: שיחה קולית (id ${C(9)}) · contact ${C(1)}, quiet since 2026-10-29; [2] Top (ASSUMPTION) — הוספת הערה: פרטים חסרים או שגויים (bad:contact_id). waiting since 2026-11-01T02:39`;
    const out = tidyActivityText(line, "he");
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(out).not.toContain("bad:");
    expect(out).not.toContain("[2]");
    expect(out).toContain("(הנחה)");
    expect(out).toContain("29/10/2026");
    expect(out).toContain("01/11 02:39");
    expect(tidyActivityText("plain text stays", "en")).toBe("plain text stays");
  });
  it("is applied to the team screen (activity, owner log, task reports) — display only", () => {
    const src = read("lib/team/page-data.ts");
    expect(src).toContain("tidyActivityText(x.summary, lang8)");
    expect(src).toContain("tidyActivityText(r.report, lang8)");
  });
});

describe("team AI gate — no self-made bursts", () => {
  it("lets N run at once, the next waits for a slot, and never blocks past its wait", async () => {
    const g = new AiGate(2);
    const r1 = await g.acquire(1000);
    const r2 = await g.acquire(1000);
    expect(g.running).toBe(2);
    let third = false;
    const p = g.acquire(1000).then((r) => {
      third = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(third).toBe(false);
    r1();
    const r3 = await p;
    expect(third).toBe(true);
    const t0 = Date.now();
    const r4 = await g.acquire(30); // full → goes ahead after its short wait
    expect(Date.now() - t0).toBeLessThan(500);
    [r2, r3, r4].forEach((r) => r());
    expect(g.running).toBe(0);
  });
  it("waits only when the run has time to spare", () => {
    expect(gateWaitMs(null)).toBe(8000);
    expect(gateWaitMs(25_000)).toBe(0);
    expect(gateWaitMs(100_000)).toBe(8000);
    expect(read("lib/team/runner.ts")).toContain("teamAiGate ??= new AiGate(4)");
  });
});

describe("display tidy-up — round 2 (cut ids, English tool wording, decimals)", () => {
  it("the lines from the owner's screenshots read clean in Hebrew", () => {
    const a = tidyActivityText("צפייה בטיוטות הפוסטים: [scheduled 2026-11-08T08:00 facebook+instagram] רוצים לבדוק … [draft 2026-11-08T17:14] | facebook id 92ed4233-cd66-4888-a183-18591da5a", "he");
    expect(a).not.toMatch(/92ed4233/);
    expect(a).toContain("מתוזמן 08/11");
    const b = tidyActivityText(`לקוחות שמחכים: Neon Alerts on email (contact —, waiting since 2026-11-01T02:39). (9 automated sender(s) ignored — not customers)`, "he");
    expect(b).toContain("ממתין מאז 01/11 02:39");
    expect(b).toContain("9 שולחים אוטומטיים סוננו");
    expect(b).not.toContain("contact —");
    const c = tidyActivityText("נתוני אתמול: yesterday: 1 leads (avg 1.2857142857142858), 1 conversations (avg 1.4285714285714286), 2 AI replies, won 0 deals worth 0, revenue 0 (avg 0)", "he");
    expect(c).toContain("1 לידים (ממוצע 1.2)");
    expect(c).toContain("נסגרו 0 עסקאות בשווי 0");
    expect(c).not.toMatch(/\d\.\d{3,}/);
    const d = tidyActivityText("משימות פתוחות: חזרה ללקוח (due 2025-03-31, OVERDUE); מערכת (due 2026-10-17, OVERDUE) [stopped] [proposed]", "he");
    expect(d).toContain("יעד 31/03/2025, באיחור");
    expect(d).toContain("[נעצר]");
    expect(d).toContain("[מוצע]");
    expect(tidyActivityText("הנחות: ASSUMPTION: העסק מתמקד", "he")).toContain("הנחה: העסק מתמקד");
    expect(tidyActivityText("waiting since 2026-11-01T02:39", "en")).toBe("waiting since 01/11 02:39");
  });
});
