import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOrderRef,
  lemonStatus,
  moneyString,
  parseOrderRef,
  paypalStatus,
  prepaidPeriodEnd,
  sortKeysDeep,
  verifyLemonSignature,
  verifyNowPaymentsSignature,
} from "@/lib/billing/payments-core";
import { busyMessage, commandIntent, parseAgentTools, pickMedia, salesAgentInstructions } from "@/lib/ai/autopilot-core";
import { generate } from "@/lib/ai/providers";

const ORG = "3f1c2b8e-1a2b-4c3d-9e8f-0123456789ab";

describe("payments — signatures", () => {
  it("verifies NOWPayments IPN (HMAC-SHA512 over key-sorted JSON) and rejects tampering", () => {
    const body = JSON.stringify({ payment_status: "finished", order_id: "x", price_amount: 40, nested: { b: 1, a: 2 } });
    const sig = createHmac("sha512", "ipn-secret").update(JSON.stringify(sortKeysDeep(JSON.parse(body)))).digest("hex");
    expect(verifyNowPaymentsSignature(body, sig, "ipn-secret")).toBe(true);
    expect(verifyNowPaymentsSignature(body, sig.toUpperCase(), "ipn-secret")).toBe(true);
    expect(verifyNowPaymentsSignature(body.replace("40", "4"), sig, "ipn-secret")).toBe(false);
    expect(verifyNowPaymentsSignature(body, sig, "other")).toBe(false);
    expect(verifyNowPaymentsSignature(body, null, "ipn-secret")).toBe(false);
    expect(verifyNowPaymentsSignature("not json", sig, "ipn-secret")).toBe(false);
    expect(verifyNowPaymentsSignature(body, sig, "")).toBe(false);
  });

  it("sorts keys deeply, arrays keep their order", () => {
    expect(JSON.stringify(sortKeysDeep({ b: [{ d: 1, c: 2 }], a: 1 }))).toBe('{"a":1,"b":[{"c":2,"d":1}]}');
  });

  it("verifies Lemon Squeezy X-Signature (HMAC-SHA256 over the raw body)", () => {
    const raw = '{"meta":{"event_name":"subscription_created"}}';
    const sig = createHmac("sha256", "ls-secret").update(raw).digest("hex");
    expect(verifyLemonSignature(raw, sig, "ls-secret")).toBe(true);
    expect(verifyLemonSignature(raw + " ", sig, "ls-secret")).toBe(false);
    expect(verifyLemonSignature(raw, "", "ls-secret")).toBe(false);
  });
});

describe("payments — status, periods, references", () => {
  it("maps PayPal and Lemon statuses", () => {
    expect(paypalStatus("ACTIVE")).toBe("active");
    expect(paypalStatus("approved")).toBe("active");
    expect(paypalStatus("SUSPENDED")).toBe("past_due");
    expect(paypalStatus("CANCELLED")).toBe("canceled");
    expect(paypalStatus("EXPIRED")).toBe("canceled");
    expect(paypalStatus("APPROVAL_PENDING")).toBe("incomplete");
    expect(paypalStatus(null)).toBe("incomplete");
    expect(lemonStatus("cancelled")).toEqual({ status: "active", cancelAtPeriodEnd: true });
    expect(lemonStatus("on_trial").status).toBe("trialing");
    expect(lemonStatus("expired").status).toBe("canceled");
    expect(lemonStatus("paused").status).toBe("past_due");
    expect(lemonStatus("weird").status).toBe("incomplete");
  });

  it("extends a running prepaid period, otherwise starts now", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    expect(prepaidPeriodEnd("month", null, now)).toBe("2026-11-16T10:00:00.000Z");
    expect(prepaidPeriodEnd("year", null, now)).toBe("2027-10-16T10:00:00.000Z");
    expect(prepaidPeriodEnd("month", "2026-10-20T00:00:00Z", now)).toBe("2026-11-20T00:00:00.000Z");
    expect(prepaidPeriodEnd("month", "2026-09-01T00:00:00Z", now)).toBe("2026-11-16T10:00:00.000Z");
  });

  it("builds and parses order references, rejecting anything else", () => {
    const ref = buildOrderRef(ORG, "pro", "year", "abc123");
    expect(parseOrderRef(ref)).toEqual({ org: ORG, plan: "pro", interval: "year" });
    expect(parseOrderRef(`${ORG}:free:month:abc123`)).toBeNull();
    expect(parseOrderRef(`${ORG}:pro:week:abc123`)).toBeNull();
    expect(parseOrderRef("not-a-ref")).toBeNull();
    expect(parseOrderRef(null)).toBeNull();
    expect(moneyString(149)).toBe("149.00");
    expect(moneyString(40.255)).toBe("40.26");
  });
});

