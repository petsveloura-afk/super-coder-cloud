import type { TFunction } from "@/lib/i18n/translate";

/**
 * Default records created by the database (pipeline "Sales", stages "New",
 * "Qualified"…) are stored in English; show them translated. Names the user
 * typed are shown exactly as written.
 */
export function stageLabel(t: TFunction, name: string): string {
  const key = `deals.defaultStages.${name}`;
  const v = t(key);
  return v === key ? name : v;
}

export function pipelineLabel(t: TFunction, name: string): string {
  const key = `deals.defaultPipelines.${name}`;
  const v = t(key);
  return v === key ? name : v;
}

/** Automation trigger label ("contact.created" → automations.triggers.contact_created). */
export function triggerLabel(t: TFunction, trigger: string): string {
  return t(`automations.triggers.${trigger.replace(/\./g, "_")}`);
}
