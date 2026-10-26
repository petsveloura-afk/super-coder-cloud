import { z } from "zod";
import { CONTACT_STATUSES } from "./validators";

/* ------------------------------------------------------------------ forms */
export const FORM_FIELD_TYPES = ["text", "email", "phone", "textarea", "select", "checkbox", "number", "date"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Keys with a special meaning: they fill the contact record. */
export const FORM_CONTACT_KEYS = ["name", "first_name", "last_name", "email", "phone", "company", "marketing_consent"] as const;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{2,60}$/, { message: "validation.slug" });

export const formFieldSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, { message: "forms.badKey" }),
  label: z.string().trim().min(1, { message: "validation.required" }).max(200, { message: "validation.tooLong" }),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(200).optional(),
  options: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  // wave 17: multi-step forms + conditional fields
  step: z.coerce.number().int().min(1).max(10).optional(),
  show_if: z
    .object({
      field: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, { message: "forms.badKey" }),
      op: z.enum(["eq", "neq", "not_empty"]).default("eq"),
      value: z.string().trim().max(100).optional().default(""),
    })
    .optional(),
});
export type FormField = z.infer<typeof formFieldSchema>;

/** Same rule as public.form_field_visible() in the database (a hidden field is neither required nor stored). */
export function isFormFieldVisible(field: Pick<FormField, "show_if">, data: Record<string, unknown>): boolean {
  const c = field.show_if;
  if (!c || !c.field) return true;
  const raw = data[c.field];
  const v = (typeof raw === "boolean" ? (raw ? "true" : "") : raw == null ? "" : String(raw)).trim();
  if (c.op === "not_empty") return v !== "";
  const eq = v.toLowerCase() === String(c.value ?? "").trim().toLowerCase();
  return c.op === "neq" ? !eq : eq;
}

/** The form's steps (1..n) in order; a form without steps is one step. */
export function formSteps(fields: Pick<FormField, "step">[]): number[] {
  return [...new Set(fields.map((f) => f.step ?? 1))].sort((a, b) => a - b);
}

export const formSchema = z
  .object({
    name: z.string().trim().min(1, { message: "validation.required" }).max(120, { message: "validation.tooLong" }),
    slug,
    status: z.enum(["active", "inactive"]).default("active"),
    fields: z.array(formFieldSchema).min(1, { message: "forms.needField" }).max(30, { message: "validation.tooMany" }),
    settings: z
      .object({
        title: z.string().trim().max(200).optional(),
        intro: z.string().trim().max(2000).optional(),
        submit_label: z.string().trim().max(60).optional(),
        success_message: z.string().trim().max(500).optional(),
        redirect_url: z
          .string()
          .trim()
          .max(2000)
          .regex(/^(https:\/\/\S+)?$/, { message: "validation.httpsUrl" })
          .optional(),
        tag: z.string().trim().max(40).optional(),
        notify: z.boolean().default(true),
      })
      .default({ notify: true }),
  })
  .refine((f) => new Set(f.fields.map((x) => x.key)).size === f.fields.length, { message: "forms.duplicateKey", path: ["fields"] })
  .refine((f) => f.fields.some((x) => x.key === "email" || x.key === "phone"), { message: "forms.needContactField", path: ["fields"] })
  .refine((f) => f.fields.every((x) => x.type !== "select" || (x.options?.length ?? 0) > 0), { message: "forms.selectNeedsOptions", path: ["fields"] })
  // wave 17: a condition must point to another field of the form
  .refine((f) => f.fields.every((x) => !x.show_if || (x.show_if.field !== x.key && f.fields.some((o) => o.key === x.show_if?.field))), { message: "forms.badCondition", path: ["fields"] });
export type FormInput = z.infer<typeof formSchema>;

/* ---------------------------------------------------------------- booking */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, { message: "validation.time" });
export const availabilitySchema = z.record(
  z.enum(["0", "1", "2", "3", "4", "5", "6"]),
  z.array(z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, { message: "booking.badWindow" })).max(6),
);

