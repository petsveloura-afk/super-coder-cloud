import { describe, expect, it } from "vitest";
import { safeDraft } from "@/lib/site/live-draft";

describe("wave 34 — a half-filled draft never blanks the preview", () => {
  it("adds missing items / data and drops garbage sections", () => {
    const out = safeDraft({ blocks: [{ type: "features", data: { title: "x" } }, { type: "hero" }, null, 5, { nope: 1 }, { type: "text", data: { body: "b" } }] }) as { blocks: { type: string; data: Record<string, unknown> }[] };
    expect(out.blocks.map((b) => b.type)).toEqual(["features", "hero", "text"]);
    expect(out.blocks[0]!.data.items).toEqual([]);
    expect(out.blocks[1]!.data).toEqual({});
    expect(out.blocks[2]!.data.items).toBeUndefined();
  });
  it("keeps existing items and other fields untouched, never mutates the input", () => {
    const input = { name: "n", blocks: [{ type: "faq", data: { title: "t", items: [{ q: "a", a: "b" }] } }] };
    const copy = JSON.stringify(input);
    const out = safeDraft(input);
    expect(out.name).toBe("n");
    expect((out.blocks[0] as { data: { items: unknown[] } }).data.items).toHaveLength(1);
    expect(JSON.stringify(input)).toBe(copy);
  });
  it("copes with a missing block list", () => {
    expect(safeDraft({ blocks: undefined as unknown as unknown[] }).blocks).toEqual([]);
  });
});
