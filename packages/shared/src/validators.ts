import { z } from "zod";

/**
 * Validation schemas shared by server actions, API routes and tests.
 * Error messages are i18n KEYS (resolved against the locale dictionary
 * on the client), never hard-coded human text.
 */

const trimmed = (max: number) => z.string().trim().max(max, { message: "validation.tooLong" });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, { message: "validation.tooShort" })
  .max(48, { message: "validation.tooLong" })
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, { message: "validation.slug" });

export const createOrganizationSchema = z.object({
  name: trimmed(120).min(2, { message: "validation.tooShort" }),
  slug: slugSchema,
  locale: z.enum(["he", "ar", "en"]).default("he"),
  timezone: z.string().trim().min(1).max(64).default("Asia/Jerusalem"),
  currency: z.string().trim().length(3).toUpperCase().default("ILS"),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Accepts international formats; normalises to digits with optional leading + */
export const phoneSchema = z
  .string()
  .trim()
  .max(32, { message: "validation.tooLong" })
  .transform((v) => v.replace(/[\s\-().]/g, ""))
  .refine((v) => v === "" || /^\+?[0-9]{7,15}$/.test(v), { message: "validation.phone" });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, { message: "validation.tooLong" })
  .refine((v) => v === "" || z.email().safeParse(v).success, { message: "validation.email" });

export const LEAD_SOURCES = [
  "manual",
  "website",
  "form",
  "import",
  "whatsapp",
  "telegram",
  "facebook",
  "instagram",
  "google",
  "referral",
  "other",
  // v4: records created by integrations
  "webhook",
  "api",
  "sms",
] as const;

export const CONTACT_STATUSES = ["lead", "qualified", "customer", "inactive"] as const;

export const contactSchema = z
  .object({
    firstName: trimmed(80).min(1, { message: "validation.required" }),
    lastName: trimmed(80).optional().default(""),
    email: emailSchema.optional().default(""),
    phone: phoneSchema.optional().default(""),
    companyName: trimmed(160).optional().default(""),
    jobTitle: trimmed(120).optional().default(""),
    status: z.enum(CONTACT_STATUSES).default("lead"),
    source: z.enum(LEAD_SOURCES).default("manual"),
    notes: trimmed(5000).optional().default(""),
    marketingConsent: z.boolean().default(false),
  })
  .refine((c) => c.email !== "" || c.phone !== "", {
    message: "validation.emailOrPhone",
    path: ["email"],
  });
export type ContactInput = z.infer<typeof contactSchema>;

export const uuidSchema = z.uuid({ message: "validation.invalidId" });

export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  status: z.enum(CONTACT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const signUpSchema = z.object({
  fullName: trimmed(120).min(2, { message: "validation.tooShort" }),
  email: z.email({ message: "validation.email" }).trim().toLowerCase(),
  password: z
    .string()
    .min(10, { message: "validation.passwordLength" })
    .max(128, { message: "validation.tooLong" })
    .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), { message: "validation.passwordStrength" }),
});

export const signInSchema = z.object({
  email: z.email({ message: "validation.email" }).trim().toLowerCase(),
  password: z.string().min(1, { message: "validation.required" }).max(128),
});

export const emailOnlySchema = z.object({
  email: z.email({ message: "validation.email" }).trim().toLowerCase(),
});

export const newPasswordSchema = signUpSchema.pick({ password: true });

/** Flatten a zod error into { field: i18nKey } for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/* ===================================================================== v4 */
/* Wave 1 — CRM suite: companies, deals/pipelines, tasks, CSV import, tags */

const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.uuid({ message: "validation.invalidId" }).optional());

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), { message: "validation.date" });

export const companySchema = z.object({
  name: trimmed(160).min(1, { message: "validation.required" }),
  domain: trimmed(253)
    .optional()
    .default("")
    .transform((v) => v.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase())
    .refine((v) => v === "" || /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v), { message: "validation.domain" }),
  industry: trimmed(120).optional().default(""),
  phone: phoneSchema.optional().default(""),
});
export type CompanyInput = z.infer<typeof companySchema>;

export const DEAL_STATUSES = ["open", "won", "lost"] as const;
export const CURRENCIES = ["ILS", "USD", "EUR", "GBP", "AED", "SAR", "JOD", "EGP"] as const;

export const dealSchema = z.object({
  title: trimmed(160).min(1, { message: "validation.required" }),
  value: z.coerce.number({ message: "validation.number" }).min(0, { message: "validation.number" }).max(999_999_999_999, { message: "validation.tooLong" }).default(0),
  currency: z.enum(CURRENCIES).default("ILS"),
  pipelineId: z.uuid({ message: "validation.invalidId" }),
  stageId: z.uuid({ message: "validation.invalidId" }),
  contactId: optionalUuid,
  companyId: optionalUuid,
  expectedCloseDate: optionalDate,
  ownerId: optionalUuid,
});
export type DealInput = z.infer<typeof dealSchema>;