export const appointmentTypeSchema = z.object({
  name: z.string().trim().min(1, { message: "validation.required" }).max(120),
  slug,
  description: z.string().trim().max(2000).optional().default(""),
  duration_min: z.coerce.number().int().min(5).max(480),
  buffer_min: z.coerce.number().int().min(0).max(240).default(0),
  location: z.string().trim().max(300).optional().default(""),
  timezone: z.string().trim().min(1).max(64).default("Asia/Jerusalem"),
  availability: availabilitySchema,
  min_notice_hours: z.coerce.number().int().min(0).max(720).default(2),
  max_days_ahead: z.coerce.number().int().min(1).max(365).default(30),
  status: z.enum(["active", "inactive"]).default("active"),
});

/**
 * Bookable slot starts (ISO, UTC) for a booking page. Pure function shared by
 * the browser (slot picker) and tests; the database re-validates every booking.
 */
export function computeSlots(opts: {
  availability: Record<string, [string, string][]>;
  timezone: string;
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  busy: [string, string][];
  now?: Date;
  stepMin?: number;
}): string[] {
  const now = opts.now ?? new Date();
  const step = opts.stepMin ?? Math.min(30, opts.durationMin);
  const earliest = now.getTime() + opts.minNoticeHours * 3_600_000;
  const latest = now.getTime() + opts.maxDaysAhead * 86_400_000;
  const busy = opts.busy.map(([s, e]) => [Date.parse(s) - opts.bufferMin * 60_000, Date.parse(e) + opts.bufferMin * 60_000] as const);
  const out: string[] = [];
  for (let d = 0; d <= opts.maxDaysAhead; d++) {
    const day = new Date(now.getTime() + d * 86_400_000);
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: opts.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
    const dow = String(new Date(`${ymd}T12:00:00Z`).getUTCDay());
    for (const [from, to] of opts.availability[dow] ?? []) {
      const [fh, fm] = from.split(":").map(Number);
      const [th, tm] = to.split(":").map(Number);
      for (let m = fh! * 60 + fm!; m + opts.durationMin <= th! * 60 + tm!; m += step) {
        const start = zonedToUtc(ymd, m, opts.timezone);
        const end = start + opts.durationMin * 60_000;
        if (start < earliest || start > latest) continue;
        if (busy.some(([bs, be]) => start < be && end > bs)) continue;
        out.push(new Date(start).toISOString());
      }
    }
  }
  return Array.from(new Set(out)).sort();
}

/** Wall-clock minutes-of-day on a Y-M-D in a time zone → UTC epoch ms (DST-safe). */
export function zonedToUtc(ymd: string, minutes: number, timeZone: string): number {
  const [y, mo, da] = ymd.split("-").map(Number);
  const guess = Date.UTC(y!, mo! - 1, da!, Math.floor(minutes / 60), minutes % 60);
  const offset = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - t;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

/* -------------------------------------------------------------- campaigns */
export const CAMPAIGN_CHANNELS = ["email", "whatsapp", "sms", "telegram"] as const;

export const campaignSchema = z
  .object({
    name: z.string().trim().min(1, { message: "validation.required" }).max(120),
    channel: z.enum(CAMPAIGN_CHANNELS),
    subject: z.string().trim().max(200).optional().default(""),
    body: z.string().trim().min(1, { message: "validation.required" }).max(20000),
    audience: z
      .object({
        status: z.enum(CONTACT_STATUSES).optional(),
        source: z.string().trim().max(40).optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        // wave 17: smart audience (AI insights + activity + purchases)
        min_score: z.coerce.number().int().min(0).max(100).optional(),
        max_score: z.coerce.number().int().min(0).max(100).optional(),
        sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
        stage: z.enum(["new", "interested", "considering", "ready", "customer", "lost"]).optional(),
        active_days: z.coerce.number().int().min(1).max(3650).optional(),
        inactive_days: z.coerce.number().int().min(1).max(3650).optional(),
        purchases_min: z.coerce.number().min(0).max(999_999_999).optional(),
      })
      .default({}),
    // wave 17: approved WhatsApp template (official API) — variables may use {{contact.first_name}}
    wa_template: z
      .object({
        name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, { message: "campaigns.badTemplateName" }),
        language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, { message: "campaigns.badTemplateLang" }).default("he"),
        params: z.array(z.string().trim().max(500)).max(10).default([]),
      })
      .nullable()
      .optional(),
    scheduled_at: z
      .string()
      .optional()
      .refine((v) => !v || !Number.isNaN(Date.parse(v)), { message: "validation.date" }),
  })
  .refine((c) => c.channel !== "email" || (c.subject ?? "").length > 0, { message: "validation.required", path: ["subject"] })
  .refine((c) => c.channel !== "sms" || c.body.length <= 1600, { message: "validation.tooLong", path: ["body"] });