describe("agent conversation management", () => {
  it("maps Telegram commands to intents (start, menu, human, mapped questions)", () => {
    expect(commandIntent("/start", "he").kind).toBe("start");
    expect(commandIntent("/start@MyBot ref", "he").kind).toBe("start");
    expect(commandIntent("/menu", "he").kind).toBe("menu");
    expect(commandIntent("/human", "he").kind).toBe("human");
    expect(commandIntent("/prices", "he")).toEqual({ kind: "text", text: "מה המחירים?" });
    expect(commandIntent("/book", "en")).toEqual({ kind: "text", text: "I'd like to book an appointment" });
    expect(commandIntent("/xyz hello", "he")).toEqual({ kind: "text", text: "hello" });
    expect(commandIntent("  שלום  ", "he")).toEqual({ kind: "text", text: "שלום" });
  });

  it("picks gallery images requested by the agent (exact or partial title, web links only, max 3)", () => {
    const media = [
      { title: "לפני ואחרי", url: "https://cdn.example/a.jpg", caption: "פודל" },
      { title: "קטלוג", url: "https://cdn.example/b.jpg" },
      { title: "ישן", url: "ftp://insecure.example/c.jpg" },
      { title: "גור", url: "https://cdn.example/d.jpg" },
      { title: "חתול", url: "https://cdn.example/e.jpg" },
    ];
    const raw = "הנה דוגמאות 😊 [[SEND_MEDIA: לפני ואחרי]] [[send_media: קטלוג מלא]] [[SEND_MEDIA: ישן]] [[SEND_MEDIA: גור]] [[SEND_MEDIA: חתול]]";
    expect(pickMedia(raw, media).map((m) => m.title)).toEqual(["לפני ואחרי", "קטלוג", "גור"]);
    expect(pickMedia(raw, [])).toEqual([]);
    expect(pickMedia("no markers", media)).toEqual([]);
    expect(parseAgentTools(raw).text).toBe("הנה דוגמאות 😊");
  });

  it("puts the business script, required fields, pricing policy, links and gallery into the instructions", () => {
    const s = salesAgentInstructions({
      channel: "telegram",
      goal: "sale",
      profile: {
        flow: ["לברר צורך", " ", "להציע מחיר"],
        fields: ["גודל הכלב"],
        pricing: "עד 10% הנחה",
        links: ["אתר | https://shop.example"],
        media: [{ title: "לפני ואחרי", url: "https://cdn.example/a.jpg" }],
      },
    });
    expect(s).toContain("1. לברר צורך\n2. להציע מחיר");
    expect(s).toContain("גודל הכלב");
    expect(s).toMatch(/never go below it[\s\S]*עד 10% הנחה/);
    expect(s).toContain("אתר | https://shop.example");
    expect(s).toContain("[[SEND_MEDIA: exact title]]");
    expect(s).toContain("- לפני ואחרי");
    // without a profile none of the optional sections appear
    const bare = salesAgentInstructions({ channel: "web" });
    expect(bare).not.toContain("Conversation script");
    expect(bare).not.toContain("SEND_MEDIA");
  });

  it("has a busy hold message in every language", () => {
    expect(busyMessage("he")).toContain("קיבלתי");
    expect(busyMessage("en")).toContain("Got it");
    expect(busyMessage("ar")).toContain("تم");
  });
});

describe("provider patience", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits and retries a busy provider when patience is given, not otherwise", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.AI_ANTHROPIC_BASE_URL = "https://anthropic.example/v1";
    const okBody = () => new Response(JSON.stringify({ content: [{ type: "text", text: "שלום" }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    const busy = () => new Response("{}", { status: 503 });
    const req = { model: "m", system: "", messages: [{ role: "user" as const, content: "x" }], temperature: 0, maxTokens: 10 };

    let f = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(okBody());
    vi.stubGlobal("fetch", f);
    await expect(generate("anthropic", req)).rejects.toThrow("anthropic_503");
    expect(f).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    f = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(okBody());
    vi.stubGlobal("fetch", f);
    const p = generate("anthropic", { ...req, patienceMs: 20_000 });
    await vi.advanceTimersByTimeAsync(2500);
    await expect(p).resolves.toMatchObject({ text: "שלום" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not wait on errors that are not temporary", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.AI_ANTHROPIC_BASE_URL = "https://anthropic.example/v1";
    const f = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", f);
    await expect(generate("anthropic", { model: "m", system: "", messages: [], temperature: 0, maxTokens: 5, patienceMs: 20_000 })).rejects.toThrow("anthropic_401");
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("agent conversation intelligence", () => {
  it("leads the instructions with natural-conversation, pricing, negotiation and self-closing rules", async () => {
    const { CONVERSATION_INTELLIGENCE } = await import("@/lib/ai/autopilot-core");
    const s = salesAgentInstructions({ channel: "telegram", profile: { services: "תספורת 150 ₪", flow: ["לברר צורך"] } });
    expect(s.startsWith(CONVERSATION_INTELLIGENCE)).toBe(true);
    expect(s).toMatch(/ANSWER IT DIRECTLY/);
    expect(s).toMatch(/Prices: when asked/);
    expect(s).toMatch(/close it YOURSELF/);
    expect(s).toMatch(/Never invent a discount/);
    expect(s.indexOf("HOW TO TALK")).toBeLessThan(s.indexOf("Conversation script"));
  });
});
