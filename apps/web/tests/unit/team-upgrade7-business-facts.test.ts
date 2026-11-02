import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIDENCE, currentOf, decideProposal, factLine, factsFor, factsPrompt, historyOf, isStale, normalizeFact, normalizeFactKey, openConflicts, resolveIncoming, valueFingerprint, type FactVersion } from "@/lib/team/business-facts-core";
import { TOOL_MAP, TOOLS, validateArgs } from "@/lib/team/tools-core";
import { withRoleExtras } from "@/lib/team/tools-plus-core";
import { ROLE_EXTRA_TOOLS_7, UPGRADE7_TOOLS, withRoleExtras7 } from "@/lib/team/tools-plus7-core";
import { ROLE_KEYS } from "@/lib/team/roles";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * day).toISOString();
const raw = (over: Record<string, unknown> = {}) => ({ label: "Haircut price", value: "120 ILS", kind: "price", source: "owner", observed_at: iso(-1), ...over });
const fact = (over: Record<string, unknown> = {}) => {
  const n = normalizeFact(raw(over), NOW);
  if ("rejected" in n) throw new Error(n.rejected);
  return n.fact;
};
let seq = 0;
const ver = (over: Partial<FactVersion> = {}): FactVersion => {
  const f = fact();
  return { id: `id${++seq}`, ...f, status: "current", version: 1, supersedes: null, created_at: iso(-1), ...over };
};

describe("normalising a fact", () => {
  it("keeps source, time and confidence; only the owner is confirmed", () => {
    const o = fact();
    expect(o.owner_confirmed).toBe(true);
    expect(o.confidence).toBe(1);
    const a = fact({ source: "agent", source_ref: "chat with the supplier" });
    expect(a.owner_confirmed).toBe(false);
    expect(a.confidence).toBe(DEFAULT_CONFIDENCE.agent);
    // nobody but the owner can claim confirmation or full confidence
    expect(fact({ source: "agent", source_ref: "x", confidence: 5, owner_confirmed: true }).confidence).toBeLessThanOrEqual(0.95);
    expect(fact({ source: "agent", source_ref: "x", owner_confirmed: true }).owner_confirmed).toBe(false);
  });
  it("rejects instead of filling gaps", () => {
    expect(normalizeFact(raw({ label: "a" }), NOW)).toEqual({ rejected: "bad_label" });
    expect(normalizeFact(raw({ value: "   " }), NOW)).toEqual({ rejected: "bad_value" });
    expect(normalizeFact(raw({ value: "---" }), NOW)).toEqual({ rejected: "bad_value" });
    expect(normalizeFact(raw({ kind: "gossip" }), NOW)).toEqual({ rejected: "bad_kind" });
    expect(normalizeFact(raw({ source: "oracle" }), NOW)).toEqual({ rejected: "bad_source" });
    expect(normalizeFact(raw({ source: "agent" }), NOW)).toEqual({ rejected: "source:missing" });
    expect(normalizeFact(raw({ source: "web", source_ref: "my notes" }), NOW)).toEqual({ rejected: "source:bad_url" });
    expect(normalizeFact(raw({ observed_at: "yesterday-ish" }), NOW)).toEqual({ rejected: "bad_time" });
    expect(normalizeFact(raw({ observed_at: iso(5) }), NOW)).toEqual({ rejected: "bad_time" });
    expect(normalizeFact(raw({ valid_from: iso(-1), valid_to: iso(-3) }), NOW)).toEqual({ rejected: "bad_validity" });
  });
  it("keys and values compare by meaning, not by formatting", () => {
    expect(normalizeFactKey("  Haircut — Price! ")).toBe(normalizeFactKey("haircut price"));
    expect(normalizeFactKey("מחיר 'תספורת'")).toBe(normalizeFactKey("מחיר תספורת"));
    for (const v of ["120 ₪", "₪120", "120.00 ILS", "ILS 120"]) expect(valueFingerprint(v)).toBe(valueFingerprint("120"));
    expect(valueFingerprint("1,200 ILS")).toBe(valueFingerprint("1200"));
    expect(valueFingerprint("120")).not.toBe(valueFingerprint("130"));
    expect(valueFingerprint("Sun–Thu 9:00–18:00")).not.toBe(valueFingerprint("Sun–Thu 9:00–19:00"));
  });
});