/* ================================================================ wave 4 */
const money = z.coerce.number({ message: "validation.number" }).min(0, { message: "validation.number" }).max(999_999_999, { message: "validation.tooLong" });
const pct = z.coerce.number({ message: "validation.number" }).min(0, { message: "validation.number" }).max(100, { message: "validation.number" });
const optUuid = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(z.uuid({ message: "validation.invalidId" }).optional());
const isoDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "validation.date" });

/* ----------------------------------------------------------------- support */
export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const ticketSchema = z.object({
  subject: z.string().trim().min(1, { message: "validation.required" }).max(200, { message: "validation.tooLong" }),
  body: z.string().trim().max(20000, { message: "validation.tooLong" }).optional().default(""),
  priority: z.enum(TICKET_PRIORITIES).default("normal"),
  contactId: optUuid,
  assigneeId: optUuid,
});

/* ----------------------------------------------------------------- finance */
export const documentLineSchema = z.object({
  description: z.string().trim().min(1, { message: "validation.required" }).max(500, { message: "validation.tooLong" }),
  quantity: z.coerce.number({ message: "validation.number" }).gt(0, { message: "validation.number" }).max(1_000_000),
  unit_price: money,
  discount_pct: pct.default(0),
  tax_rate: pct,
});

export const documentSchema = z.object({
  kind: z.enum(["quote", "invoice"]),
  title: z.string().trim().max(200).optional().default(""),
  contactId: optUuid,
  companyId: optUuid,
  dealId: optUuid,
  issue_date: isoDate,
  due_date: isoDate,
  currency: z.string().trim().length(3).toUpperCase().default("ILS"),
  notes: z.string().trim().max(4000).optional().default(""),
  payment_url: z
    .string()
    .trim()
    .max(2000)
    .regex(/^(https:\/\/\S+)?$/, { message: "validation.httpsUrl" })
    .optional()
    .default(""),
  lines: z.array(documentLineSchema).min(1, { message: "finance.needLine" }).max(100, { message: "validation.tooMany" }),
  // wave 15: a quote can be a contract — terms + the customer signs with a finger / mouse
  require_signature: z.boolean().optional().default(false),
  contract_terms: z.string().trim().max(20000, { message: "validation.tooLong" }).optional().default(""),
});
export type DocumentInput = z.infer<typeof documentSchema>;

/** Same math as the database triggers (used for live totals in the editor). */
export function documentTotals(lines: { quantity: number; unit_price: number; discount_pct?: number; tax_rate: number }[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  let subtotal = 0;
  let taxRaw = 0;
  for (const l of lines) {
    const net = r2((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * (1 - (Number(l.discount_pct) || 0) / 100));
    subtotal += net;
    taxRaw += (net * (Number(l.tax_rate) || 0)) / 100;
  }
  subtotal = r2(subtotal);
  const tax = r2(taxRaw);
  return { subtotal, tax, total: r2(subtotal + tax) };
}

export const PAYMENT_METHODS = ["transfer", "cash", "card", "check", "bit", "paybox", "other"] as const;
/** wave 15: methods recorded automatically by online payments (not offered in the manual form) */
export const ONLINE_PAYMENT_METHODS = ["stripe", "paypal"] as const;
export const paymentSchema = z.object({
  amount: z.coerce.number({ message: "validation.number" }).gt(0, { message: "validation.number" }).max(999_999_999),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(200).optional().default(""),
  paid_at: isoDate,
});

export const productSchema = z.object({
  name: z.string().trim().min(1, { message: "validation.required" }).max(160),
  description: z.string().trim().max(1000).optional().default(""),
  unit_price: money,
  tax_rate: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
    .pipe(z.number().min(0).max(100).optional()),
});

export const financeSettingsSchema = z.object({
  business_name: z.string().trim().max(160).optional().default(""),
  business_id: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  email: z
    .string()
    .trim()
    .max(254)
    .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), { message: "validation.email" })
    .optional()
    .default(""),
  default_tax_rate: pct.default(18),
  quote_valid_days: z.coerce.number().int().min(1).max(365).default(14),
  payment_terms_days: z.coerce.number().int().min(0).max(365).default(30),
  payment_instructions: z.string().trim().max(2000).optional().default(""),
  default_notes: z.string().trim().max(2000).optional().default(""),
  stripe_secret_key: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine((v) => v === "" || /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/.test(v), { message: "finance.badStripeKey" }),
  stripe_webhook_secret: z
    .string()
    .trim()
    .optional()
    .default("")
    .refine((v) => v === "" || /^whsec_[A-Za-z0-9]{10,}$/.test(v), { message: "finance.badWebhookSecret" }),
});

