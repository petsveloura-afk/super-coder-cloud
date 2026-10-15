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
