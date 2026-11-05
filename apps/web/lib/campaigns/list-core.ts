/** Campaigns list — sorting (pure, unit-tested). Newest first stays the default. */
export const CAMPAIGN_SORTS = ["newest", "oldest", "name", "recipients", "delivery"] as const;
export type CampaignSort = (typeof CAMPAIGN_SORTS)[number];

export interface CampaignSortRow {
  name: string;
  created_at: string;
  launched_at?: string | null;
  scheduled_at?: string | null;
  stats?: { recipients?: number; sent?: number; failed?: number } | null;
}

export const sortCampaignsKey = (v: unknown): CampaignSort => ((CAMPAIGN_SORTS as readonly string[]).includes(String(v)) ? (v as CampaignSort) : "newest");

const time = (r: CampaignSortRow) => Date.parse(r.launched_at ?? r.scheduled_at ?? r.created_at) || 0;
const delivery = (r: CampaignSortRow) => {
  const n = Number(r.stats?.recipients ?? 0);
  return n > 0 ? Number(r.stats?.sent ?? 0) / n : -1;
};

export function sortCampaigns<T extends CampaignSortRow>(rows: T[], sort: CampaignSort): T[] {
  const out = [...rows];
  switch (sort) {
    case "oldest":
      return out.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    case "name":
      return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    case "recipients":
      return out.sort((a, b) => Number(b.stats?.recipients ?? 0) - Number(a.stats?.recipients ?? 0) || time(b) - time(a));
    case "delivery":
      return out.sort((a, b) => delivery(b) - delivery(a) || time(b) - time(a));
    default:
      return out;
  }
}
