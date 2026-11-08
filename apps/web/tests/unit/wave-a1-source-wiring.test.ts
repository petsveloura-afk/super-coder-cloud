import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(import.meta.dirname, "..", "..", p), "utf8");

describe("wave A1 — the guard is connected where text leaves the business", () => {
  it("the autopilot checks the reply before sending and uses the existing hand-over (never silence)", () => {
    const s = read("lib/ai/autopilot.ts");
    expect(s).toContain("outbound-guard-core");
    expect(s).toContain("guardrail_unready");
    // the check sits before the final send
    expect(s.indexOf("guardrail_unready")).toBeLessThan(s.indexOf("const text = formatForChannel(tools.text || handoffMessage(locale), ch);"));
  });
  it("social publishing holds a not-ready agent post as a draft (agent posts only)", () => {
    const s = read("lib/social/publish.ts");
    expect(s).toContain("outbound-guard-core");
    expect(s).toContain('hygiene: "not_ready"');
    expect(s).toMatch(/if \(p\.source === "agent"\) \{\s*try \{/);
  });
  it("the inbox explains a held message in the user's language", () => {
    expect(read("app/[locale]/(dashboard)/inbox/page.tsx")).toContain('t("inbox.heldByGuard")');
    for (const l of ["he", "en", "ar"]) expect(JSON.parse(read(`lib/i18n/dictionaries/${l}.json`)).inbox.heldByGuard).toBeTruthy();
  });
  it("the mode switch is documented", () => {
    expect(read("../../.env.example")).toContain("OUTBOUND_GUARD");
    expect(read("../../docs/ENVIRONMENT.md")).toContain("OUTBOUND_GUARD");
  });
});
