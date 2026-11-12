/**
 * Custom domains for published websites on Railway (additive). The platform moved from Vercel to Railway; the Vercel project
 * that used to receive the customers' domains is gone. When the app runs on Railway, a customer's own domain is added to the
 * app's Railway service through Railway's public API, and the DNS records the customer must set come from Railway itself
 * (a CNAME to the service + the "_railway-verify" TXT ownership record).
 *
 * Env:
 *   RAILWAY_API_TOKEN      an account / team token (railway.com → Account → Tokens) — sent as "Authorization: Bearer"
 *   RAILWAY_PROJECT_TOKEN  OR a project token (Project → Settings → Tokens) — sent as "Project-Access-Token"
 *   RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_ID — Railway injects these into every service by itself
 *   RAILWAY_API_BASE       tests only
 *
 * Buying new domains is a Vercel-registrar feature and stays Vercel-only; connecting a domain the business already owns
 * works on Railway with this module. Never throws raw API text to the user — domainErrorKey maps errors to friendly keys.
 */

export type Env = Record<string, string | undefined>;

export function railwayDomainsConfigured(env: Env = process.env): boolean {
  const token = (env.RAILWAY_API_TOKEN ?? env.RAILWAY_PROJECT_TOKEN ?? "").trim();
  return Boolean(token && (env.RAILWAY_PROJECT_ID ?? "").trim() && (env.RAILWAY_ENVIRONMENT_ID ?? "").trim() && (env.RAILWAY_SERVICE_ID ?? "").trim());
}

export class RailwayDomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface RailwayDnsRecord {
  type: string;
  name: string;
  value: string;
}

export interface RailwayDomainState {
  id: string | null;
  domain: string;
  verified: boolean;
  records: RailwayDnsRecord[];
}

type Fetch = typeof fetch;

const STATUS_FIELDS = "status { dnsRecords { hostlabel recordType requiredValue zone } verificationDnsHost verificationToken verified }";

async function gql<T>(query: string, variables: Record<string, unknown>, env: Env, f: Fetch): Promise<T> {
  const base = (env.RAILWAY_API_BASE || "https://backboard.railway.com/graphql/v2").replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if ((env.RAILWAY_API_TOKEN ?? "").trim()) headers.Authorization = `Bearer ${(env.RAILWAY_API_TOKEN ?? "").trim()}`;
  else headers["Project-Access-Token"] = (env.RAILWAY_PROJECT_TOKEN ?? "").trim();
  const res = await f(base, { method: "POST", headers, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(25_000), cache: "no-store" });
  const text = await res.text();
  let j: { data?: T; errors?: { message?: string; extensions?: { code?: string } }[] } = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {
    j = {};
  }
  if (!res.ok) throw new RailwayDomainError(res.status, `http_${res.status}`, `railway ${res.status}`);
  if (j.errors?.length) {
    const msg = String(j.errors[0]?.message ?? "railway error");
    const code = String(j.errors[0]?.extensions?.code ?? (/not authorized|unauthorized|forbidden/i.test(msg) ? "auth" : /already|exists|in use|taken/i.test(msg) ? "in_use" : /invalid|not a valid/i.test(msg) ? "invalid" : "error"));
    throw new RailwayDomainError(code === "auth" ? 403 : code === "in_use" ? 409 : code === "invalid" ? 400 : 502, code, msg.slice(0, 200));
  }
  return (j.data ?? {}) as T;
}

/** Railway's record type enum ("DNS_RECORD_TYPE_CNAME") → "CNAME" */
export function recordType(t: string | null | undefined): string {
  return String(t ?? "")
    .replace(/^DNS_RECORD_TYPE_/i, "")
    .toUpperCase() || "CNAME";
}

interface RawStatus {
  dnsRecords?: { hostlabel?: string | null; recordType?: string | null; requiredValue?: string | null; zone?: string | null }[] | null;
  verificationDnsHost?: string | null;
  verificationToken?: string | null;
  verified?: boolean | null;
}

