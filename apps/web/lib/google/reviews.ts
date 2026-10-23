import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleAccessToken } from "./connect";

/**
 * Wave 19 — Google Business Profile reviews: new reviews are pulled every cron run, the AI
 * drafts a reply in the business's voice, 4-5★ replies can go out automatically
 * (agent setting), anything lower waits for a person. Replies are posted back to Google.
 */
const acctBase = () => (process.env.GBP_ACCOUNTS_API_BASE || "https://mybusinessaccountmanagement.googleapis.com/v1").replace(/\/$/, "");
const infoBase = () => (process.env.GBP_INFO_API_BASE || "https://mybusinessbusinessinformation.googleapis.com/v1").replace(/\/$/, "");
const v4Base = () => (process.env.GBP_V4_API_BASE || "https://mybusiness.googleapis.com/v4").replace(/\/$/, "");

async function getJson(url: string, token: string): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  return { ok: res.ok, status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** accounts/{a}/locations/{l} names the business can manage (first 10). */
export async function listLocations(token: string): Promise<{ name: string; title: string; account: string }[]> {
  const a = await getJson(`${acctBase()}/accounts`, token);
  const accounts = ((a.json.accounts as { name: string }[] | undefined) ?? []).slice(0, 5);
  const out: { name: string; title: string; account: string }[] = [];
  for (const acc of accounts) {
    const l = await getJson(`${infoBase()}/${acc.name}/locations?readMask=name,title&pageSize=10`, token);
    for (const loc of ((l.json.locations as { name: string; title?: string }[] | undefined) ?? []).slice(0, 10)) out.push({ name: loc.name, title: loc.title ?? "", account: acc.name });
  }
  return out.slice(0, 10);
}

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export async function syncReviews(orgId: string, refreshToken: string, locations: { name: string; account: string }[]): Promise<{ fetched: number; added: number; error?: string }> {
  const token = await googleAccessToken(refreshToken);
  if (!token) return { fetched: 0, added: 0, error: "google_auth" };
  const admin = createAdminClient();
  let fetched = 0;
  let added = 0;
  for (const loc of locations.slice(0, 10)) {
    // v4 reviews live under accounts/{a}/locations/{l}
    const locId = loc.name.replace(/^locations\//, "");
    const r = await getJson(`${v4Base()}/${loc.account}/locations/${locId}/reviews?pageSize=50&orderBy=updateTime%20desc`, token);
    if (!r.ok) return { fetched, added, error: `reviews_${r.status}` };
    for (const rv of (r.json.reviews as { reviewId?: string; name?: string; reviewer?: { displayName?: string }; starRating?: string; comment?: string; reviewReply?: { comment?: string }; createTime?: string }[] | undefined) ?? []) {
      fetched++;
      const { data } = await admin.rpc("record_review", {
        p_org: orgId,
        p_source: "google",
        p_location: `${loc.account}/locations/${locId}`,
        p_external: rv.name ?? rv.reviewId ?? "",
        p_author: rv.reviewer?.displayName ?? null,
        p_rating: STAR[rv.starRating ?? ""] ?? null,
        p_body: rv.comment ?? "",
        p_reply: rv.reviewReply?.comment ?? null,
        p_reviewed_at: rv.createTime ?? null,
      });
      if ((data as { id?: string; duplicate?: boolean } | null)?.id) added++;
    }
  }
  return { fetched, added };
}

export async function postReviewReply(refreshToken: string, reviewName: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = await googleAccessToken(refreshToken);
  if (!token) return { ok: false, error: "google_auth" };
  const res = await fetch(`${v4Base()}/${reviewName}/reply`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ comment: text.slice(0, 4000) }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  return res.ok ? { ok: true } : { ok: false, error: `reply_${res.status}` };
}
