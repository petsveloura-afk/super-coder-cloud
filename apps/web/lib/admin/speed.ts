import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Speed upgrade — DB round trip (best of 3) and the agent's reply times over the last 24h. */
export async function measureSpeed(): Promise<{ db: number; totals: number; p50: number | null; p90: number | null; region: string; supa: string }> {
  const admin = createAdminClient();
  const rtts: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    await admin.from("plans").select("key").limit(1);
    rtts.push(Date.now() - t0);
  }
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data } = await admin.from("messages").select("meta").not("ai_agent_id", "is", null).gt("created_at", since).not("meta->timing", "is", null).order("created_at", { ascending: false }).limit(500);
  const list = ((data ?? []) as { meta: { timing?: { total?: number } } | null }[]).map((r) => Number(r.meta?.timing?.total)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const pct = (p: number) => (list.length ? list[Math.min(list.length - 1, Math.floor(p * list.length))]! : null);
  return {
    db: Math.min(...rtts),
    totals: list.length,
    p50: pct(0.5),
    p90: pct(0.9),
    region: process.env.VERCEL_REGION ?? "local",
    supa: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "").split("/")[0] ?? "",
  };
}
