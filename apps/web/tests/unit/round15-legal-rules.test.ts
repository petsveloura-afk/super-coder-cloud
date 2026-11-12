import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_DOCS, legalContent, legalVars } from "@/lib/legal/platform";
import { legalAliasDoc } from "@/lib/legal/aliases-core";
import { deletionCode, parseSignedRequest, signRequestForTest } from "@/lib/legal/meta-signed-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("legal pages — the rules page and the standard addresses", () => {
  const v = legalVars({ BILLING_BUSINESS_NAME: "Super Coder", BILLING_BUSINESS_EMAIL: "owner@example.com" }, "https://app.supercoder.agency");

  it("the three existing documents stay first; the usage rules are added, in Hebrew and English", () => {
    expect(LEGAL_DOCS.slice(0, 3)).toEqual(["privacy", "terms", "data-deletion"]);
    expect(LEGAL_DOCS).toContain("acceptable-use");
    const he = legalContent("acceptable-use", "he", v);
    const en = legalContent("acceptable-use", "en", v);
    expect(he.title).toBe("כללי שימוש ומדיניות תוכן");
    expect(en.title).toBe("Acceptable Use and Content Policy");
    for (const c of [he, en]) expect(c.sections.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(he)).toContain("owner@example.com");
    expect(JSON.stringify(legalContent("terms", "he", v))).toContain("https://app.supercoder.agency/he/legal/acceptable-use");
    expect(legalContent("data-deletion", "he", v).title).toBe("מחיקת נתונים");
  });

  it("without LEGAL_CONTACT_EMAIL the business e-mail is the contact (reviewers need a real address)", () => {
    expect(legalVars({ BILLING_BUSINESS_EMAIL: "owner@example.com" }, "https://x.io").email).toBe("owner@example.com");
    expect(legalVars({ LEGAL_CONTACT_EMAIL: "privacy@example.com", BILLING_BUSINESS_EMAIL: "owner@example.com" }, "https://x.io").email).toBe("privacy@example.com");
    expect(legalVars({}, "https://x.io").email).toBeNull();
  });

  it("/privacy, /terms, /data-deletion, /rules … lead to the right page", () => {
    expect(legalAliasDoc("/privacy")).toBe("privacy");
    expect(legalAliasDoc("/privacy-policy/")).toBe("privacy");
    expect(legalAliasDoc("/terms")).toBe("terms");
    expect(legalAliasDoc("/TOS")).toBe("terms");
    expect(legalAliasDoc("/data-deletion")).toBe("data-deletion");
    expect(legalAliasDoc("/data-deletion.html")).toBe("data-deletion");
    expect(legalAliasDoc("/rules")).toBe("acceptable-use");
    expect(legalAliasDoc("/legal")).toBe("privacy");
    expect(legalAliasDoc("/overview")).toBeNull();
    expect(legalAliasDoc("/legal/privacy")).toBeNull();
    const proxy = read("proxy.ts");
    expect(proxy).toContain("legalAliasDoc(subPath)");
    // a published website on its own domain keeps its own /privacy (handled before the alias)
    expect(proxy.indexOf("SITE_LEGAL.test(pathname)")).toBeLessThan(proxy.indexOf("legalAliasDoc(subPath)"));
  });
});

describe("Meta data-deletion and deauthorize callbacks", () => {
  it("accepts only a request signed with one of the platform's app secrets", () => {
    const good = signRequestForTest({ algorithm: "HMAC-SHA256", user_id: "17841400000000001", issued_at: 1 }, "igsecret");
    expect(parseSignedRequest(good, ["fbsecret", "igsecret"])?.user_id).toBe("17841400000000001");
    expect(parseSignedRequest(good, ["fbsecret"])).toBeNull();
    expect(parseSignedRequest(good.replace(/^./, (c) => (c === "A" ? "B" : "A")), ["igsecret"])).toBeNull();
    expect(parseSignedRequest(signRequestForTest({ algorithm: "none", user_id: "1234" }, "s"), ["s"])).toBeNull();
    expect(parseSignedRequest(signRequestForTest({ algorithm: "HMAC-SHA256", user_id: "x'; drop" }, "s"), ["s"])).toBeNull();
    expect(parseSignedRequest("", ["s"])).toBeNull();
  });

  it("answers with the status address and a readable confirmation code", () => {
    const code = deletionCode("17841400000000001", Date.parse("2026-11-13T00:00:00Z"), () => 0.5);
    expect(code).toMatch(/^DEL-[A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]{4}$/);
    const del = read("app/api/meta/data-deletion/route.ts");
    expect(del).toContain("{ url, confirmation_code: code }");
    expect(del).toContain("/legal/data-deletion?request=");
    expect(read("app/[locale]/(public)/legal/[doc]/page.tsx")).toContain("deletion-status");
    expect(read("lib/legal/meta-callbacks.ts")).toContain('from("audit_logs")');
  });
});
