import test from "node:test";
import assert from "node:assert/strict";
import { MEDIA_MAX_BYTES, attachMediaData, messageMime, wantsMediaData } from "../src/util.mjs";

test("wave 16: voice notes and images get base64 data, big files do not", () => {
  const ev = { type: "message", id: "1", from: "972501234567", text: "", media: { type: "audio" } };
  const out = attachMediaData(ev, Buffer.from("OggS-fake"), "audio/ogg; codecs=opus");
  assert.equal(out.media.mime, "audio/ogg; codecs=opus");
  assert.equal(Buffer.from(out.media.data, "base64").toString(), "OggS-fake");
  assert.equal(attachMediaData(ev, Buffer.alloc(MEDIA_MAX_BYTES + 1), "audio/ogg").media.data, undefined);
  assert.equal(attachMediaData({ ...ev, media: null }, Buffer.from("x"), null).media, null);
  assert.equal(wantsMediaData("audio"), true);
  assert.equal(wantsMediaData("image"), true);
  assert.equal(wantsMediaData("document"), false);
  assert.equal(messageMime({ imageMessage: { mimetype: "image/png" } }), "image/png");
  assert.equal(messageMime({ ephemeralMessage: { message: { audioMessage: { mimetype: "audio/ogg" } } } }), "audio/ogg");
});

test("wave 16: PDF / text documents are downloaded for the agent, other files are not", () => {
  assert.equal(wantsMediaData("document", "application/pdf", "quote.pdf"), true);
  assert.equal(wantsMediaData("document", null, "notes.txt"), true);
  assert.equal(wantsMediaData("document", "application/zip", "a.zip"), false);
  assert.equal(messageMime({ documentMessage: { mimetype: "application/pdf" } }), "application/pdf");
});
