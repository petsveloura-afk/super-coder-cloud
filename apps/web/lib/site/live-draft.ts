/**
 * Wave 34 — pure helpers of the live preview (no React, unit-tested).
 * A half-filled section (missing items / data) must never blank the whole preview.
 */
const ITEM_TYPES = new Set(["features", "faq", "gallery", "testimonials", "stats", "pricing", "steps", "team", "logos"]);

export function safeDraft<T extends { blocks: unknown[] }>(site: T): T {
  const blocks = (Array.isArray(site.blocks) ? site.blocks : [])
    .filter((b): b is { type: string; data?: unknown } => !!b && typeof b === "object" && typeof (b as { type?: unknown }).type === "string")
    .map((b) => {
      const data: Record<string, unknown> = b.data && typeof b.data === "object" ? { ...(b.data as Record<string, unknown>) } : {};
      if (ITEM_TYPES.has(b.type) && !Array.isArray(data.items)) data.items = [];
      return { ...b, data };
    });
  return { ...site, blocks } as unknown as T;
}
