import "server-only";
import { contactSchema, fieldErrors } from "@scc/shared/validators";

/** Public API field names are snake_case; validated with the same schema as the UI. */
export const CONTACT_PUBLIC_FIELDS = "id, first_name, last_name, email, phone, company_name, job_title, status, source, marketing_consent, owner_id, created_at, updated_at";

const EDITABLE = ["first_name", "last_name", "email", "phone", "company_name", "job_title", "status", "source", "marketing_consent"] as const;

/** Merge a PATCH body over the stored record (only known fields). */
export function mergeContact(existing: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) out[k] = patch[k] !== undefined ? patch[k] : existing[k];
  return out;
}

export function parseContactBody(body: Record<string, unknown>) {
  const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : body[k] == null ? undefined : String(body[k]));
  const parsed = contactSchema.safeParse({
    firstName: s("first_name") ?? "",
    lastName: s("last_name"),
    email: s("email"),
    phone: s("phone"),
    companyName: s("company_name"),
    jobTitle: s("job_title"),
    status: s("status"),
    source: s("source") ?? "api",
    marketingConsent: body.marketing_consent === true || body.marketing_consent === "true",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  return {
    row: {
      first_name: v.firstName,
      last_name: v.lastName,
      email: v.email || null,
      phone: v.phone || null,
      company_name: v.companyName || null,
      job_title: v.jobTitle || null,
      status: v.status,
      source: v.source,
      marketing_consent: v.marketingConsent,
    },
  };
}