/* ---------------------------------------------------------------- websites */
export const SITE_BLOCK_TYPES = ["hero", "features", "text", "form", "booking", "cta", "faq", "contact", "about", "gallery", "testimonials", "stats", "pricing", "steps", "team", "logos", "video"] as const;
export type SiteBlockType = (typeof SITE_BLOCK_TYPES)[number];

const shortText = (max: number) => z.string().trim().max(max, { message: "validation.tooLong" }).optional().default("");
const httpsOrPath = z
  .string()
  .trim()
  .max(2000)
  .regex(/^(https:\/\/\S+|\/\S*|#\S*|mailto:\S+|tel:\S+)?$/, { message: "validation.httpsUrl" })
  .optional()
  .default("");

export const siteBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hero"), data: z.object({ title: shortText(160), subtitle: shortText(500), cta_label: shortText(60), cta_href: httpsOrPath, image_url: httpsOrPath }) }),
  z.object({ type: z.literal("features"), data: z.object({ title: shortText(160), items: z.array(z.object({ title: shortText(120), text: shortText(500) })).max(12).default([]) }) }),
  z.object({ type: z.literal("text"), data: z.object({ title: shortText(160), body: shortText(10000) }) }),
  z.object({ type: z.literal("form"), data: z.object({ title: shortText(160), form_slug: z.string().trim().regex(/^([a-z0-9][a-z0-9-]{2,60})?$/, { message: "validation.slug" }).default("") }) }),
  z.object({ type: z.literal("booking"), data: z.object({ title: shortText(160), text: shortText(500), label: shortText(60), booking_slug: z.string().trim().regex(/^([a-z0-9][a-z0-9-]{2,60})?$/, { message: "validation.slug" }).default("") }) }),
  z.object({ type: z.literal("cta"), data: z.object({ title: shortText(160), text: shortText(500), label: shortText(60), href: httpsOrPath }) }),
  z.object({ type: z.literal("faq"), data: z.object({ title: shortText(160), items: z.array(z.object({ q: shortText(300), a: shortText(2000) })).max(30).default([]) }) }),
  z.object({ type: z.literal("contact"), data: z.object({ title: shortText(160), phone: shortText(40), whatsapp: shortText(40), email: shortText(254), address: shortText(300) }) }),
  // wave 13 — richer sections
  z.object({ type: z.literal("about"), data: z.object({ title: shortText(160), body: shortText(5000), image_url: httpsOrPath }) }),
  z.object({ type: z.literal("gallery"), data: z.object({ title: shortText(160), items: z.array(z.object({ url: httpsOrPath, caption: shortText(200) })).max(24).default([]) }) }),
  z.object({ type: z.literal("testimonials"), data: z.object({ title: shortText(160), items: z.array(z.object({ name: shortText(80), role: shortText(80), quote: shortText(600), rating: z.string().trim().regex(/^[1-5]?$/).optional().default("5") })).max(12).default([]) }) }),
  z.object({ type: z.literal("stats"), data: z.object({ title: shortText(160), items: z.array(z.object({ value: shortText(20), label: shortText(80) })).max(8).default([]) }) }),
  z.object({ type: z.literal("pricing"), data: z.object({ title: shortText(160), items: z.array(z.object({ name: shortText(80), price: shortText(30), period: shortText(30), features: shortText(1200), highlight: z.string().trim().regex(/^(yes|)$/).optional().default(""), cta_label: shortText(40), cta_href: httpsOrPath })).max(6).default([]) }) }),
  z.object({ type: z.literal("steps"), data: z.object({ title: shortText(160), items: z.array(z.object({ title: shortText(120), text: shortText(400) })).max(8).default([]) }) }),
  z.object({ type: z.literal("team"), data: z.object({ title: shortText(160), items: z.array(z.object({ name: shortText(80), role: shortText(80), image_url: httpsOrPath })).max(16).default([]) }) }),
  z.object({ type: z.literal("logos"), data: z.object({ title: shortText(160), items: z.array(z.object({ name: shortText(60) })).max(20).default([]) }) }),
  z.object({ type: z.literal("video"), data: z.object({ title: shortText(160), url: z.string().trim().max(500).regex(/^(https:\/\/(www\.)?(youtube\.com|youtu\.be|player\.vimeo\.com|vimeo\.com)\/\S+)?$/, { message: "validation.httpsUrl" }).optional().default(""), text: shortText(500) }) }),
]);

