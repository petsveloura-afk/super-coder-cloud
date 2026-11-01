/**
 * Mission Control (pure, unit-tested): turns raw facts about one business into status cards —
 * 🟢 ok · 🟡 attention · 🔴 failing · ⚪ not connected — each with a plain-language reason (i18n key) and the
 * screen that fixes it. No secrets ever enter these objects.
 */
export type OpsLevel = "ok" | "warn" | "error" | "off";

export interface OpsItem {
  key: string;
  level: OpsLevel;
  reason: string;
  params?: Record<string, string | number>;
  fix?: string;
}

export interface OpsFacts {
  email: { provider: boolean; mailbox: "active" | "error" | "none"; failed7d: number };
  social: { facebook: boolean; instagram: boolean; failed7d: number; autopilotOn: boolean; autopilotError: string | null };
  payments: { platform: boolean };
  deliveries: { failed: number; dead: number; queuedLate: number };
  sites: { published: number; domainsPending: number };
  surveys: { enabled: boolean; answered30d: number; avg: number | null };
}

export function opsItems(f: OpsFacts): OpsItem[] {
  const items: OpsItem[] = [];
  // email: the business mailbox or the platform service must be able to send
  if (f.email.mailbox === "error") items.push({ key: "email", level: "error", reason: "ops.r.mailboxError", fix: "/integrations#channels" });
  else if (!f.email.provider && f.email.mailbox === "none") items.push({ key: "email", level: "off", reason: "ops.r.emailOff", fix: "/integrations#channels" });
  else if (f.email.failed7d > 0) items.push({ key: "email", level: "warn", reason: "ops.r.emailFailed", params: { n: f.email.failed7d }, fix: "/health#deliveries" });
  else items.push({ key: "email", level: "ok", reason: f.email.mailbox === "active" ? "ops.r.emailMailbox" : "ops.r.emailProvider" });

  // social publishing
  if (!f.social.facebook && !f.social.instagram) items.push({ key: "social", level: "off", reason: "ops.r.socialOff", fix: "/integrations#marketplace" });
  else if (f.social.autopilotError) items.push({ key: "social", level: "warn", reason: "ops.r.autopilotError", fix: "/social" });
  else if (f.social.failed7d > 0) items.push({ key: "social", level: "warn", reason: "ops.r.socialFailed", params: { n: f.social.failed7d }, fix: "/social" });
  else items.push({ key: "social", level: "ok", reason: f.social.autopilotOn ? "ops.r.socialAutopilot" : "ops.r.socialOk" });

  // payments
  items.push(f.payments.platform ? { key: "payments", level: "ok", reason: "ops.r.paymentsOk" } : { key: "payments", level: "off", reason: "ops.r.paymentsOff", fix: "/integrations" });

  // the delivery queue (outbox): failed / dead messages and a stuck queue
  if (f.deliveries.dead > 0) items.push({ key: "deliveries", level: "error", reason: "ops.r.dead", params: { n: f.deliveries.dead }, fix: "/health#deliveries" });
  else if (f.deliveries.queuedLate > 0) items.push({ key: "deliveries", level: "warn", reason: "ops.r.queueLate", params: { n: f.deliveries.queuedLate } });
  else if (f.deliveries.failed > 0) items.push({ key: "deliveries", level: "warn", reason: "ops.r.retrying", params: { n: f.deliveries.failed }, fix: "/health#deliveries" });
  else items.push({ key: "deliveries", level: "ok", reason: "ops.r.deliveriesOk" });

  // websites & domains
  if (f.sites.domainsPending > 0) items.push({ key: "sites", level: "warn", reason: "ops.r.domainPending", params: { n: f.sites.domainsPending }, fix: "/websites" });
  else if (f.sites.published > 0) items.push({ key: "sites", level: "ok", reason: "ops.r.sitesOk", params: { n: f.sites.published } });
  else items.push({ key: "sites", level: "off", reason: "ops.r.sitesOff", fix: "/websites" });

  // satisfaction surveys
  if (!f.surveys.enabled) items.push({ key: "surveys", level: "off", reason: "ops.r.surveysOff", fix: "/health#surveys" });
  else if (f.surveys.avg !== null && f.surveys.answered30d >= 3 && f.surveys.avg < 3) items.push({ key: "surveys", level: "warn", reason: "ops.r.surveysLow", params: { avg: f.surveys.avg } });
  else items.push({ key: "surveys", level: "ok", reason: "ops.r.surveysOk", params: { n: f.surveys.answered30d } });
  return items;
}

export function worst(levels: OpsLevel[]): OpsLevel {
  const order: OpsLevel[] = ["off", "ok", "warn", "error"];
  return levels.reduce<OpsLevel>((w, l) => (order.indexOf(l) > order.indexOf(w) ? l : w), "off");
}

/** Survey average on its own scale → 0..5 for one comparable number. */
export function surveyAverage(rows: { kind: string; score: number | null }[]): number | null {
  const vals = rows
    .filter((r) => typeof r.score === "number")
    .map((r) => (r.kind === "nps" ? (r.score! / 10) * 5 : r.kind === "ces" ? ((8 - r.score!) / 7) * 5 : r.score!));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

/** Net Promoter Score from 0-10 answers: %promoters (9-10) − %detractors (0-6). */
export function npsScore(scores: number[]): number | null {
  if (!scores.length) return null;
  const p = scores.filter((s) => s >= 9).length;
  const d = scores.filter((s) => s <= 6).length;
  return Math.round(((p - d) / scores.length) * 100);
}