describe("what is in force now", () => {
  it("only a started, not-ended, current version counts", () => {
    const a = ver({ id: "a", valid_from: iso(-10), valid_to: iso(-2) });
    expect(currentOf([a], NOW)).toBeNull();
    const b = ver({ id: "b", version: 2, valid_from: iso(2) });
    expect(currentOf([b], NOW)).toBeNull();
    const c = ver({ id: "c", version: 3, valid_from: iso(-1), valid_to: iso(30) });
    expect(currentOf([a, b, c], NOW)?.id).toBe("c");
    expect(currentOf([ver({ status: "proposed" }), ver({ status: "superseded" })], NOW)).toBeNull();
  });
  it("stale depends on the kind of fact", () => {
    expect(isStale(ver({ kind: "price", observed_at: iso(-200) }), NOW)).toBe(true);
    expect(isStale(ver({ kind: "hours", observed_at: iso(-200) }), NOW)).toBe(false);
    expect(isStale(ver({ kind: "offer", observed_at: iso(-60) }), NOW)).toBe(true);
  });
});

describe("contradictions are resolved by rules", () => {
  it("first value becomes current; the same value again is a duplicate", () => {
    expect(resolveIncoming([], fact({ source: "agent", source_ref: "x" }), NOW)).toEqual({ action: "new_current", supersedesId: null, version: 1 });
    const cur = ver({ id: "cur" });
    expect(resolveIncoming([cur], fact({ value: "₪120.00", source: "agent", source_ref: "x" }), NOW)).toEqual({ action: "duplicate", currentId: "cur" });
  });
  it("the owner always wins and closes the previous version", () => {
    const cur = ver({ id: "cur", version: 3, owner_confirmed: true });
    expect(resolveIncoming([cur], fact({ value: "150 ILS" }), NOW)).toEqual({ action: "new_current", supersedesId: "cur", version: 4 });
  });
  it("an owner-confirmed value is never overwritten by an agent, the web or a document — it is proposed", () => {
    const cur = ver({ id: "cur", owner_confirmed: true, source: "owner" });
    for (const source of ["agent", "web", "document", "crm"]) {
      const r = resolveIncoming([cur], fact({ value: "99 ILS", source, source_ref: "https://x.example.com/p" }), NOW);
      expect(r).toMatchObject({ action: "propose", againstId: "cur", reason: "owner_confirmed_exists" });
    }
  });
  it("among unconfirmed values the newer observation wins, an older one is ignored", () => {
    const cur = ver({ id: "cur", owner_confirmed: false, source: "agent", confidence: 0.6, observed_at: iso(-5) });
    expect(resolveIncoming([cur], fact({ value: "130", source: "agent", source_ref: "x", observed_at: iso(-1) }), NOW)).toMatchObject({ action: "new_current", supersedesId: "cur" });
    expect(resolveIncoming([cur], fact({ value: "110", source: "agent", source_ref: "x", observed_at: iso(-9) }), NOW)).toEqual({ action: "ignore", reason: "older_observation", currentId: "cur" });
  });
  it("a newer but much less trusted value waits as a proposal", () => {
    const cur = ver({ id: "cur", owner_confirmed: false, source: "crm", confidence: 0.9, observed_at: iso(-5) });
    expect(resolveIncoming([cur], fact({ value: "130", source: "web", source_ref: "https://x.example.com", confidence: 0.4, observed_at: iso(-1) }), NOW)).toMatchObject({ action: "propose", reason: "lower_confidence" });
  });
  it("version numbers keep growing, also past proposals", () => {
    const hist = [ver({ version: 1, status: "superseded" }), ver({ id: "c", version: 2, owner_confirmed: true }), ver({ version: 3, status: "proposed" })];
    expect(resolveIncoming(hist, fact({ value: "200" }), NOW)).toMatchObject({ version: 4 });
  });
});

describe("the owner's decision on a proposal", () => {
  const cur = ver({ id: "cur", fact_key: "haircut price", owner_confirmed: true });
  const prop = ver({ id: "prop", fact_key: "haircut price", status: "proposed", version: 2, value: "99 ILS", source: "web", owner_confirmed: false });
  it("accept → the proposal becomes current, the old one is closed", () => {
    expect(decideProposal([cur, prop], "prop", true, NOW)).toEqual({ ok: true, becomeCurrent: "prop", closeCurrent: "cur", at: new Date(NOW).toISOString() });
  });
  it("reject → only the proposal is closed", () => {
    expect(decideProposal([cur, prop], "prop", false, NOW)).toEqual({ ok: true, reject: "prop", at: new Date(NOW).toISOString() });
  });
  it("only a proposal can be decided, and only once", () => {
    expect(decideProposal([cur, prop], "cur", true, NOW)).toEqual({ ok: false, error: "not_proposed" });
    expect(decideProposal([cur, prop], "nope", true, NOW)).toEqual({ ok: false, error: "not_found" });
  });
  it("lists the open conflicts with the value they would replace", () => {
    const list = openConflicts([cur, prop], NOW);
    expect(list).toHaveLength(1);
    expect(list[0]!.proposed.id).toBe("prop");
    expect(list[0]!.current?.id).toBe("cur");
  });
  it("history is newest first and the key is normalised", () => {
    const old = ver({ id: "old", fact_key: "haircut price", version: 1, status: "superseded" });
    expect(historyOf([old, cur, prop], "Haircut price").map((v) => v.version)).toEqual([2, 1, 1].map((_, i) => [prop, cur, old][i]!.version));
    expect(historyOf([old, cur, prop], "Haircut price")[0]!.id).toBe("prop");
    expect(historyOf([old, cur, prop], "no such fact")).toEqual([]);
  });
});

