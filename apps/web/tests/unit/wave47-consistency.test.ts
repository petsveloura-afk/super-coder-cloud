import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("wave 47 — consistent time zone + Facebook speed indexes (additive)", () => {
  it("social / agents screens format times in the platform time zone (same on server and browser)", () => {
    for (const f of ["../../components/social/social-client.tsx", "../../components/social/social-extras.tsx", "../../components/agents/agents-hub.tsx"]) {
      const src = read(f);
      expect(src).toContain('import { DEFAULT_TIME_ZONE } from "@/lib/format"');
      expect(src).toContain("timeZone: DEFAULT_TIME_ZONE");
    }
  });

  it("server-side dates on receipts and renewal reminders use Israel time, not UTC", () => {
    expect(read("../../app/api/billing/sweep/route.ts")).toContain('timeZone: "Asia/Jerusalem"');
    expect(read("../../lib/billing/receipts.ts")).toContain('timeZone: "Asia/Jerusalem"');
  });

  it("the speed-index migration only creates indexes (idempotent, no drops, no data changes)", () => {
    const sql = read("../../../../supabase/migrations/20261029000004_facebook_reply_speed_indexes.sql");
    const statements = sql.replace(/--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
    for (const s of statements) {
      expect(s).toMatch(/^(create index if not exists|notify pgrst)/i);
    }
    expect(sql).not.toMatch(/\b(drop|delete|update|truncate|alter)\b/i);
  });
});
