import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Wave 59 — the business's phone automation settings (defaults before the migration ran / never saved). */
export interface PhoneSettings {
  missed_text: boolean;
  missed_message: string | null;
  record_calls: boolean;
  reminder_calls: boolean;
  callback_calls: boolean;
}

export const PHONE_DEFAULTS: PhoneSettings = { missed_text: true, missed_message: null, record_calls: false, reminder_calls: false, callback_calls: false };

export async function loadPhoneSettings(orgId: string): Promise<PhoneSettings> {
  try {
    const { data, error } = await createAdminClient().from("phone_settings").select("missed_text, missed_message, record_calls, reminder_calls, callback_calls").eq("organization_id", orgId).maybeSingle();
    if (error || !data) return PHONE_DEFAULTS;
    return { ...PHONE_DEFAULTS, ...(data as Partial<PhoneSettings>) };
  } catch {
    return PHONE_DEFAULTS;
  }
}
