// Pure helpers of the WhatsApp QR bridge (unit-tested with node --test).
import { createHmac, timingSafeEqual } from "node:crypto";

/** Account ids are UUIDs (channel_accounts.id) — also used as directory names. */
export function validSessionId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

/** Only the web app's own callback URL is accepted. */
export function validCallback(url, appUrl) {
  if (typeof url !== "string" || !/^https?:\/\/\S+\/api\/channels\/whatsapp_qr\/[a-f0-9]{48}$/.test(url)) return false;
  if (!appUrl) return true;
  try {
    return new URL(url).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

export function sign(secret, body, now = Date.now()) {
  const ts = String(now);
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return { "X-SCC-Timestamp": ts, "X-SCC-Signature": sig };
}

export function authorized(header, secret) {
  if (!secret || secret.length < 24) return false;
  const given = Buffer.from(String(header ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** "972501234567@s.whatsapp.net" → "972501234567" (null for groups, broadcasts, newsletters). */
export function phoneFromJid(jid) {
  if (typeof jid !== "string") return null;
  const m = jid.match(/^(\d{6,20})(?::\d+)?@s\.whatsapp\.net$/);
  return m ? m[1] : null;
}

export function jidFromPhone(digits) {
  const d = String(digits ?? "").replace(/[^\d]/g, "");
  return /^\d{6,20}$/.test(d) ? `${d}@s.whatsapp.net` : null;
}

/** Text of an incoming WhatsApp message (text, captions, buttons, lists, locations). */
export function messageText(message) {
  if (!message || typeof message !== "object") return "";
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message ?? message;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.buttonsResponseMessage?.selectedDisplayText ??
    m.listResponseMessage?.title ??
    m.templateButtonReplyMessage?.selectedDisplayText ??
    (m.locationMessage ? `📍 ${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}` : "") ??
    ""
  );
}

export function messageMedia(message) {
  if (!message || typeof message !== "object") return null;
  for (const t of ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"]) {
    if (message[t]) return { type: t.replace("Message", ""), name: message[t].fileName ?? undefined };
  }
  return null;
}

/**
 * Converts a Baileys WAMessage into the bridge callback payload,
 * or null when it must be ignored (own messages, groups, status, empty).
 */
export function toInboundEvent(msg) {
  const key = msg?.key ?? {};
  if (key.fromMe) return null;
  const remote = key.remoteJid ?? "";
  if (!remote || remote.endsWith("@g.us") || remote === "status@broadcast" || remote.endsWith("@broadcast") || remote.endsWith("@newsletter")) return null;
  // newer WhatsApp "LID" addressing: the phone number is carried separately
  const from = phoneFromJid(remote) ?? phoneFromJid(key.senderPn ?? "") ?? null;
  if (!from) return null;
  const text = messageText(msg.message);
  const media = messageMedia(msg.message);
  if (!text && !media) return null;
  return { type: "message", id: key.id ?? null, from, name: msg.pushName ?? null, text: String(text).slice(0, 8000), isGroup: false, media };
}
