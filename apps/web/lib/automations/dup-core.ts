/**
 * Round 12 — duplicate automations (pure, unit-tested). Two automations with the same trigger, the same trigger settings,
 * the same conditions and the same steps do the same work twice (two leads, two tasks, two messages for one event).
 * The list shows them; turning one off is the owner's choice — nothing is changed automatically.
 */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== "")
      .sort()
      .map((k) => `${k}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function automationFingerprint(a: { trigger_type: string; trigger_config?: unknown; conditions?: unknown; actions?: unknown }): string {
  return `${a.trigger_type}|${stable(a.trigger_config ?? {})}|${stable(a.conditions ?? [])}|${stable(a.actions ?? [])}`;
}

/** id → how many automations (including itself) share its fingerprint; only ids with 2+ are returned */
export function duplicateGroups(list: { id: string; trigger_type: string; trigger_config?: unknown; conditions?: unknown; actions?: unknown }[]): Map<string, number> {
  const by = new Map<string, string[]>();
  for (const a of list) {
    const f = automationFingerprint(a);
    by.set(f, [...(by.get(f) ?? []), a.id]);
  }
  const out = new Map<string, number>();
  for (const ids of by.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.length);
  return out;
}
