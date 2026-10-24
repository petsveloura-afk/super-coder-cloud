import { describe, expect, it } from "vitest";
import { LEGAL_DOCS, legalContent, legalVars } from "@/lib/legal/platform";

describe("the platform's legal pages (Meta / Google app review)", () => {
  const v = legalVars({ BILLING_BUSINESS_NAME: "פרמו דיגיטלי", LEGAL_CONTACT_EMAIL: "privacy@example.com" }, "https://app.example.com/");
  it("every document exists in Hebrew and English with real sections", () => {
    for (const d of LEGAL_DOCS)
      for (const l of ["he", "en"] as const) {
        const c = legalContent(d, l, v);
        expect(c.title.length).toBeGreaterThan(3);
        expect(c.sections.length).toBeGreaterThanOrEqual(3);
        expect(c.sections.every((s) => s.p.length > 0 && s.p.every((x) => x.trim().length > 0))).toBe(true);
      }
  });
  it("names the business, the contact e-mail and the data-deletion address", () => {
    const he = JSON.stringify(legalContent("privacy", "he", v));
    expect(he).toContain("פרמו דיגיטלי");
    expect(he).toContain("privacy@example.com");
    expect(he).toContain("https://app.example.com/he/legal/data-deletion");
  });
  it("without an e-mail it points to the help center; a bad e-mail is ignored", () => {
    const w = legalVars({ LEGAL_CONTACT_EMAIL: "not-an-email" }, "https://x.io");
    expect(w.email).toBeNull();
    expect(w.name).toBe("Super Coder Cloud");
    expect(JSON.stringify(legalContent("data-deletion", "en", w))).toContain("https://x.io/en/help");
  });
});
