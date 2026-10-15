import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server-only crypto helpers.
 *  - AES-256-GCM envelope for integration credentials (stored as text "v1:iv:tag:ciphertext").
 *  - SHA-256 hashing for API keys (only the hash is stored; key shown once).
 *  - Constant-time HMAC verification for inbound webhooks.
 */

function key(hex: string): Buffer {
  if (!/^[A-Fa-f0-9]{64}$/.test(hex)) throw new Error("ENCRYPTION_KEY must be 64 hex chars");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string, encryptionKeyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(encryptionKeyHex), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string, encryptionKeyHex: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("Unsupported secret payload");
  const decipher = createDecipheriv("aes-256-gcm", key(encryptionKeyHex), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  const keyValue = `scc_live_${raw}`;
  return { key: keyValue, prefix: keyValue.slice(0, 16), hash: hashApiKey(keyValue) };
}

export function hashApiKey(keyValue: string): string {
  return createHash("sha256").update(keyValue).digest("hex");
}

export function verifyHmacSignature(body: string, signatureHex: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signatureHex.replace(/^sha256=/, ""), "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