/** the records the customer must set: the CNAME(s) Railway asks for + the "_railway-verify" TXT ownership record */
export function recordsFromStatus(domain: string, st: RawStatus | null | undefined): RailwayDnsRecord[] {
  const out: RailwayDnsRecord[] = [];
  for (const r of st?.dnsRecords ?? []) {
    if (!r?.requiredValue) continue;
    out.push({ type: recordType(r.recordType), name: (r.hostlabel ?? "").trim() || "@", value: r.requiredValue });
  }
  const host = (st?.verificationDnsHost ?? "").trim();
  const token = (st?.verificationToken ?? "").trim();
  if (host && token) {
    // the TXT name relative to the customer's zone ("_railway-verify.app" for app.example.com), and the value always starts with
    // "railway-verify=" (a value without it is exactly the mistake that keeps a domain "waiting for DNS")
    const zoneSuffix = domain.split(".").slice(-2).join(".");
    const name = host.endsWith(`.${zoneSuffix}`) ? host.slice(0, -(zoneSuffix.length + 1)) : host;
    out.push({ type: "TXT", name, value: token.startsWith("railway-verify=") ? token : `railway-verify=${token}` });
  }
  if (!out.length) out.push({ type: "CNAME", name: domain.split(".").length > 2 ? domain.split(".")[0]! : "@", value: "(see Railway → Settings → Networking)" });
  return out;
}

function ids(env: Env) {
  return { projectId: (env.RAILWAY_PROJECT_ID ?? "").trim(), environmentId: (env.RAILWAY_ENVIRONMENT_ID ?? "").trim(), serviceId: (env.RAILWAY_SERVICE_ID ?? "").trim() };
}

async function findDomain(domain: string, env: Env, f: Fetch): Promise<(RailwayDomainState & { raw: RawStatus | null }) | null> {
  const q = `query($projectId: String!, $environmentId: String!, $serviceId: String!) { domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) { customDomains { id domain ${STATUS_FIELDS} } } }`;
  const d = await gql<{ domains?: { customDomains?: { id: string; domain: string; status?: RawStatus | null }[] } }>(q, ids(env), env, f);
  const hit = (d.domains?.customDomains ?? []).find((c) => c.domain.toLowerCase() === domain.toLowerCase());
  if (!hit) return null;
  return { id: hit.id, domain: hit.domain, verified: Boolean(hit.status?.verified), records: recordsFromStatus(domain, hit.status), raw: hit.status ?? null };
}

/** adds the domain to the app's Railway service (a second call for the same domain just reads it) */
export async function railwayAttach(domain: string, env: Env = process.env, f: Fetch = fetch): Promise<RailwayDomainState> {
  const existing = await findDomain(domain, env, f).catch(() => null);
  if (existing) return existing;
  const m = `mutation($input: CustomDomainCreateInput!) { customDomainCreate(input: $input) { id domain ${STATUS_FIELDS} } }`;
  const d = await gql<{ customDomainCreate?: { id: string; domain: string; status?: RawStatus | null } }>(m, { input: { domain, ...ids(env) } }, env, f);
  const c = d.customDomainCreate;
  return { id: c?.id ?? null, domain, verified: Boolean(c?.status?.verified), records: recordsFromStatus(domain, c?.status) };
}

export async function railwayState(domain: string, env: Env = process.env, f: Fetch = fetch): Promise<RailwayDomainState> {
  const s = await findDomain(domain, env, f);
  return s ?? { id: null, domain, verified: false, records: [] };
}

export async function railwayDetach(domain: string, env: Env = process.env, f: Fetch = fetch): Promise<void> {
  const s = await findDomain(domain, env, f).catch(() => null);
  if (!s?.id) return;
  await gql(`mutation($id: String!) { customDomainDelete(id: $id) }`, { id: s.id }, env, f);
}
