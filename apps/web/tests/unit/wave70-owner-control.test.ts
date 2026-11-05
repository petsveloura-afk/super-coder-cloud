import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { decide } from "@/lib/team/policy-core";
import { TOOL_MAP } from "@/lib/team/tools-core";
import { autonomyView, blockReason, filterLog, groupByDay, ownerLog, tallyByMember, tightenPlan, toOwnerEntry, type ControlMember, type LogRow } from "@/lib/team/owner-control-core";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const dict = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)) as Record<string, unknown>;
const at = (o: unknown, path: string) => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);

const TOOLS = ["crm.find_contacts", "crm.add_note", "inbox.send_message", "collections.send_reminder", "team.ask_user", "team.handoff"];
const mk = (over: Partial<ControlMember> = {}): ControlMember => ({ id: "m1", name: "Dana", tools: TOOLS, autonomy: "approve", auto_actions: [], status: "active", ...over });

describe("wave 70 — autonomy view in plain words", () => {
  it("approve (the default): internal work alone, customer and money wait for the owner", () => {
    const r = autonomyView([mk()]).rows[0]!;
    expect(r.alone.customer).toBe(0);
    expect(r.alone.money).toBe(0);
    expect(r.asks).toBe(2);
    expect(r.looks).toBe(1);
    expect(r.level).toBe("balanced");
  });
  it("suggest: only suggests; asking the owner and handing to a colleague still need no approval (the real policy)", () => {
    const r = autonomyView([mk({ autonomy: "suggest" })]).rows[0]!;
    expect(r.level).toBe("careful");
    expect(r.alone.customer + r.alone.money + r.alone.irreversible).toBe(0);
    expect(r.asks).toBe(3);
  });
  it("auto with an allowed customer action is independent and counted as risky", () => {
    const v = autonomyView([mk({ autonomy: "auto", auto_actions: ["inbox.send_message"] }), mk({ id: "m2", name: "Ron" })]);
    expect(v.rows[0]!.level).toBe("independent");
    expect(v.rows[0]!.alone.customer).toBe(1);
    expect(v.rows[0]!.asks).toBe(1);
    expect(v.riskyCount).toBe(1);
    expect(v.loosenCount).toBe(1);
  });
  it("auto without any allowed customer / money action is not independent", () => {
    const v = autonomyView([mk({ autonomy: "auto" })]);
    expect(v.rows[0]!.level).toBe("balanced");
    expect(v.rows[0]!.auto).toBe(true);
    expect(v.riskyCount).toBe(0);
  });
  it("a paused employee is shown as paused and is not counted as risky", () => {
    const v = autonomyView([mk({ autonomy: "auto", auto_actions: ["inbox.send_message"], status: "paused" })]);
    expect(v.rows[0]!.paused).toBe(true);
    expect(v.riskyCount).toBe(0);
  });
  it("unknown tools are ignored, an empty team gives an empty view", () => {
    expect(autonomyView([mk({ tools: ["nope.nothing"] })]).rows[0]).toMatchObject({ asks: 0, looks: 0 });
    expect(autonomyView([])).toEqual({ rows: [], riskyCount: 0, loosenCount: 0 });
  });
  it("never disagrees with the real policy: every write tool lands in exactly the bucket decide() gives", () => {
    const all = Object.keys(TOOL_MAP);
    for (const autonomy of ["suggest", "approve", "auto"] as const) {
      const member = mk({ tools: all, autonomy, auto_actions: ["inbox.send_message", "collections.send_reminder"] });
      const r = autonomyView([member]).rows[0]!;
      let alone = 0;
      let asks = 0;
      for (const t of all) {
        const spec = TOOL_MAP[t]!;
        if (spec.kind === "read") continue;
        const d = decide(t, { tools: all, autonomy, auto_actions: member.auto_actions, status: "active" }, { enabled: true, emergency_stop: false }, { interactive: true });
        if (d.do === "execute") alone++;
        else if (d.do === "approve") asks++;
      }
      expect(r.alone.internal + r.alone.customer + r.alone.money + r.alone.irreversible, autonomy).toBe(alone);
      expect(r.asks, autonomy).toBe(asks);
    }
  });
});

describe("wave 70 — tighten only goes towards more caution", () => {
  const team = [
    { id: "a", autonomy: "auto" },
    { id: "b", autonomy: "approve" },
    { id: "c", autonomy: "suggest" },
    { id: "d", autonomy: "auto" },
  ];
  it("moves only the employees on auto", () => expect(tightenPlan(team)).toEqual(["a", "d"]));
  it("one id moves just that one, and never someone who is not on auto", () => {
    expect(tightenPlan(team, "d")).toEqual(["d"]);
    expect(tightenPlan(team, "b")).toEqual([]);
    expect(tightenPlan(team, "zzz")).toEqual([]);
  });
  it("nothing to do on an empty team", () => expect(tightenPlan([])).toEqual([]));
  it("the server action only ever writes autonomy approve, only rows that are on auto, and fails soft", () => {
    const src = read("app/[locale]/(dashboard)/ai-team/control-actions.ts");
    expect(src).toContain('autonomy: "approve"');
    expect(src).not.toMatch(/autonomy:\s*"auto"/);
    expect(src).toContain('.eq("autonomy", "auto")');
    expect(src).toContain('ctx.can("ai.manage")');
    expect(src).toContain("auto_actions: []");
    expect(src).toMatch(/catch \(e\)[\s\S]*common\.error/);
  });
});

