/**
 * Wave 26 — campaign analytics (pure, unit-tested). Everything is derived from the `stats` the sender already
 * writes ({recipients, sent, failed}) and the recipient rows, so no schema change is needed.
 */
export interface CampaignStats {
  recipients?: number;
  sent?: number;
  failed?: number;
}

export interface CampaignRates {
  recipients: number;
  sent: number;
  failed: number;
  /** still waiting (queued / skipped are not counted as delivered) */
  pending: number;
  /** 0..1 — sent / recipients */
  deliveryRate: number;
  /** 0..1 — failed / (sent + failed) */
  failureRate: number;
  /** 0..1 — (sent + failed) / recipients: how far the send has progressed */
  progress: number;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

export function campaignRates(stats: CampaignStats | null | undefined): CampaignRates {
  const recipients = n(stats?.recipients);
  const sent = n(stats?.sent);
  const failed = n(stats?.failed);
  const done = sent + failed;
  return {
    recipients,
    sent,
    failed,
    pending: Math.max(0, recipients - done),
    deliveryRate: recipients ? clamp(sent / recipients) : 0,
    failureRate: done ? clamp(failed / done) : 0,
    progress: recipients ? clamp(done / recipients) : 0,
  };
}

export interface CampaignRowLite {
  status: string;
  channel: string;
  stats?: CampaignStats | null;
}

export function summarizeCampaigns(rows: CampaignRowLite[]) {
  let sent = 0;
  let failed = 0;
  let recipients = 0;
  let active = 0;
  let drafts = 0;
  const byChannel: Record<string, number> = {};
  for (const r of rows) {
    const s = campaignRates(r.stats);
    sent += s.sent;
    failed += s.failed;
    recipients += s.recipients;
    if (r.status === "sending" || r.status === "scheduled") active++;
    if (r.status === "draft") drafts++;
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + s.sent;
  }
  const done = sent + failed;
  return { total: rows.length, sent, failed, recipients, active, drafts, deliveryRate: done ? clamp(sent / done) : 0, byChannel };
}

export const CAMPAIGN_STATUS_FILTERS = ["all", "draft", "scheduled", "sending", "sent", "canceled"] as const;
export type CampaignStatusFilter = (typeof CAMPAIGN_STATUS_FILTERS)[number];
export const isStatusFilter = (v: unknown): v is CampaignStatusFilter => typeof v === "string" && (CAMPAIGN_STATUS_FILTERS as readonly string[]).includes(v);

export const RECIPIENT_FILTERS = ["all", "sent", "failed", "queued", "skipped"] as const;
export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];
export const isRecipientFilter = (v: unknown): v is RecipientFilter => typeof v === "string" && (RECIPIENT_FILTERS as readonly string[]).includes(v);

/** a name for the copy: "Spring sale" → "Spring sale (copy)" without ever exceeding the 120-char DB limit */
export function copyName(name: string, suffix: string): string {
  const tail = ` ${suffix}`;
  const base = name.length + tail.length > 120 ? name.slice(0, 120 - tail.length).trimEnd() : name;
  return `${base}${tail}`;
}
