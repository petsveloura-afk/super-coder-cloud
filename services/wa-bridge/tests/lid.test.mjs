import { test } from "node:test";
import assert from "node:assert/strict";
import { lidFromJid, messageMedia, messageMime, messageText, phoneFromKey, toInboundEvent, toOwnerEvent, unwrapMessage } from "../src/util.mjs";

test("LID helpers", () => {
  assert.equal(lidFromJid("123456789012345@lid"), "123456789012345");
  assert.equal(lidFromJid("123456789012345:7@lid"), "123456789012345");
  assert.equal(lidFromJid("972501234567@s.whatsapp.net"), null);
  assert.equal(phoneFromKey({ remoteJid: "9@lid", remoteJidAlt: "972501234567@s.whatsapp.net" }), "972501234567");
  assert.equal(phoneFromKey({ remoteJid: "111222333@lid" }, new Map([["111222333", "972501234567"]])), "972501234567");
  assert.equal(phoneFromKey({ remoteJid: "111222333@lid" }), null);
});

test("a customer known only by a LID is no longer dropped (the agent can answer him)", () => {
  const ev = toInboundEvent({ key: { id: "L1", remoteJid: "111222333444555@lid" }, pushName: "Dana", message: { conversation: "שלום" } });
  assert.deepEqual(ev, { type: "message", id: "L1", from: "111222333444555", name: "Dana", text: "שלום", isGroup: false, media: null, lid: true });
  // once the phone number is known it is used (and the event is a normal one)
  const known = toInboundEvent({ key: { id: "L2", remoteJid: "111222333444555@lid" }, message: { conversation: "היי" } }, new Map([["111222333444555", "972501234567"]]));
  assert.equal(known.from, "972501234567");
  assert.equal(known.lid, undefined);
  // groups / status / own messages are still ignored
  assert.equal(toInboundEvent({ key: { remoteJid: "1@g.us" }, message: { conversation: "x" } }), null);
  assert.equal(toInboundEvent({ key: { remoteJid: "1@lid", fromMe: true }, message: { conversation: "x" } }), null);
});

test("owner typing in a LID chat pauses the agent under the same chat id", () => {
  const msg = { key: { id: "O9", fromMe: true, remoteJid: "111222333444555@lid" }, message: { conversation: "אני כאן" } };
  assert.equal(toOwnerEvent(msg, new Set(), "972501112222").to, "111222333444555");
});

test("wrapped messages are read (disappearing chats, documents with a caption, edits)", () => {
  assert.equal(messageText({ ephemeralMessage: { message: { extendedTextMessage: { text: "hi" } } } }), "hi");
  const doc = { documentWithCaptionMessage: { message: { documentMessage: { fileName: "a.pdf", mimetype: "application/pdf", caption: "החוזה" } } } };
  assert.equal(messageText(doc), "החוזה");
  assert.deepEqual(messageMedia(doc), { type: "document", name: "a.pdf" });
  assert.equal(messageMime(doc), "application/pdf");
  assert.deepEqual(messageMedia({ ephemeralMessage: { message: { audioMessage: { ptt: true, mimetype: "audio/ogg" } } } }), { type: "audio", name: undefined });
  assert.equal(messageText({ protocolMessage: { editedMessage: { conversation: "תיקון" } } }), "תיקון");
  assert.equal(unwrapMessage({ conversation: "x" }).conversation, "x");
  assert.equal(unwrapMessage(null), null);
  assert.equal(messageText({ buttonsResponseMessage: { selectedButtonId: "opt1" } }), "opt1");
});
