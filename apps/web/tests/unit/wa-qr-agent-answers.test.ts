import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentCoversChannel, pickAgentForChannel, withChannel } from "@/lib/ai/agent-channel-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("WhatsApp by QR / phone code — the agent answers like on every other channel", () => {
  it("an agent ticked only for the official WhatsApp does not cover whatsapp_qr", () => {
    expect(agentCoversChannel([{ id: "a", enabled: true, autopilot_channels: ["web", "whatsapp"] }], "whatsapp_qr")).toBe(false);
    expect(agentCoversChannel([{ id: "a", enabled: true, autopilot_channels: ["whatsapp_qr"] }], "whatsapp_qr")).toBe(true);
    expect(agentCoversChannel([{ id: "a", enabled: false, autopilot_channels: ["whatsapp_qr"] }], "whatsapp_qr")).toBe(false);
  });

  it("picks the agent that already works on the official WhatsApp, else the first working agent", () => {
    const a = { id: "a", enabled: true, autopilot_channels: ["web"] };
    const b = { id: "b", enabled: true, autopilot_channels: ["telegram", "whatsapp"] };
    expect(pickAgentForChannel([a, b], "whatsapp_qr")?.id).toBe("b");
    expect(pickAgentForChannel([a, { id: "c", enabled: true, autopilot_channels: ["email"] }], "whatsapp_qr")?.id).toBe("a");
  });

  it("never picks a disabled agent or one that answers nowhere; no agent → null (nothing is created)", () => {
    expect(pickAgentForChannel([{ id: "x", enabled: false, autopilot_channels: ["web"] }], "whatsapp_qr")).toBeNull();
    expect(pickAgentForChannel([{ id: "y", enabled: true, autopilot_channels: [] }], "whatsapp_qr")).toBeNull();
    expect(pickAgentForChannel([], "whatsapp_qr")).toBeNull();
  });

  it("adding a channel keeps the existing ones and never duplicates", () => {
    expect(withChannel(["web", "whatsapp"], "whatsapp_qr")).toEqual(["web", "whatsapp", "whatsapp_qr"]);
    expect(withChannel(["whatsapp_qr"], "whatsapp_qr")).toEqual(["whatsapp_qr"]);
    expect(withChannel(null, "whatsapp_qr")).toEqual(["whatsapp_qr"]);
  });

  it("the wiring: connected callback, LID customers and the autopilot fallback", () => {
    const route = read("app/api/channels/whatsapp_qr/[token]/route.ts");
    expect(route).toContain("ensureAgentOnChannel(acc.organization_id, \"whatsapp_qr\")");
    expect(route).toContain("phone: ev.lid ? null");
    const auto = read("lib/ai/autopilot.ts");
    expect(auto).toContain('channel === "whatsapp_qr")');
    expect(auto).toContain("pickAgentForChannel");
    // the original Meta fallback is untouched
    expect(auto).toMatch(/channel === "messenger" \|\| channel === "instagram"\)/);
  });
});