const row = (over: Partial<LogRow>): LogRow => ({ id: 1, member_id: "m1", phase: "deliver", summary: "Sent the offer", ok: true, created_at: "2026-11-05T10:00:00Z", ...over });

describe("wave 70 — the owner's team log", () => {
  it("technical phases are left out", () => {
    for (const phase of ["understand", "context", "plan", "self_check", "peer_review", "learn"]) expect(toOwnerEntry(row({ phase })), phase).toBeNull();
  });
  it("what was done / initiative", () => {
    expect(toOwnerEntry(row({}))?.kind).toBe("did");
    expect(toOwnerEntry(row({ phase: "execute" }))?.kind).toBe("did");
    expect(toOwnerEntry(row({ phase: "initiative" }))?.kind).toBe("initiative");
  });
  it("a stopped action becomes a reason code, an unknown reason becomes other", () => {
    expect(toOwnerEntry(row({ phase: "execute", ok: false, why: "emergency_stop" }))).toMatchObject({ kind: "blocked", why: "emergency_stop" });
    expect(toOwnerEntry(row({ phase: "execute", ok: false, why: "something_new" }))).toMatchObject({ kind: "blocked", why: "other" });
    expect(blockReason(null)).toBe("other");
    expect(blockReason("member_paused")).toBe("member_paused");
  });
  it("a failed action without a reason is a problem with the stored sentence", () => {
    expect(toOwnerEntry(row({ phase: "execute", ok: false, summary: "boom" }))).toMatchObject({ kind: "problem", text: "boom" });
    expect(toOwnerEntry(row({ phase: "deliver", ok: false }))?.kind).toBe("problem");
  });
  it("waiting for approval keeps only the reason; decisions of the owner are history", () => {
    expect(toOwnerEntry(row({ phase: "approval", summary: "Waiting for approval: inbox.send_message — customer sees this" }))).toMatchObject({ kind: "waited", text: "customer sees this" });
    expect(toOwnerEntry(row({ phase: "approval", summary: "Waiting for approval: x" }))).toMatchObject({ kind: "waited", text: "" });
    expect(toOwnerEntry(row({ phase: "approval", summary: "Approved and done: sent" }))?.kind).toBe("decided");
    expect(toOwnerEntry(row({ phase: "approval", summary: "Rejected by the owner." }))?.kind).toBe("decided");
    expect(toOwnerEntry(row({ phase: "approval", summary: "Approved but failed: x", ok: false }))?.kind).toBe("problem");
  });
  it("what the owner changed", () => {
    expect(toOwnerEntry(row({ phase: "system", summary: "Employee updated: Dana (sales)", autonomy: "auto", member: "m9" }))).toMatchObject({ kind: "changed", change: "autonomy", changedMemberId: "m9" });
    expect(toOwnerEntry(row({ phase: "system", summary: "Team settings saved" }))).toMatchObject({ kind: "changed", change: "settings" });
    expect(toOwnerEntry(row({ phase: "system", summary: "Team operations settings saved" }))).toMatchObject({ kind: "changed", change: "settings" });
    expect(toOwnerEntry(row({ phase: "system", summary: "EMERGENCY STOP — the team is frozen" }))).toMatchObject({ change: "stop" });
    expect(toOwnerEntry(row({ phase: "system", summary: "Emergency stop released" }))).toMatchObject({ change: "release" });
    expect(toOwnerEntry(row({ phase: "system", summary: 'Owner moved 2 employee(s) back to "ask me first"' }))).toMatchObject({ change: "tightened" });
  });
  it("other system lines are hidden unless they failed", () => {
    expect(toOwnerEntry(row({ phase: "system", summary: "Weekly digest posted" }))).toBeNull();
    expect(toOwnerEntry(row({ phase: "system", summary: "daily cap reached", ok: false }))?.kind).toBe("problem");
  });
  it("long sentences are clipped", () => expect(toOwnerEntry(row({ summary: "x".repeat(400) }))!.text.length).toBe(160));
  const rows: LogRow[] = [
    row({ id: 6, member_id: "a", created_at: "2026-11-05T09:00:00Z" }),
    row({ id: 5, member_id: "a", phase: "approval", summary: "Waiting for approval: t — r", created_at: "2026-11-05T08:00:00Z" }),
    row({ id: 4, member_id: "b", phase: "execute", ok: false, why: "team_off", created_at: "2026-11-04T08:00:00Z" }),
    row({ id: 3, phase: "plan" }),
    row({ id: 2, member_id: "a", phase: "initiative", created_at: "2026-11-04T07:00:00Z" }),
  ];
  it("ownerLog keeps order, drops the technical rows and respects the limit", () => {
    expect(ownerLog(rows).map((e) => e.id)).toEqual([6, 5, 4, 2]);
    expect(ownerLog(rows, 2).map((e) => e.id)).toEqual([6, 5]);
    expect(ownerLog([])).toEqual([]);
  });
  it("filters", () => {
    const e = ownerLog(rows);
    expect(filterLog(e, "all")).toHaveLength(4);
    expect(filterLog(e, "waited").map((x) => x.id)).toEqual([5]);
    expect(filterLog(e, "problems").map((x) => x.id)).toEqual([4]);
  });
  it("per-employee tally and day groups", () => {
    const e = ownerLog(rows);
    expect(tallyByMember(e)).toEqual([
      { memberId: "a", did: 2, waited: 1, stopped: 0 },
      { memberId: "b", did: 0, waited: 0, stopped: 1 },
    ]);
    expect(groupByDay(e).map((g) => [g.day, g.entries.length])).toEqual([
      ["2026-11-05", 2],
      ["2026-11-04", 2],
    ]);
  });
});