/* wave 13 — design templates, site settings (business details for the footer and legal pages) */
export const SITE_FONTS = ["rubik", "heebo", "assistant", "frank", "inter", "playfair", "secular", "varela", "suez", "karantina", "noto-serif"] as const;
export const SITE_TEMPLATE_KEYS = ["classic", "minimal", "fresh", "aurora", "luxe", "bold", "corporate", "pastel", "neon", "nature", "editorial", "midnight", "sunset", "ocean", "clinic", "noir", "terracotta", "studio"] as const;
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "validation.color" });
export const siteSettingsSchema = z
  .object({
    legal_name: shortText(160),
    business_id: shortText(40),
    email: shortText(254),
    phone: shortText(40),
    address: shortText(300),
    instagram: httpsOrPath,
    facebook: httpsOrPath,
    tiktok: httpsOrPath,
    linkedin: httpsOrPath,
    a11y_contact: shortText(160),
    cookie_banner: z.boolean().optional().default(true),
    a11y_widget: z.boolean().optional().default(true),
    whatsapp_button: shortText(40),
    // site language (custom domains / subdomains render in it), logo and footer line
    lang: z.enum(["he", "en", "ar"]).optional(),
    logo_url: httpsOrPath,
    tagline: shortText(300),
    youtube: httpsOrPath,
    // wave 17: visitors from the EU — adds GDPR rights / lawful basis to the privacy & cookie pages
    gdpr: z.boolean().optional(),
  })
  .partial()
  .default({});
export const LEGAL_PAGES = ["privacy", "terms", "accessibility", "cookies"] as const;
export const sitePagesSchema = z
  .object({ privacy: shortText(20000), terms: shortText(20000), accessibility: shortText(20000), cookies: shortText(20000) })
  .partial()
  .default({});
export type SiteBlock = z.infer<typeof siteBlockSchema>;

export const siteSchema = z.object({
  name: z.string().trim().min(1, { message: "validation.required" }).max(120),
  slug,
  status: z.enum(["draft", "published"]).default("draft"),
  theme: z
    .object({
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "validation.color" }).default("#3366E6"),
      mode: z.enum(["dark", "light"]).default("dark"),
      // wave 13
      template: z.enum(SITE_TEMPLATE_KEYS).optional(),
      accent2: hexColor.optional(),
      font: z.enum(SITE_FONTS).optional(),
      radius: z.enum(["sharp", "soft", "round"]).optional(),
      animations: z.boolean().optional(),
    })
    .default({ accent: "#3366E6", mode: "dark" }),
  seo: z.object({ title: shortText(70), description: shortText(160) }).default({ title: "", description: "" }),
  blocks: z.array(siteBlockSchema).min(1, { message: "websites.needBlock" }).max(40, { message: "validation.tooMany" }),
  // wave 13 (optional — older clients keep working)
  settings: siteSettingsSchema.optional(),
  pages: sitePagesSchema.optional(),
});
