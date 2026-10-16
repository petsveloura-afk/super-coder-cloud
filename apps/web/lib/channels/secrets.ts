import "server-only";
import { decryptSecret, encryptSecret } from "@scc/shared/crypto";

/** Channel credentials are stored as one AES-256-GCM ciphertext (ENCRYPTION_KEY). */
export function encryptionReady(): boolean {
  return /^[A-Fa-f0-9]{64}$/.test(process.env.ENCRYPTION_KEY ?? "");
}

export function sealSecrets(values: Record<string, string>): string {
  if (!encryptionReady()) throw new Error("encryption_key_missing");
  return encryptSecret(JSON.stringify(values), process.env.ENCRYPTION_KEY!);
}

export function openSecrets(payload: string | null | undefined): Record<string, string> {
  if (!payload) return {};
  if (!encryptionReady()) throw new Error("encryption_key_missing");
  return JSON.parse(decryptSecret(payload, process.env.ENCRYPTION_KEY!)) as Record<string, string>;
}

/** E.164 for messaging APIs. Local Israeli numbers (05X…) get +972 by default. */
export function toE164(phone: string | null | undefined, defaultCountry = "972"): string | null {
  if (!phone) return null;
  let p = phone.replace(/[^\d+]/g, "");
  if (p.startsWith("00")) p = `+${p.slice(2)}`;
  if (p.startsWith("+")) return /^\+\d{7,15}$/.test(p) ? p : null;
  if (p.startsWith("0")) p = `+${defaultCountry}${p.slice(1)}`;
  else p = `+${p}`;
  return /^\+\d{7,15}$/.test(p) ? p : null;
}
