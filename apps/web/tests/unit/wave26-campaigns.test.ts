import { describe, expect, it } from "vitest";
import { campaignRates, copyName, isRecipientFilter, isStatusFilter, summarizeCampaigns } from "@/lib/campaigns/metrics";

describe("wave 26 — campaign metrics", () => {
  it("rates from stats, tolerant of junk", () => {
    expect(campaignRates({ recipients: 200, sent: 150, failed: 10 })).toMatchObject({ pending: 40, deliveryRate: 0.75, progress: 0.8 });
    expect(campaignRates(null)).toMatchObject({ recipients: 0, deliveryRate: 0, failureRate: 0, progress: 0 });
    expect(campaignRates({ recipients: 10, sent: 99 }).progress).toBe(1);
    expect(campaignRates({ recipients: Number.NaN, sent: -4 }).sent).toBe(0);
  });
  it("summary across campaigns", () => {
    const s = summarizeCampaigns([
      { status: "sent", channel: "email", stats: { recipients: 100, sent: 90, failed: 10 } },
      { status: "sending", channel: "whatsapp", stats: { recipients: 50, sent: 10, failed: 0 } },
      { status: "draft", channel: "email" },
    ]);
    expect(s).toMatchObject({ total: 3, sent: 100, failed: 10, active: 1, drafts: 1 });
    expect(s.byChannel).toEqual({ email: 90, whatsapp: 10, });
    expect(s.deliveryRate).toBeCloseTo(100 / 110);
  });
  it("filters and copy names", () => {
    expect(isStatusFilter("sent")).toBe(true);
    expect(isStatusFilter("x")).toBe(false);
    expect(isRecipientFilter("failed")).toBe(true);
    expect(copyName("Sale", "(copy)")).toBe("Sale (copy)");
    expect(copyName("x".repeat(120), "(copy)").length).toBeLessThanOrEqual(120);
  });
});
