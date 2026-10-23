import type { APIRequestContext } from "@playwright/test";

/**
 * Since v15 the agent never sends a price that is not in the business information
 * (self-check → correction → the invented price is dropped). Tests whose mock answer quotes
 * a price add that price to the business's agent first, like a real business would.
 * Needs the local stack service key; a no-op without it.
 */
export async function addKnownPrice(request: APIRequestContext, orgSlug: string, line: string): Promise<void> {
  const supa = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supa || !key) return;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const org = ((await (await request.get(`${supa}/rest/v1/organizations?select=id&slug=eq.${orgSlug}`, { headers })).json()) as { id: string }[])[0];
  if (!org) return;
  const agents = (await (await request.get(`${supa}/rest/v1/ai_agents?select=id,instructions&organization_id=eq.${org.id}`, { headers })).json()) as { id: string; instructions: string | null }[];
  for (const a of agents) {
    if ((a.instructions ?? "").includes(line)) continue;
    await request.patch(`${supa}/rest/v1/ai_agents?id=eq.${a.id}`, { headers, data: { instructions: `${a.instructions ?? ""}\n${line}`.trim() } });
  }
}
