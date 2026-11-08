import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTION_TYPES, AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, CONDITION_FIELDS, CONDITION_OPS, ACTION_CATEGORIES, TRIGGER_CATEGORY_KEYS, analyzeAutomation, suggestActions } from "@scc/shared/automations";
import { INTEL_DICTS, intelT } from "@/components/automations/intel-i18n";
import he from "@/lib/i18n/dictionaries/he.json";
import en from "@/lib/i18n/dictionaries/en.json";
import ar from "@/lib/i18n/dictionaries/ar.json";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("automation intelligence copy", () => {
  it("he / en / ar have identical keys and identical placeholders", () => {
    const base = Object.keys(INTEL_DICTS.he).sort();
    expect(Object.keys(INTEL_DICTS.en).sort()).toEqual(base);
    expect(Object.keys(INTEL_DICTS.ar).sort()).toEqual(base);
    for (const k of base) {
      const h = (INTEL_DICTS.he as Record<string, string>)[k]!;
      expect(placeholders((INTEL_DICTS.en as Record<string, string>)[k]!), `en ${k}`).toBe(placeholders(h));
      expect(placeholders((INTEL_DICTS.ar as Record<string, string>)[k]!), `ar ${k}`).toBe(placeholders(h));
      expect(h.trim().length, k).toBeGreaterThan(0);
    }
  });

  it("every analyzer insight code has a message in every language", () => {
    const src = readFileSync(join(__dirname, "../../../../packages/shared/src/automation-intel.ts"), "utf8");
    // only the analyzer section (suggestion codes use the "s." prefix and are checked below)
    const analyzer = src.slice(src.indexOf("export function analyzeAutomation"), src.indexOf("/* ------------------------------------------------------------ flow preview"));
    expect(analyzer.length).toBeGreaterThan(1000);
    const codes = new Set([...analyzer.matchAll(/code: "([A-Za-z]+)"/g)].map((m) => m[1]!));
    expect(codes.size).toBeGreaterThan(25);
    for (const l of ["he", "en", "ar"] as const) for (const c of codes) expect((INTEL_DICTS[l] as Record<string, string>)[`i.${c}`], `${l} i.${c}`).toBeTruthy();
  });

  it("covers suggestions, grades, health states, categories and field names", () => {
    const sugg = new Set<string>();
    for (const tr of AUTOMATION_TRIGGERS) for (const s of suggestActions({ trigger_type: tr, actions: [] })) sugg.add(s.code);
    const keys = [
      ...[...sugg].flatMap((c) => [`s.${c}`, `s.${c}.hint`]),
      ...["excellent", "good", "needsWork", "risky"].map((g) => `g.${g}`),
      ...["disabled", "idle", "healthy", "attention", "failing"].map((h) => `h.${h}`),
      ...["all", ...TRIGGER_CATEGORY_KEYS].map((c) => `c.${c}`),
      ...Object.keys(ACTION_CATEGORIES).map((c) => `ac.${c}`),
      ...["title", "tag", "stage_id", "user_id", "body", "text", "subject", "url"].map((f) => `f.${f}`),
    ];
    for (const l of ["he", "en", "ar"] as const) for (const k of keys) expect((INTEL_DICTS[l] as Record<string, string>)[k], `${l} ${k}`).toBeTruthy();
  });

  it("interpolates and falls back safely", () => {
    expect(intelT("en")("o.rate", { rate: 90 })).toBe("90% success");
    expect(intelT("he")("does.not.exist")).toBe("does.not.exist");
    expect(intelT("ar")("i.noActions")).toBeTruthy();
  });

  it("reuses only existing global dictionary keys (triggers, actions, fields, ops, recipes) in all languages", () => {
    for (const d of [he, en, ar] as unknown as { automations: Record<string, Record<string, unknown>> }[]) {
      for (const tr of AUTOMATION_TRIGGERS) expect(d.automations.triggers![tr.replace(/\./g, "_")], tr).toBeTruthy();
      for (const a of ACTION_TYPES) expect(d.automations.actions![a], a).toBeTruthy();
      for (const f of CONDITION_FIELDS) expect(d.automations.fields![f.replace(/\./g, "_")], f).toBeTruthy();
      for (const o of CONDITION_OPS) expect(d.automations.ops![o], o).toBeTruthy();
      for (const r of AUTOMATION_RECIPES) expect(d.automations.recipes![r.key], r.key).toBeTruthy();
    }
  });

  it("a real recipe analyzes cleanly end to end", () => {
    const r = AUTOMATION_RECIPES[0]!;
    const a = analyzeAutomation({ trigger_type: r.trigger_type, actions: r.actions });
    expect(a.counts.error).toBe(0);
  });
});
