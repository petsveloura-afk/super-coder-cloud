import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { railwayAttach, railwayDetach, railwayDomainsConfigured, railwayState, recordType, recordsFromStatus, RailwayDomainError } from "@/lib/site/domains-railway";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const ENV = { RAILWAY_API_TOKEN: "tok", RAILWAY_PROJECT_ID: "p1", RAILWAY_ENVIRONMENT_ID: "e1", RAILWAY_SERVICE_ID: "s1", RAILWAY_API_BASE: "https://rw.test/graphql/v2" };

function fakeFetch(handler: (body: { query: string; variables: Record<string, unknown> }, headers: Record<string, string>) => unknown, status = 200) {
  const calls: { query: string; variables: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    calls.push({ ...body, headers: init.headers });
    const data = handler(body, init.headers);
    return new Response(JSON.stringify(data), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("custom domains on Railway (the app moved off Vercel)", () => {
  it("is configured with ONE token — Railway injects the project / environment / service ids itself", () => {
    expect(railwayDomainsConfigured(ENV)).toBe(true);
    expect(railwayDomainsConfigured({ ...ENV, RAILWAY_API_TOKEN: undefined, RAILWAY_PROJECT_TOKEN: "pt" })).toBe(true);
    expect(railwayDomainsConfigured({ ...ENV, RAILWAY_API_TOKEN: undefined })).toBe(false);
    expect(railwayDomainsConfigured({ ...ENV, RAILWAY_SERVICE_ID: undefined })).toBe(false);
  });

  it("the customer gets exactly the records Railway asks for — CNAME + the '_railway-verify' TXT with its prefix", () => {
    expect(recordType("DNS_RECORD_TYPE_CNAME")).toBe("CNAME");
    const recs = recordsFromStatus("app.example.co.il", { dnsRecords: [{ hostlabel: "app", recordType: "DNS_RECORD_TYPE_CNAME", requiredValue: "g8cyv5xy.up.railway.app" }], verificationDnsHost: "_railway-verify.app.example.co.il", verificationToken: "39f5abc" });
    expect(recs).toContainEqual({ type: "CNAME", name: "app", value: "g8cyv5xy.up.railway.app" });
    const txt = recs.find((r) => r.type === "TXT")!;
    expect(txt.value).toBe("railway-verify=39f5abc"); // the exact mistake that kept app.supercoder.agency "waiting for DNS"
    expect(recordsFromStatus("shop.com", { verificationDnsHost: "_railway-verify.shop.com", verificationToken: "railway-verify=x" }).find((r) => r.type === "TXT")!.value).toBe("railway-verify=x");
  });

  it("attach: creates the domain on the app's service (Bearer token, the injected ids); a second attach just reads it", async () => {
    let created = false;
    const { f, calls } = fakeFetch((b) => {
      if (b.query.includes("customDomainCreate")) {
        created = true;
        return { data: { customDomainCreate: { id: "cd1", domain: "www.shop.com", status: { dnsRecords: [{ hostlabel: "www", recordType: "DNS_RECORD_TYPE_CNAME", requiredValue: "x.up.railway.app" }], verified: false } } } };
      }
      return { data: { domains: { customDomains: created ? [{ id: "cd1", domain: "www.shop.com", status: { verified: true, dnsRecords: [] } }] : [] } } };
    });
    const a = await railwayAttach("www.shop.com", ENV, f);
    expect(a.id).toBe("cd1");
    expect(a.records[0]).toEqual({ type: "CNAME", name: "www", value: "x.up.railway.app" });
    const create = calls.find((c) => c.query.includes("customDomainCreate"))!;
    expect(create.variables.input).toEqual({ domain: "www.shop.com", projectId: "p1", environmentId: "e1", serviceId: "s1" });
    expect(create.headers.Authorization).toBe("Bearer tok");
    const again = await railwayAttach("www.shop.com", ENV, f);
    expect(again.verified).toBe(true);
    expect(calls.filter((c) => c.query.includes("customDomainCreate"))).toHaveLength(1);
  });

  it("state / detach; a project token goes in its own header; API errors become friendly codes (never raw text to the user)", async () => {
    const { f, calls } = fakeFetch((b) => (b.query.includes("customDomainDelete") ? { data: { customDomainDelete: true } } : { data: { domains: { customDomains: [{ id: "cd9", domain: "a.com", status: { verified: true } }] } } }));
    const env = { ...ENV, RAILWAY_API_TOKEN: undefined, RAILWAY_PROJECT_TOKEN: "pt" };
    expect((await railwayState("a.com", env, f)).verified).toBe(true);
    await railwayDetach("a.com", env, f);
    expect(calls.at(-1)!.variables).toEqual({ id: "cd9" });
    expect(calls.at(-1)!.headers["Project-Access-Token"]).toBe("pt");
    const bad = fakeFetch(() => ({ errors: [{ message: "Domain already in use" }] }));
    await expect(railwayAttach("b.com", ENV, bad.f)).rejects.toBeInstanceOf(RailwayDomainError);
    await expect(railwayAttach("b.com", ENV, bad.f)).rejects.toMatchObject({ status: 409 });
  });

  it("the site domains use Railway when there is no Vercel project; buying stays registrar-only and the panel shows only 'connect'", () => {
    const src = read("lib/site/domains.ts");
    expect(src).toContain("return vercelDomains() || railwayDomainsConfigured();");
    expect(src).toContain("if (onRailway()) return railwayDetach(domain);");
    expect(read("app/[locale]/(dashboard)/websites/domain-actions.ts")).toContain('"websites.domain.err.purchaseOff"');
    expect(read("components/websites/domain-panel.tsx")).toContain('p.canBuy === false ? (["connect"] as const)');
  });
});
