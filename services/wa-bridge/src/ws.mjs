// Wave 56 — a minimal, dependency-free WebSocket server (RFC 6455) for Twilio Media Streams.
// Handles the HTTP upgrade handshake, masked client frames, fragmentation, ping/pong and close.
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function acceptKey(key) {
  return createHash("sha1").update(`${key}${GUID}`).digest("base64");
}

/** Encodes one unmasked server frame (opcode 1 = text, 2 = binary, 8 = close, 9 = ping, 10 = pong). */
export function encodeFrame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

/**
 * Incremental frame parser. Feed it raw socket chunks; it calls onFrame({ opcode, payload, fin }).
 * Rejects frames larger than `maxPayload` (protects memory).
 */
export class FrameParser {
  constructor(onFrame, { maxPayload = 1024 * 1024 } = {}) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
    this.maxPayload = maxPayload;
  }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.maxPayload)) throw new Error("frame_too_large");
        len = Number(big);
        off = 10;
      }
      if (len > this.maxPayload) throw new Error("frame_too_large");
      const maskLen = masked ? 4 : 0;
      if (this.buf.length < off + maskLen + len) return;
      const mask = masked ? this.buf.subarray(off, off + 4) : null;
      const start = off + maskLen;
      const payload = Buffer.from(this.buf.subarray(start, start + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(start + len);
      this.onFrame({ opcode, payload, fin });
    }
  }
}

/** A connected WebSocket (server side): emits text messages, sends text, closes cleanly. */
export class WsConnection {
  constructor(socket, { maxPayload = 1024 * 1024 } = {}) {
    this.socket = socket;
    this.open = true;
    this.handlers = { message: [], close: [] };
    this.fragments = [];
    this.fragOpcode = 0;
    this.parser = new FrameParser((f) => this.#onFrame(f), { maxPayload });
    socket.on("data", (chunk) => {
      try {
        this.parser.push(chunk);
      } catch {
        this.close(1009, "too large");
      }
    });
    socket.on("close", () => this.#closed());
    socket.on("error", () => this.#closed());
    socket.setNoDelay?.(true);
  }
  on(event, fn) {
    this.handlers[event]?.push(fn);
    return this;
  }
  send(text) {
    if (!this.open) return false;
    try {
      this.socket.write(encodeFrame(text, 1));
      return true;
    } catch {
      return false;
    }
  }
  close(code = 1000, reason = "") {
    if (!this.open) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    try {
      this.socket.write(encodeFrame(body, 8));
      this.socket.end();
    } catch {
      /* already gone */
    }
    this.#closed();
  }
  #closed() {
    if (!this.open) return;
    this.open = false;
    for (const fn of this.handlers.close) fn();
  }
  #onFrame({ opcode, payload, fin }) {
    if (opcode === 8) return this.close(1000, "");
    if (opcode === 9) {
      try {
        this.socket.write(encodeFrame(payload, 10));
      } catch {
        /* ignore */
      }
      return;
    }
    if (opcode === 10) return;
    if (opcode === 1 || opcode === 2) {
      this.fragOpcode = opcode;
      this.fragments = [payload];
    } else if (opcode === 0) {
      this.fragments.push(payload);
    } else return;
    if (!fin) return;
    const data = Buffer.concat(this.fragments);
    this.fragments = [];
    if (this.fragOpcode === 1) for (const fn of this.handlers.message) fn(data.toString("utf8"));
  }
}

/** Completes the HTTP → WebSocket upgrade. Returns the connection, or null when the request is not a valid upgrade. */
export function upgradeToWebSocket(req, socket, opts = {}) {
  const key = req.headers["sec-websocket-key"];
  if (req.method !== "GET" || String(req.headers.upgrade ?? "").toLowerCase() !== "websocket" || typeof key !== "string" || key.length < 16) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return null;
  }
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`, "", ""].join("\r\n"));
  return new WsConnection(socket, opts);
}