describe("retrieval by relevance", () => {
  const f = (label: string, value: string, kind: FactVersion["kind"], over: Partial<FactVersion> = {}) => ver({ id: `f-${label}`, fact_key: normalizeFactKey(label), label, value, kind, ...over });
  const all = [
    f("Haircut price", "120 ILS", "price"),
    f("Opening hours", "Sun–Thu 9:00–18:00", "hours"),
    f("Refund policy", "Full refund within 14 days", "policy"),
    f("Parking", "Free parking behind the building", "other"),
    f("מחיר צבע", "300 ₪", "price"),
  ];
  it("returns what the task is about and not the rest", () => {
    const hits = factsFor(all, "A customer asks how much a haircut costs", { now: NOW });
    expect(hits[hits.findIndex((h) => h.fact.label === "Haircut price")]).toBeTruthy();
    expect(hits.some((h) => h.fact.label === "Parking")).toBe(false);
    expect(factsFor(all, "write a poem about the sea", { now: NOW }).map((h) => h.fact.label)).toEqual(["Refund policy"]);
  });
  it("matches Hebrew with a prefix (המחיר → מחיר)", () => {
    const labels = factsFor(all, "מה המחיר של צבע לשיער", { now: NOW }).map((h) => h.fact.label);
    expect(labels).toContain("מחיר צבע");
    expect(labels).not.toContain("Parking");
    // the prefix form alone is enough
    expect(factsFor(all, "המחיר", { now: NOW }).map((h) => h.fact.label)).toContain("מחיר צבע");
  });
  it("owner-confirmed policies always come (hard rules), at most 3", () => {
    const many = [1, 2, 3, 4, 5].map((i) => f(`Policy ${i}`, `rule ${i}`, "policy"));
    expect(factsFor(many, "unrelated task", { now: NOW }).length).toBe(3);
  });
  it("never returns expired, proposed or superseded versions", () => {
    const hits = factsFor([f("Haircut price", "100", "price", { status: "superseded" }), f("Haircut price", "130", "price", { id: "p", status: "proposed", version: 2 }), f("Sale", "20% off haircut", "offer", { valid_to: iso(-1), valid_from: iso(-20) })], "haircut price sale", { now: NOW });
    expect(hits).toEqual([]);
  });
  it("owner-confirmed ranks above unconfirmed with the same relevance; stale is flagged and ranks lower", () => {
    const a = f("Haircut price", "120", "price", { owner_confirmed: true, confidence: 1 });
    const b = f("Haircut cost", "125", "price", { owner_confirmed: false, confidence: 0.6, source: "agent" });
    expect(factsFor([b, a], "haircut price cost", { now: NOW })[0]!.fact.id).toBe(a.id);
    const old = f("Haircut price", "120", "price", { observed_at: iso(-300) });
    expect(factsFor([old], "haircut price", { now: NOW })[0]!.stale).toBe(true);
  });
  it("the prompt block labels confidence, flags stale facts and the waiting proposals, and says not to guess", () => {
    const hits = factsFor([f("Haircut price", "120", "price", { observed_at: iso(-300) }), f("Refund policy", "14 days", "policy", { owner_confirmed: true })], "haircut price refund", { now: NOW });
    const p = factsPrompt(hits, ["haircut price"], NOW);
    expect(p).toContain("confirmed by the owner");
    expect(p).toContain("MAY BE OUTDATED");
    expect(p).toContain("waiting for the owner's decision");
    expect(p).toMatch(/ONLY if it is here/);
    expect(factsPrompt([], [], NOW)).toBe("");
  });
});

describe("plain-language lines in the business language", () => {
  it("he / en / ar", () => {
    expect(factLine({ kind: "changed", label: "Haircut", from: "120", to: "150", version: 2 }, "en")).toBe("Haircut: 120 → 150 (version 2)");
    expect(factLine({ kind: "proposed", label: "מחיר", value: "99" }, "he")).toContain("ממתין להחלטתך");
    expect(factLine({ kind: "accepted", label: "سعر" }, "ar")).toContain("تمت الموافقة");
    for (const lang of ["he", "en", "ar"] as const) for (const kind of ["rejected", "kept"] as const) expect(factLine({ kind, label: "X" }, lang)).toContain("X");
  });
});

