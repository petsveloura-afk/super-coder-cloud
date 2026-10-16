import { z } from "zod";

/**
 * Environment contract. Server-only secrets must never be prefixed with
 * NEXT_PUBLIC_. Optional provider credentials simply disable the
 * corresponding integration (see `integrationAvailability`).
 */

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export const serverEnvSchema = publicEnvSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: optional,
  DATABASE_URL: optional,
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Fa-f0-9]{64}$/, "ENCRYPTION_KEY must be 32 bytes hex (64 chars)")
    .optional(),
  CRON_SECRET: optional,
  DEMO_MODE: z.enum(["true", "false"]).optional().default("false"),
  OPENAI_API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  GEMINI_API_KEY: optional,
  TELEGRAM_BOT_TOKEN: optional,
  META_APP_ID: optional,
  META_APP_SECRET: optional,
  WHATSAPP_ACCESS_TOKEN: optional,
  WHATSAPP_PHONE_NUMBER_ID: optional,
  EMAIL_PROVIDER_API_KEY: optional,
  EMAIL_FROM_ADDRESS: optional,
  SMS_PROVIDER_API_KEY: optional,
  PAYMENT_PROVIDER_SECRET_KEY: optional,
  PAYMENT_WEBHOOK_SECRET: optional,
  QUEUE_PROVIDER_URL: optional,
  QUEUE_PROVIDER_TOKEN: optional,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Fails if any NEXT_PUBLIC_ variable looks like it holds a secret. */
export function findLeakedSecrets(env: Record<string, string | undefined>): string[] {
  const suspicious = /(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|TOKEN|API_KEY)/i;
  return Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && suspicious.test(k));
}

export type IntegrationKey = "openai" | "anthropic" | "gemini" | "telegram" | "whatsapp" | "email" | "sms" | "payments" | "queue";

export function integrationAvailability(env: Partial<Record<keyof ServerEnv, string | undefined>> | Record<string, string | undefined>): Record<IntegrationKey, boolean> {
  const e = env as Partial<Record<keyof ServerEnv, string | undefined>>;
  return {
    openai: Boolean(e.OPENAI_API_KEY),
    anthropic: Boolean(e.ANTHROPIC_API_KEY),
    gemini: Boolean(e.GEMINI_API_KEY),
    telegram: Boolean(e.TELEGRAM_BOT_TOKEN),
    whatsapp: Boolean(e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID),
    email: Boolean(e.EMAIL_PROVIDER_API_KEY && e.EMAIL_FROM_ADDRESS),
    sms: Boolean(e.SMS_PROVIDER_API_KEY),
    payments: Boolean(e.PAYMENT_PROVIDER_SECRET_KEY && e.PAYMENT_WEBHOOK_SECRET),
    queue: Boolean(e.QUEUE_PROVIDER_URL && e.QUEUE_PROVIDER_TOKEN),
  };
}