describe("wave 70 — loader and wiring fail silent", () => {
  it("the loader returns null when the database throws or errors", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("down"); } }));
    const m1 = await import("@/lib/team/owner-log");
    expect(await m1.loadOwnerLog("org")).toBeNull();
    vi.resetModules();
    const chain: Record<string, unknown> = {};
    for (const k of ["select", "eq", "in", "gte", "order"]) chain[k] = () => chain;
    chain.limit = async () => ({ data: null, error: { message: "x" } });
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => chain }) }));
    const m2 = await import("@/lib/team/owner-log");
    expect(await m2.loadOwnerLog("org")).toBeNull();
    vi.doUnmock("@/lib/supabase/admin");
  });
  it("the page loader is wrapped in try/catch and only sets the field on success", () => {
    const src = read("lib/team/page-data.ts");
    expect(src).toMatch(/try \{[\s\S]*loadOwnerLog\(org\)[\s\S]*if \(ol\) data\.ownerLog = ol;[\s\S]*\} catch/);
  });
  it("the log lines are translated for display inside their own try block", () => {
    const src = read("lib/team/page-data.ts");
    expect(src).toMatch(/try \{\s*if \(data\.ownerLog\) data\.ownerLog = data\.ownerLog\.map\(\(e\) => \(e\.text \? \{ \.\.\.e, text: localizeLog\(e\.text, lang8\) \} : e\)\);\s*\} catch/);
  });
  it("the cards are in the settings tab and never inside a try block", () => {
    const src = read("components/ai-team/panels.tsx");
    expect(src).toContain("<OwnerControlCard members={data.members}");
    expect(src).toContain("{data.ownerLog ? <OwnerLogCard");
    for (const f of ["components/ai-team/owner-control-card.tsx"]) expect(read(f)).not.toMatch(/try \{[^}]*</);
  });
});

describe("wave 70 — texts in he / en / ar", () => {
  const keys = (src: string) => [...new Set([...src.matchAll(/t\(\s*[`"](aiTeam\.(?:control|ownerLog)\.[^`"$]+)[`"]/g)].map((m) => m[1]!))];
  const used = keys(read("components/ai-team/owner-control-card.tsx"));
  it("finds the keys the component uses", () => expect(used.length).toBeGreaterThan(15));
  for (const l of ["he", "en", "ar"]) {
    it(`${l}: every key used exists and is not empty`, () => {
      const d = dict(l);
      for (const k of used) expect(typeof at(d, k) === "string" && (at(d, k) as string).length > 0, `${l} ${k}`).toBe(true);
      for (const lv of ["careful", "balanced", "independent"]) expect(at(d, `aiTeam.control.level.${lv}`), lv).toBeTruthy();
      for (const w of ["emergency_stop", "team_off", "member_paused", "tool_not_allowed", "needs_screen", "unknown_tool", "other"]) expect(at(d, `aiTeam.ownerLog.why.${w}`), w).toBeTruthy();
      for (const c of ["autonomy", "settings", "stop", "release", "tightened"]) expect(at(d, `aiTeam.ownerLog.change.${c}`), c).toBeTruthy();
      for (const k of ["did", "waited", "decided", "blocked", "problem", "initiative", "changed"]) expect(at(d, `aiTeam.ownerLog.kind.${k}`), k).toBeTruthy();
      for (const k of ["nothingToTighten", "tightened"]) expect(at(d, `aiTeam.control.${k}`), k).toBeTruthy();
    });
  }
  it("same placeholders in every language", () => {
    const ph = (s: unknown) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const k of ["aiTeam.control.risky", "aiTeam.control.counts", "aiTeam.control.aloneRisky", "aiTeam.control.confirm", "aiTeam.ownerLog.tally", "aiTeam.ownerLog.change.autonomy"]) {
      expect(ph(at(dict("en"), k)), k).toBe(ph(at(dict("he"), k)));
      expect(ph(at(dict("en"), k)), k).toBe(ph(at(dict("ar"), k)));
    }
  });
});