describe("wiring (additive)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
  it("tools exist once, validate their arguments and need no extra permission beyond ai.use", () => {
    expect(new Set(TOOLS.map((t) => t.key)).size).toBe(TOOLS.length);
    for (const t of UPGRADE7_TOOLS) {
      expect(TOOL_MAP[t.key]).toBeTruthy();
      expect(t.permission).toBe("ai.use");
      expect(t.sensitivity).toBe("internal");
    }
    expect(TOOL_MAP["facts.record"]!.kind).toBe("write");
    expect(TOOL_MAP["facts.lookup"]!.kind).toBe("read");
    expect(validateArgs("facts.record", { label: "x", value: "y" }).ok).toBe(false);
    expect(validateArgs("facts.lookup", { query: "price" }).ok).toBe(true);
  });
  it("role grants only name real roles and real tools; nothing is removed from an employee", () => {
    for (const [role, tools] of Object.entries(ROLE_EXTRA_TOOLS_7)) {
      expect(ROLE_KEYS as readonly string[]).toContain(role);
      for (const k of tools) expect(k in TOOL_MAP).toBe(true);
    }
    expect(withRoleExtras7("sales", ["crm.find_contacts"])).toEqual(expect.arrayContaining(["crm.find_contacts", "facts.lookup"]));
    expect(withRoleExtras7("manager", withRoleExtras("manager", []))).toEqual(expect.arrayContaining(["market.what_changed", "facts.record"]));
    expect(withRoleExtras7("custom", ["tasks.open"])).toEqual(["tasks.open"]);
    expect(withRoleExtras7("analyst", ["facts.lookup"]).filter((t) => t === "facts.lookup")).toHaveLength(1);
    // the upgrade-4 function is untouched
    expect(withRoleExtras("sales", ["x"])).toEqual(["x"]);
  });
  it("the model can never claim to be the owner: facts.record forces the source", () => {
    const src = read("lib/team/business-facts.ts");
    expect(src).toMatch(/source: \/\^https\?:\\\/\\\/\/i\.test\(ref\) \? "web" : "agent"/);
    expect(src).not.toMatch(/source: args\./);
  });
  it("the runner adds the facts block without failing the task, and the tool is dispatched", () => {
    expect(read("lib/team/runner.ts")).toMatch(/factsPromptFor[\s\S]{0,200}\.catch\(\(\) => ""\)/);
    expect(read("lib/team/tools.ts")).toContain('case "facts.record"');
    expect(read("lib/team/runner.ts")).toContain("withRoleExtras7(m.role_key, withRoleExtras(m.role_key, m.tools))");
  });
  it("the migration is additive, append-only and RLS-protected", () => {
    const sql = readFileSync(resolve(__dirname, "../../../../supabase/migrations/20261105000001_team_upgrade_7_business_facts.sql"), "utf8");
    expect(sql).toContain("create table if not exists public.team_business_facts");
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(/where status = 'current'/);
    expect(sql).toMatch(/grant select, insert, update on public\.team_business_facts to service_role/);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*to (service_role|authenticated)/i);
    expect(sql).not.toMatch(/drop table|alter table public\.team_(?!business_facts)/i);
  });
  it("every new screen text exists in he / en / ar with the same keys", () => {
    const load = (l: string) => JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).aiTeam as Record<string, Record<string, unknown>>;
    const flat = (o: unknown, pre = ""): string[] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => flat(v, pre ? `${pre}.${k}` : k)) : [pre]);
    const he = flat(load("he").facts);
    expect(he.length).toBeGreaterThan(30);
    expect(flat(load("en").facts)).toEqual(he);
    expect(flat(load("ar").facts)).toEqual(he);
    for (const l of ["he", "en", "ar"]) for (const k of ["facts_lookup", "facts_history", "facts_record"]) expect(load(l).tools![k]).toBeTruthy();
    // every key the panel uses exists
    const used = [...read("components/ai-team/facts-panel.tsx").matchAll(/t\("(aiTeam\.facts\.[a-zA-Z.]+)"\)/g)].map((m) => m[1]!.replace("aiTeam.facts.", ""));
    for (const k of used) expect(he, k).toContain(k);
  });
  it("the panel is optimistic and rolls back on error", () => {
    const ui = read("components/ai-team/facts-panel.tsx");
    expect(ui).toContain("setRows(previous)");
    expect(ui).toMatch(/setRows\(\s*rows\.map/);
  });
});
