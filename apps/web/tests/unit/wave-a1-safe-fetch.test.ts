import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The DNS lookup is replaced: hosts named "internal-*" resolve to a private address, everything else to a public one.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => (host.startsWith("internal") ? [{ address: "10.0.0.5", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]),
}));

const calls: string[] = [];
function respond(map: Record<string, { status: number; location?: string; body?: string }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string, init?: RequestInit) => {
      const u = String(input);
      calls.push(`${u}|${init?.redirect}`);
      const r = map[u];
      if (!r) return new Response("not mapped", { status: 404 });
      return new Response(r.body ?? "ok", { status: r.status, headers: r.location ? { location: r.location } : {} });
    }),
  );
}

describe("wave A1 — fetchPublicHttps follows redirects only to public https hosts", () => {
  beforeEach(() => {
    calls.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a normal answer and never lets fetch follow redirects by itself", async () => {
    respond({ "https://example.com/": { status: 200, body: "hello" } });
    const { fetchPublicHttps } = await import("@/lib/net/safe-fetch");
    const res = await fetchPublicHttps("https://example.com/");
    expect(await res.text()).toBe("hello");
    expect(calls).toEqual(["https://example.com/|manual"]);
  });

  it("follows a redirect to another public host (relative locations too)", async () => {
    respond({
      "https://example.com/": { status: 301, location: "/home" },
      "https://example.com/home": { status: 302, location: "https://www.example.org/start" },
      "https://www.example.org/start": { status: 200, body: "arrived" },
    });
    const { fetchPublicHttps } = await import("@/lib/net/safe-fetch");
    const res = await fetchPublicHttps("https://example.com/");
    expect(await res.text()).toBe("arrived");
    expect(calls).toHaveLength(3);
  });

  it("refuses a redirect to a host that resolves to a private address — the internal host is never requested", async () => {
    respond({ "https://example.com/": { status: 302, location: "https://internal-admin.example.net/secrets" }, "https://internal-admin.example.net/secrets": { status: 200, body: "SECRET" } });
    const { fetchPublicHttps } = await import("@/lib/net/safe-fetch");
    await expect(fetchPublicHttps("https://example.com/")).rejects.toThrow("host_not_allowed");
    expect(calls).toEqual(["https://example.com/|manual"]);
  });

  it("refuses a redirect to a literal metadata / loopback IP and to plain http", async () => {
    const { fetchPublicHttps } = await import("@/lib/net/safe-fetch");
    respond({ "https://example.com/": { status: 302, location: "https://169.254.169.254/latest/meta-data" } });
    await expect(fetchPublicHttps("https://example.com/")).rejects.toThrow("host_not_allowed");
    respond({ "https://example.com/": { status: 302, location: "http://example.org/" } });
    await expect(fetchPublicHttps("https://example.com/")).rejects.toThrow("https_required");
    respond({ "https://example.com/": { status: 302, location: "https://127.0.0.1/" } });
    await expect(fetchPublicHttps("https://example.com/")).rejects.toThrow("host_not_allowed");
  });

  it("stops a redirect loop", async () => {
    respond({ "https://example.com/": { status: 302, location: "https://example.com/" } });
    const { fetchPublicHttps } = await import("@/lib/net/safe-fetch");
    await expect(fetchPublicHttps("https://example.com/", {}, { maxRedirects: 3 })).rejects.toThrow("too_many_redirects");
    expect(calls).toHaveLength(4);
  });

  it("rejects the first URL when it is already private or not https", async () => {
    respond({});
    const { fetchPublicHttps } = await import("@/lib/net/safe-fetch");
    await expect(fetchPublicHttps("https://internal-db.example.net/")).rejects.toThrow("host_not_allowed");
    await expect(fetchPublicHttps("http://example.com/")).rejects.toThrow("https_required");
    expect(calls).toHaveLength(0);
  });
});
