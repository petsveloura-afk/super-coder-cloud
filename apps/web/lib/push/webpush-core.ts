import { createCipheriv, createECDH, createPrivateKey, createSign, hkdfSync, randomBytes } from "node:crypto";

/**
 * Wave 17 — Web Push without third-party packages (pure, unit-tested):
 *   VAPID (RFC 8292) — ES256 JWT signed with the server key
 *   message encryption "aes128gcm" (RFC 8291 / RFC 8188)
 * Keys: VAPID_PUBLIC_KEY (base64url, 65-byte uncompressed P-256 point) and
 * VAPID_PRIVATE_KEY (base64url, 32 bytes) — generate with scripts/setup/generate-vapid.mjs.
 */
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export function vapidReady(env: Record<string, string | undefined> = process.env): boolean {
  try {
    return fromB64u(env.VAPID_PUBLIC_KEY ?? "").length === 65 && fromB64u(env.VAPID_PRIVATE_KEY ?? "").length === 32;
  } catch {
    return false;
  }
}

export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const d = ecdh.getPrivateKey();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(Buffer.concat([Buffer.alloc(Math.max(0, 32 - d.length)), d])) };
}

/** Authorization header value for the push service of `endpoint`. */
export function vapidAuthHeader(endpoint: string, keys: { publicKey: string; privateKey: string; subject: string }, now = Date.now()): string {
  const pub = fromB64u(keys.publicKey);
  const priv = fromB64u(keys.privateKey);
  if (pub.length !== 65 || priv.length !== 32) throw new Error("vapid_keys_invalid");
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: b64u(priv) }, format: "jwk" });
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const sig = signer.sign({ key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** RFC 8291 encryption of one push message (single record). */
export function encryptPayload(sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">, payload: Buffer, opts: { salt?: Buffer; serverKeys?: ReturnType<typeof createECDH> } = {}): Buffer {
  const uaPublic = fromB64u(sub.p256dh);
  const authSecret = fromB64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("subscription_keys_invalid");
  const as = opts.serverKeys ?? createECDH("prime256v1");
  if (!opts.serverKeys) as.generateKeys();
  const asPublic = as.getPublicKey();
  const ecdhSecret = as.computeSecret(uaPublic);
  const salt = opts.salt ?? randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Text shown in the notification (bounded, no HTML). */
export function pushPayload(input: { title: string; body?: string; url?: string; tag?: string; locale?: string }): Buffer {
  const dir = input.locale === "en" ? "ltr" : "rtl";
  const json = JSON.stringify({
    title: input.title.slice(0, 120),
    body: (input.body ?? "").slice(0, 300),
    url: input.url && input.url.startsWith("/") ? input.url.slice(0, 300) : "/",
    tag: input.tag?.slice(0, 60),
    dir,
    lang: input.locale ?? "he",
  });
  return Buffer.from(json, "utf8");
}

/** Only real browser push services (the server POSTs to this URL — no SSRF). */
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || endpoint.length > 1000) return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "fcm.googleapis.com" ||
      h === "android.googleapis.com" ||
      h === "updates.push.services.mozilla.com" ||
      h.endsWith(".push.services.mozilla.com") ||
      h === "web.push.apple.com" ||
      h.endsWith(".notify.windows.com") ||
      h.endsWith(".push.apple.com")
    );
  } catch {
    return false;
  }
}
