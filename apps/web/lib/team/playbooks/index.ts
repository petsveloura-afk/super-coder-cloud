import type { RoleKey } from "../roles";
import type { Playbook, PlaybookText } from "./types";
import manager from "./manager";
import team_lead from "./team_lead";
import customer_service from "./customer_service";
import sales from "./sales";
import marketing from "./marketing";
import content_writer from "./content_writer";
import web_builder from "./web_builder";
import analyst from "./analyst";
import project_coordinator from "./project_coordinator";
import quality_control from "./quality_control";
import collections from "./collections";
import reputation from "./reputation";
import custom from "./custom";

/** Every role's playbook (data files). Improve a role by editing its file — the engine reads them dynamically. */
export const PLAYBOOKS: Record<RoleKey, Playbook> = { manager, team_lead, customer_service, sales, marketing, content_writer, web_builder, analyst, project_coordinator, quality_control, collections, reputation, custom };

export function playbookText(role: RoleKey, lang: string): PlaybookText {
  const p = PLAYBOOKS[role] ?? PLAYBOOKS.custom;
  return lang === "en" || lang === "ar" ? p.en : p.he;
}

/**
 * The playbook as instructions for the model (English is used for the model, the business's language for the output).
 * The business's own additions come after the base and win on conflict — but never over the "forbidden" list.
 */
export function playbookPrompt(role: RoleKey, extra?: string | null): string {
  const p = (PLAYBOOKS[role] ?? PLAYBOOKS.custom).en;
  const list = (title: string, xs: string[]) => (xs.length ? `${title}:\n${xs.map((x, i) => `  ${i + 1}. ${x}`).join("\n")}` : "");
  return [
    `ROLE PLAYBOOK — ${role}`,
    `Mission: ${p.mission}`,
    list("Success measures (KPIs) — measure yourself against them", p.kpis),
    list("Standard operating procedure", p.sop),
    list("Professional standards", p.standards),
    list("Output templates", p.templates),
    list("NEVER (hard rules, override everything else)", p.forbidden),
    list("Quality checklist before you hand anything over", p.checklist),
    `Example of GOOD work: ${p.good}`,
    `Example of BAD work (never like this): ${p.bad}`,
    list("Escalate to a human when", p.escalation),
    extra && extra.trim() ? `The business's own additions to this playbook (follow them; they never cancel the NEVER list):\n${extra.trim().slice(0, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export type { Playbook, PlaybookText };
