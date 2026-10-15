import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/env";
import { csvCell, formatPhone } from "@/lib/format";
import { contactSearchFilter, sanitizeSearch } from "@/lib/search";

const root = path.resolve(import.meta.dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (["node_modules", ".next", "tests", "test-results", "playwright-report"].includes(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const sources = walk(root).map((f) => ({ f: path.relative(root, f), src: readFileSync(f, "utf8") }));

describe("open-redirect protection", () => {
  it("only allows same-origin relative paths", () => {
    expect(safeRedirectPath("/he/crm", "/x")).toBe("/he/crm");
    expect(safeRedirectPath("//evil.com", "/x")).toBe("/x");
    expect(safeRedirectPath("/\\evil.com", "/x")).toBe("/x");
    expect(safeRedirectPath("https://evil.com", "/x")).toBe("/x");
    expect(safeRedirectPath("javascript:alert(1)", "/x")).toBe("/x");
    expect(safeRedirectPath(null, "/x")).toBe("/x");
  });
});

describe("CSV export", () => {
  it("neutralises spreadsheet formula injection and quotes safely", () => {
    expect(csvCell("=SUM(A1)")).toBe(`"'=SUM(A1)"`);
    expect(csvCell("+972")).toBe(`"'+972"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell('a"b')).toBe(`"a""b"`);
    expect(csvCell(null)).toBe(`""`);
  });
});

describe("search filter injection", () => {
  it("strips PostgREST filter syntax and wildcards", () => {
    expect(sanitizeSearch("a,b)(or=id.eq.1*%")).toBe("a b or id.eq.1");
    const f = contactSearchFilter("x),organization_id.neq.0");
    expect(f).not.toContain(")");
    expect(f!.split(",").every((p) => /^(first_name|last_name|email|company_name|phone)\.ilike\.\*/.test(p))).toBe(true);
  });
  it("keeps Hebrew/Arabic letters and phone digits", () => {
    expect(sanitizeSearch("  נועה   כהן ")).toBe("נועה כהן");
    expect(sanitizeSearch("أحمد")).toBe("أحمد");
    expect(contactSearchFilter("050-123")).toContain("phone.ilike.*050123*");
    expect(contactSearchFilter("")).toBeNull();
  });
  it("formats Israeli phones for display without altering digits", () => {
    expect(formatPhone("+972501234567")).toBe("+972-50-123-4567");
    expect(formatPhone("+14155550100")).toBe("+14155550100");
  });
});

describe("static security checks", () => {
  it("the service-role client is never imported by client components", () => {
    const offenders = sources.filter(
      ({ src }) => /^["']use client["']/m.test(src) && /supabase\/admin|SUPABASE_SERVICE_ROLE_KEY/.test(src),
    );
    expect(offenders.map((o) => o.f)).toEqual([]);
  });
  it("no secret is read through a NEXT_PUBLIC_ variable", () => {
    const bad = sources.filter(({ src }) => /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|PRIVATE|TOKEN|API_KEY)/.test(src));
    expect(bad.map((o) => o.f)).toEqual([]);
  });
  it("no hard-coded JWTs or provider keys in source", () => {
    const bad = sources.filter(({ src }) => /eyJhbGciOi[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|sk_live_[A-Za-z0-9]{10,}/.test(src));
    expect(bad.map((o) => o.f)).toEqual([]);
  });
  it("server actions never take organization_id from the client form", () => {
    const actions = sources.filter(({ f }) => f.endsWith("actions.ts"));
    expect(actions.length).toBeGreaterThan(0);
    for (const { f, src } of actions) {
      expect(/fd\.get\(["']organization_?[iI]d["']\)/.test(src), f).toBe(false);
    }
  });
  it("every dashboard page resolves the org context server-side", () => {
    const pages = sources.filter(({ f }) => /app\/\[locale\]\/\(dashboard\)\/(?!\[module\]).+\/page\.tsx$/.test(f));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const { f, src } of pages) expect(src.includes("getOrgContext("), f).toBe(true);
  });
});
