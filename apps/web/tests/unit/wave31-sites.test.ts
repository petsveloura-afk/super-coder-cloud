import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditSite, combinedInstruction } from "@/lib/site/audit-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const strong = {
  name: "x",
  status: "draft",
  seo: { title: "Dental clinic in Tel Aviv - gentle care and quick appointments", description: "A modern dental clinic in Tel Aviv for families: implants, whitening and urgent care. Book your first visit today." },
  blocks: [
    { type: "hero", data: { title: "h", subtitle: "s", cta_label: "Book", cta_href: "#book", image_url: "https://x.co/a.jpg" } },
    { type: "stats", data: { title: "n", items: [{ value: "15", label: "years" }, { value: "4000", label: "patients" }] } },
    { type: "features", data: { title: "f", items: [] } },
    { type: "faq", data: { title: "q", items: [{ q: "one?", a: "a" }, { q: "two?", a: "a" }, { q: "three?", a: "a" }] } },
    { type: "booking", data: { title: "b", booking_slug: "clinic-main" } },
    { type: "contact", data: { title: "c", phone: "03-1234567" } },
  ],
  settings: { logo_url: "https://x.co/l.png", legal_name: "Clinic Ltd", email: "a@b.co" },
};

describe("wave 31 — site audit", () => {
  it("a complete site scores 100 and has nothing failing", () => {
    const r = auditSite(strong);
    expect(r.score).toBe(100);
    expect(r.failing).toHaveLength(0);
    expect(combinedInstruction(r)).toBe("");
  });
  it("a bare site scores low and lists AI-fixable and manual items, biggest first", () => {
    const r = auditSite({ name: "x", status: "draft", seo: { title: "", description: "" }, blocks: [{ type: "hero", data: { title: "h" } }] });
    expect(r.score).toBeLessThan(30);
    expect(r.failing[0]!.weight).toBeGreaterThanOrEqual(r.failing[r.failing.length - 1]!.weight);
    expect(r.failing.some((c) => c.fix === "ai")).toBe(true);
    expect(r.failing.some((c) => c.fix === "manual" && c.tab)).toBe(true);
    expect(combinedInstruction(r)).toContain("Apply ALL");
  });
  it("weights add up to 100", () => {
    expect(auditSite(strong).checks.reduce((a, c) => a + c.weight, 0)).toBe(100);
  });
  it("every check has a label + hint in all three languages", () => {
    const ids = auditSite(strong).checks.map((c) => c.id);
    for (const l of ["he", "en", "ar"]) {
      const w = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).websites;
      for (const id of ids) {
        expect(w.audit.checks[id].label).toBeTruthy();
        expect(w.audit.checks[id].hint).toBeTruthy();
      }
      for (const q of ["faq", "seo", "cta", "trust", "arabic", "hebrew"]) {
        expect(w.aiEdit.quick[q]).toBeTruthy();
        expect(w.aiEdit.quickLabel[q]).toBeTruthy();
      }
      expect(w.duplicate).toBeTruthy();
      expect(w.list.noMatch).toBeTruthy();
    }
  });
  it("duplicate creates a draft copy inside the same organization", () => {
    const a = read("app/[locale]/(dashboard)/websites/actions.ts");
    expect(a).toContain("export async function duplicateSiteAction");
    expect(a).toContain("cloneSiteDraft");
    const c = read("lib/site/clone.ts");
    expect(c).toMatch(/status: "draft"[\s\S]{0,200}published_at: null/);
    expect(c).toContain('.eq("organization_id", o.orgId)');
  });
});