export const pipelineSchema = z.object({
  name: trimmed(80).min(1, { message: "validation.required" }),
});

export const stageSchema = z.object({
  name: trimmed(80).min(1, { message: "validation.required" }),
  probability: z.coerce.number().int().min(0, { message: "validation.number" }).max(100, { message: "validation.number" }).default(0),
});

export const TASK_STATUSES = ["open", "in_progress", "done", "canceled"] as const;

export const taskSchema = z.object({
  title: trimmed(200).min(1, { message: "validation.required" }),
  description: trimmed(5000).optional().default(""),
  status: z.enum(TASK_STATUSES).default("open"),
  dueAt: optionalDate,
  assigneeId: optionalUuid,
  contactId: optionalUuid,
  dealId: optionalUuid,
});
export type TaskInput = z.infer<typeof taskSchema>;

export const tagNamesSchema = z
  .array(z.string().trim().min(1).max(40, { message: "validation.tooLong" }))
  .max(30, { message: "validation.tooMany" });

/** Header aliases (he/ar/en) → canonical import column. */
export const IMPORT_COLUMNS = ["first_name", "last_name", "email", "phone", "company_name", "job_title", "status", "source", "marketing_consent"] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  first_name: ["first_name", "firstname", "first name", "given name", "name", "full name", "שם", "שם פרטי", "שם מלא", "الاسم", "الاسم الأول"],
  last_name: ["last_name", "lastname", "last name", "surname", "family name", "שם משפחה", "اسم العائلة"],
  email: ["email", "e-mail", "mail", "email address", "אימייל", "מייל", "דואר אלקטרוני", "البريد", "البريد الإلكتروني"],
  phone: ["phone", "mobile", "phone number", "tel", "telephone", "cell", "טלפון", "נייד", "מספר טלפון", "الهاتف", "الجوال", "رقم الهاتف"],
  company_name: ["company", "company_name", "company name", "organization", "חברה", "שם חברה", "ארגון", "الشركة"],
  job_title: ["job_title", "title", "job title", "position", "role", "תפקיד", "المسمى الوظيفي", "الوظيفة"],
  status: ["status", "סטטוס", "الحالة"],
  source: ["source", "lead source", "מקור", "المصدر"],
  marketing_consent: ["marketing_consent", "consent", "opt in", "opt-in", "הסכמה", "הסכמה לדיוור", "الموافقة"],
};

export function mapImportHeader(header: string): ImportColumn | null {
  const h = header.trim().toLowerCase().replace(/^﻿/, "").replace(/[_\s]+/g, " ");
  for (const col of IMPORT_COLUMNS) {
    if (HEADER_ALIASES[col].some((a) => a.replace(/[_\s]+/g, " ") === h)) return col;
  }
  return null;
}

/**
 * RFC-4180 CSV parser (quotes, escaped quotes, CRLF, BOM, `,` `;` or tab
 * delimiter auto-detected from the header line). Returns rows of strings.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length }));
  const delim = counts.sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const TRUTHY = new Set(["1", "true", "yes", "y", "כן", "نعم", "v", "x", "✓"]);
const STATUS_ALIASES: Record<string, (typeof CONTACT_STATUSES)[number]> = {
  lead: "lead", ליד: "lead", "عميل محتمل": "lead",
  qualified: "qualified", מוסמך: "qualified", مؤهل: "qualified",
  customer: "customer", לקוח: "customer", عميل: "customer",
  inactive: "inactive", "לא פעיל": "inactive", "غير نشط": "inactive",
};

/** Turns parsed CSV rows into import records; unknown columns are ignored. */
export function csvToImportRows(rows: string[][]): { columns: (ImportColumn | null)[]; records: Partial<Record<ImportColumn, string | boolean>>[] } {
  const [header = [], ...body] = rows;
  const columns = header.map(mapImportHeader);
  const fullNameOnly = columns.includes("first_name") && !columns.includes("last_name");
  const records = body.map((cells) => {
    const rec: Partial<Record<ImportColumn, string | boolean>> = {};
    columns.forEach((col, i) => {
      if (!col) return;
      const v = (cells[i] ?? "").trim();
      if (col === "marketing_consent") rec[col] = TRUTHY.has(v.toLowerCase());
      else if (col === "status") rec[col] = STATUS_ALIASES[v.toLowerCase()] ?? (v ? v.toLowerCase() : "");
      else rec[col] = v;
    });
    if (fullNameOnly && typeof rec.first_name === "string" && rec.first_name.includes(" ")) {
      const [first, ...rest] = rec.first_name.split(/\s+/);
      rec.first_name = first!;
      rec.last_name = rest.join(" ");
    }
    if (typeof rec.source === "string" && !(LEAD_SOURCES as readonly string[]).includes(rec.source)) rec.source = "import";
    return rec;
  });
  return { columns, records };
}
