import { describe, expect, it } from "vitest";
import { restoreKept } from "@/lib/ai/site-edit-rules";

const B = (type: string, data: Record<string, unknown>) => ({ type, data });

describe("wave 34 — the agent never wipes contact details or images by forgetting them", () => {
  it("restores an emptied phone / e-mail and a dropped hero image", () => {
    const prev = [B("hero", { title: "a", image_url: "https://x.co/i.jpg" }), B("contact", { phone: "050-1", email: "a@b.co", whatsapp: "", address: "TLV" })];
    const next = [B("hero", { title: "b", image_url: "" }), B("contact", { phone: "", email: "", whatsapp: "", address: "TLV" })];
    expect(restoreKept(prev, next, "make it more modern")).toBe(3);
    expect(next[0]!.data.image_url).toBe("https://x.co/i.jpg");
    expect(next[1]!.data).toMatchObject({ phone: "050-1", email: "a@b.co", whatsapp: "", address: "TLV" });
  });
  it("matches by type, so a section inserted before does not shift the match", () => {
    const prev = [B("hero", { image_url: "https://x.co/h.jpg" }), B("about", { image_url: "https://x.co/a.jpg", body: "x" })];
    const next = [B("hero", { image_url: "https://x.co/h.jpg" }), B("features", { items: [] }), B("about", { image_url: "", body: "y" })];
    restoreKept(prev, next);
    expect(next[2]!.data.image_url).toBe("https://x.co/a.jpg");
  });
  it("respects an explicit request to remove something", () => {
    for (const instruction of ["remove the phone number", "תסיר את הטלפון", "احذف الهاتف"]) {
      const prev = [B("contact", { phone: "050-1" })];
      const next = [B("contact", { phone: "" })];
      expect(restoreKept(prev, next, instruction)).toBe(0);
      expect(next[0]!.data.phone).toBe("");
    }
  });
  it("never overwrites something the agent really changed, and ignores new sections", () => {
    const prev = [B("contact", { phone: "050-1" })];
    const next = [B("contact", { phone: "052-2" }), B("contact", { phone: "" })];
    expect(restoreKept(prev, next)).toBe(0);
    expect(next[0]!.data.phone).toBe("052-2");
    expect(next[1]!.data.phone).toBe("");
  });
});
