import { createDecipheriv, createECDH, createPublicKey, createVerify, hkdfSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { campaignSchema, formSchema, formSteps, isFormFieldVisible } from "@scc/shared/engagement";
import { AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, automationSchema } from "@scc/shared/automations";
import { LIVE_FEATURES } from "@scc/shared/billing";
import { isOptInText, isOptOutText, isRetryReason, optOutConfirmation } from "@/lib/conversations/guard-core";
import { bannedHit, isAngry, normalizeGuardrails, pricesIn, unknownPrices } from "@/lib/ai/guardrails";
import { advanceFlow, pickFlow, validFlowNodes, validateAnswer, type Flow } from "@/lib/ai/flows-core";
import { actUrl, signAct, verifyAct } from "@/lib/act-links";
import { icountBody, morningBody, morningPaymentType, type TaxDocInput } from "@/lib/finance/invoicing";
import { parseInsights, scoreBand } from "@/lib/crm/insights-core";
import { gatherTwiml, isGoodbye, sayTwiml, speakable, wantsPersonOnPhone, xmlEscape } from "@/lib/voice/twiml";
import { videoRoomUrl } from "@/lib/video";
import { abWinner, applyVariant, confidence, isVariant, pickVariant, validVisitorId, zScore } from "@/lib/site/ab-core";
import { cleanCopy } from "@/lib/site/copy-core";
import { gdprSection, legalText } from "@/lib/site/legal";
import { buildSegmentPrompt, parseSegment } from "@/lib/campaigns/segment-core";
import { ga4Body, metaBody, normEmail, normPhoneDigits, sha256, tiktokBody } from "@/lib/marketing/conversions-core";
import { encryptPayload, generateVapidKeys, isPushEndpoint, pushPayload, vapidAuthHeader, vapidReady } from "@/lib/push/webpush-core";
import { creditPacks, packByKey, packOrderRef, parsePackRef } from "@/lib/billing/packs-core";
import { COMMAND_ACTIONS, matchCommands } from "@/lib/command-actions";
import { appointmentReminderText } from "@/lib/appointments/reminder-core";
import { whatsappTemplatePayload } from "@/lib/channels/providers";
import he from "@/lib/i18n/dictionaries/he.json";

const ENV = { ENCRYPTION_KEY: "x".repeat(32) };

describe("conversation guard (pure mirror of SQL)", () => {
  it("detects opt-out / opt-in words as whole messages only", () => {
    for (const w of ["STOP", "הסר", "הסר!", "תסירו אותי", "إلغاء الاشتراك", "unsubscribe."]) expect(isOptOutText(w)).toBe(true);
    for (const w of ["אני לא רוצה להסיר את ההזמנה", "stop by tomorrow?", "כמה עולה הסרה של שיער"]) expect(isOptOutText(w)).toBe(false);
    expect(isOptInText("START")).toBe(true);
    expect(isOptInText("חזרה")).toBe(true);
    expect(isOptInText("אני רוצה לחזור לפגישה")).toBe(false);
  });
  it("retries only on time-based reasons", () => {
    expect(isRetryReason("too_soon")).toBe(true);
    expect(isRetryReason("quiet_hours")).toBe(true);
    expect(isRetryReason("opted_out")).toBe(false);
    expect(optOutConfirmation("he")).toContain("הוסרת");
  });
});

describe("agent guardrails", () => {
  it("normalizes settings with safe defaults", () => {
    expect(normalizeGuardrails(null)).toEqual({ max_replies_per_day: 0, banned: [], price_guard: false, angry_handoff: true, kb: true, voice_replies: false });
    expect(normalizeGuardrails({ max_replies_per_day: 9999, banned: [" x", "ok phrase"] }).max_replies_per_day).toBe(500);
  });
  it("detects anger, banned phrases and invented prices", () => {
    expect(isAngry("אתם נוכלים, אני הולך לעורך דין")).toBe(true);
    expect(isAngry("this is a scam")).toBe(true);
    expect(isAngry("תודה רבה!")).toBe(false);
    expect(bannedHit("We offer a Guaranteed Discount", ["guaranteed discount"])).toBe("guaranteed discount");
    expect(pricesIn("עולה ₪150 או 200 ש״ח")).toEqual([150, 200]);
    expect(unknownPrices("התספורת עולה 180 ₪", "תספורת 150")).toEqual([180]);
    expect(unknownPrices("התספורת עולה 150 ₪", "תספורת 150")).toEqual([]);
  });
});

describe("flow engine", () => {
  const flow: Flow = {
    id: "f1",
    name: "q",
    enabled: true,
    trigger_keywords: ["תפריט"],
    on_first_message: true,
    nodes: validFlowNodes([
      { id: "start", type: "message", text: "היי", next: "when" },
      { id: "when", type: "buttons", text: "מתי?", buttons: [{ label: "עכשיו", next: "phone" }, { label: "בהמשך", next: "phone" }] },
      { id: "phone", type: "collect", field: "phone", text: "טלפון?", next: "done" },
      { id: "done", type: "end", text: "תודה {{phone}}", next: null },
    ]),
  };
  it("starts on keyword or first message", () => {
    expect(pickFlow([flow], "אפשר תפריט?", false)?.id).toBe("f1");
    expect(pickFlow([flow], "שלום", true)?.id).toBe("f1");
    expect(pickFlow([flow], "שלום", false)).toBeNull();
  });
  it("runs buttons → collect (with validation) → end", () => {
    const a = advanceFlow(flow, null, "שלום");
    expect(a.messages.map((m) => m.text)).toEqual(["היי", "מתי?"]);
    expect(a.messages[1]!.buttons).toEqual(["עכשיו", "בהמשך"]);
    const b = advanceFlow(flow, a.state, "1");
    expect(b.messages[0]!.text).toBe("טלפון?");
    const bad = advanceFlow(flow, b.state, "12");
    expect(bad.invalid).toBe(true);
    const c = advanceFlow(flow, b.state, "054-111 2233");
    expect(c.finished).toBe(true);
    expect(c.collected.phone).toBe("0541112233");
    expect(c.messages[0]!.text).toBe("תודה 0541112233");
  });
  it("validates answers", () => {
    expect(validateAnswer("email", "A@B.co")).toBe("a@b.co");
    expect(validateAnswer("email", "nope")).toBeNull();
  });
});

describe("signed action links", () => {
  const p = { k: "appt" as const, id: "11111111-1111-1111-1111-111111111111", a: "confirm" as const, o: "22222222-2222-2222-2222-222222222222", e: Math.floor(Date.now() / 1000) + 60 };
  it("round-trips and rejects tampering / expiry", () => {
    const tok = signAct(p, ENV);
    expect(verifyAct(tok, Date.now(), ENV)).toMatchObject({ k: "appt", a: "confirm" });
    const [body, sig] = tok.split(".") as [string, string];
    const flipped = sig.slice(0, 5) + (sig[5] === "A" ? "B" : "A") + sig.slice(6);
    expect(verifyAct(`${body}.${flipped}`, Date.now(), ENV)).toBeNull();
    expect(verifyAct(`${body.slice(0, -2)}xx.${sig}`, Date.now(), ENV)).toBeNull();
    expect(verifyAct(tok, Date.now() + 120_000, ENV)).toBeNull();
    expect(actUrl("https://app.example/", "he", p, ENV)).toMatch(/^https:\/\/app\.example\/he\/a\/[\w-]+\.[\w-]+$/);
  });
});

describe("tax documents (Morning / iCount)", () => {
  const input: TaxDocInput = {
    docType: "invoice_receipt",
    lang: "he",
    currency: "ILS",
    date: "2026-10-20",
    description: "חשבונית #12",
    client: { name: "דנה", email: "d@x.co", phone: null },
    lines: [{ description: "עיצוב", quantity: 2, unit_price: 100, tax_rate: 18, discount_pct: 10 }],
    payment: { amount: 212.4, method: "paypal", reference: "CAP123" },
  };
  it("builds a Morning invoice-receipt", () => {
    const b = morningBody(input) as { type: number; income: { price: number; vatType: number }[]; payment: { type: number; transactionId: string }[] };
    expect(b.type).toBe(320);
    expect(b.income[0]).toMatchObject({ price: 90, vatType: 0 });
    expect(b.payment[0]).toMatchObject({ type: 5, transactionId: "CAP123" });
    expect(morningPaymentType("bit")).toBe(10);
  });
  it("builds an iCount receipt", () => {
    const b = icountBody({ ...input, docType: "receipt", payment: { amount: 50, method: "cash", reference: null } }) as { doctype: string; cash: { sum: string } };
    expect(b.doctype).toBe("receipt");
    expect(b.cash.sum).toBe("50.00");
  });
});

describe("customer insights", () => {
  it("parses fenced JSON and bounds values", () => {
    const r = parseInsights('```json\n{"score": 140, "sentiment": "positive", "stage": "ready", "next_action": "call", "best_channel": "WhatsApp"}\n```');
    expect(r).toMatchObject({ score: 100, sentiment: "positive", stage: "ready", best_channel: "whatsapp" });
    expect(parseInsights("nothing")).toBeNull();
    expect(scoreBand(70)).toBe("hot");
    expect(scoreBand(39)).toBe("cold");
  });
});

describe("voice (TwiML)", () => {
  it("escapes and speaks clean text", () => {
    expect(xmlEscape(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
    expect(speakable("**היי** https://x.co 😀 [[lead:x]]")).toBe("היי");
    expect(gatherTwiml("שלום", "https://x/turn?a=1&b=2", "he")).toContain('action="https://x/turn?a=1&amp;b=2"');
    expect(sayTwiml("x", "en", { dialTo: "+972541112233" })).toContain("<Dial");
    expect(sayTwiml("x", "en", { dialTo: "bad" })).toContain("<Hangup/>");
  });
  it("understands goodbye / asking for a person in he / en / ar", () => {
    expect(isGoodbye("ביי")).toBe(true);
    expect(isGoodbye("להתראות!")).toBe(true);
    expect(isGoodbye("bye")).toBe(true);
    expect(isGoodbye("مع السلامة")).toBe(true);
    expect(isGoodbye("ביינתיים אני חושב")).toBe(false);
    expect(wantsPersonOnPhone("אפשר נציג?")).toBe(true);
  });
  it("makes private video rooms", () => {
    expect(videoRoomUrl("My Biz!", "ab$cd12", {})).toBe("https://meet.jit.si/mybiz-abcd12");
  });
});

describe("A/B tests", () => {
  it("keeps variants and decides only with enough evidence", () => {
    expect(pickVariant(0.1)).toBe("a");
    expect(pickVariant(0.9)).toBe("b");
    expect(isVariant("c")).toBe(false);
    expect(abWinner({ a_views: 50, b_views: 50, a_conv: 1, b_conv: 30 })).toBeNull(); // not enough visitors
    expect(abWinner({ a_views: 400, b_views: 400, a_conv: 20, b_conv: 60 })).toBe("b");
    expect(abWinner({ a_views: 400, b_views: 400, a_conv: 30, b_conv: 32 })).toBeNull();
    expect(zScore({ a_views: 0, b_views: 10, a_conv: 0, b_conv: 1 })).toBe(0);
    expect(confidence(1.96)).toBeGreaterThan(94.5);
    expect(confidence(1.96)).toBeLessThan(95.5);
    expect(validVisitorId("abc")).toBe(false);
    expect(validVisitorId("a1b2c3d4e5")).toBe(true);
  });
  it("applies variant B to the first hero only", () => {
    const blocks = [
      { type: "hero", data: { title: "A", subtitle: "s", cta_label: "go", cta_href: "", image_url: "" } },
      { type: "hero", data: { title: "A2", subtitle: "", cta_label: "", cta_href: "", image_url: "" } },
    ] as Parameters<typeof applyVariant>[0];
    const out = applyVariant(blocks, { title: "B", cta_label: "" }, "b");
    expect((out[0]!.data as { title: string; cta_label: string }).title).toBe("B");
    expect((out[0]!.data as { cta_label: string }).cta_label).toBe("go");
    expect((out[1]!.data as { title: string }).title).toBe("A2");
    expect(applyVariant(blocks, { title: "B" }, "a")).toBe(blocks);
  });
  it("cleans AI copy", () => {
    expect(cleanCopy('Here is the improved text: "**Fast** service"', 20)).toBe("Fast service");
    expect(cleanCopy("", 10)).toBeNull();
  });
});

describe("conditional, multi-step forms", () => {
  const fields = [
    { key: "email", label: "Email", type: "email" as const, required: true },
    { key: "kind", label: "Kind", type: "select" as const, required: true, options: ["home", "business"], step: 1 },
    { key: "company", label: "Company", type: "text" as const, required: true, step: 2, show_if: { field: "kind", op: "eq" as const, value: "Business" } },
    { key: "notes", label: "Notes", type: "textarea" as const, required: false, step: 2, show_if: { field: "kind", op: "not_empty" as const, value: "" } },
  ];
  it("same visibility rule as the database", () => {
    expect(isFormFieldVisible(fields[2]!, { kind: "business" })).toBe(true);
    expect(isFormFieldVisible(fields[2]!, { kind: "home" })).toBe(false);
    expect(isFormFieldVisible(fields[3]!, { kind: "" })).toBe(false);
    expect(isFormFieldVisible({ show_if: { field: "kind", op: "neq", value: "home" } }, { kind: "home" })).toBe(false);
    expect(formSteps(fields)).toEqual([1, 2]);
  });
  it("validates conditions point to another field", () => {
    expect(formSchema.safeParse({ name: "f", slug: "my-form", fields }).success).toBe(true);
    const bad = fields.map((f) => (f.key === "company" ? { ...f, show_if: { field: "missing", op: "eq" as const, value: "" } } : f));
    expect(formSchema.safeParse({ name: "f", slug: "my-form", fields: bad }).success).toBe(false);
  });
});

describe("campaigns: smart audience + AI segmentation + WhatsApp templates", () => {
  it("accepts the new filters and template", () => {
    const r = campaignSchema.safeParse({ name: "c", channel: "whatsapp", body: "hi", audience: { min_score: "70", inactive_days: 30, sentiment: "positive" }, wa_template: { name: "spring_sale", language: "he", params: ["{{contact.first_name}}"] } });
    expect(r.success).toBe(true);
    expect(campaignSchema.safeParse({ name: "c", channel: "whatsapp", body: "hi", wa_template: { name: "Bad Name" } }).success).toBe(false);
  });
  it("parses AI segments strictly (unknown keys / tags / bad values dropped)", () => {
    expect(parseSegment('{"min_score": 70, "inactive_days": 30, "hack": 1, "sentiment": "angry", "tags": ["vip", "ghost"]}', ["VIP"])).toEqual({ min_score: 70, inactive_days: 30, tags: ["vip"] });
    expect(parseSegment("no json")).toBeNull();
    expect(buildSegmentPrompt("hot leads", ["vip"])).toContain("vip");
  });
  it("builds a WhatsApp template message", () => {
    const p = whatsappTemplatePayload("+972541112233", "spring_sale", "he", ["דנה", ""]) as { to: string; template: { components: { parameters: { text: string }[] }[] } };
    expect(p.to).toBe("972541112233");
    expect(p.template.components[0]!.parameters.map((x) => x.text)).toEqual(["דנה", "-"]);
  });
});

describe("conversion APIs", () => {
  const base = { event: "Purchase" as const, ref: "doc:1", at: "2026-10-20T10:00:00Z", value: 1180, currency: "ils", email: " Dana@X.co ", phone: "054-111-2233", contactId: "c1" };
  it("normalizes and hashes personal data", () => {
    expect(normEmail(" Dana@X.co ")).toBe("dana@x.co");
    expect(normPhoneDigits("054-111-2233")).toBe("972541112233");
    expect(normPhoneDigits("+1 (415) 555-0100")).toBe("14155550100");
    expect(normPhoneDigits("12")).toBeNull();
  });
  it("Meta CAPI body", () => {
    const b = metaBody(base, { testCode: "TEST1" }) as { data: { event_id: string; user_data: { em: string[]; ph: string[] }; custom_data: { currency: string } }[]; test_event_code: string };
    expect(b.data[0]!.event_id).toBe("doc:1");
    expect(b.data[0]!.user_data.em[0]).toBe(sha256("dana@x.co"));
    expect(b.data[0]!.user_data.ph[0]).toBe(sha256("972541112233"));
    expect(b.data[0]!.custom_data.currency).toBe("ILS");
    expect(b.test_event_code).toBe("TEST1");
    expect(JSON.stringify(b)).not.toContain("dana@x.co");
  });
  it("GA4 and TikTok bodies", () => {
    const g = ga4Body(base) as { events: { name: string; params: { transaction_id: string } }[]; user_data: { sha256_phone_number: string[] } };
    expect(g.events[0]!.name).toBe("purchase");
    expect(g.events[0]!.params.transaction_id).toBe("doc:1");
    expect(g.user_data.sha256_phone_number[0]).toBe(sha256("+972541112233"));
    const t = tiktokBody({ ...base, event: "Lead" }, "PIX123") as { event_source_id: string; data: { event: string }[] };
    expect(t.event_source_id).toBe("PIX123");
    expect(t.data[0]!.event).toBe("SubmitForm");
  });
});

describe("web push (RFC 8291 / 8292)", () => {
  it("encrypts a payload the browser can decrypt", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = randomBytes(16);
    const sub = { p256dh: ua.getPublicKey().toString("base64url"), auth: auth.toString("base64url") };
    const msg = pushPayload({ title: "עסק", body: "ליד חדש", url: "/he/crm", locale: "he" });
    const body = encryptPayload(sub, msg);
    // decrypt like a user agent
    const salt = body.subarray(0, 16);
    const idlen = body[20]!;
    const asPublic = body.subarray(21, 21 + idlen);
    const ct = body.subarray(21 + idlen);
    const secret = ua.computeSecret(asPublic);
    const ikm = Buffer.from(hkdfSync("sha256", secret, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32));
    const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const d = createDecipheriv("aes-128-gcm", cek, nonce);
    d.setAuthTag(ct.subarray(ct.length - 16));
    const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
    expect(plain[plain.length - 1]).toBe(2);
    expect(JSON.parse(plain.subarray(0, -1).toString("utf8"))).toMatchObject({ title: "עסק", body: "ליד חדש", url: "/he/crm", dir: "rtl" });
  });
  it("signs a valid VAPID JWT", () => {
    const keys = generateVapidKeys();
    expect(vapidReady({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey })).toBe(true);
    const h = vapidAuthHeader("https://fcm.googleapis.com/fcm/send/abc", { ...keys, subject: "mailto:a@b.co" });
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
    expect(JSON.parse(Buffer.from(m[2]!, "base64url").toString()).aud).toBe("https://fcm.googleapis.com");
    const pub = Buffer.from(keys.publicKey, "base64url");
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") }, format: "jwk" });
    const v = createVerify("SHA256");
    v.update(`${m[1]}.${m[2]}`);
    expect(v.verify({ key, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3]!, "base64url"))).toBe(true);
  });
  it("only posts to real push services", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://evil.example/x")).toBe(false);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
  });
});

describe("credit packs, quick actions, reminders", () => {
  it("packs: defaults, env override, order refs", () => {
    expect(creditPacks({}).length).toBe(3);
    expect(creditPacks({ CREDIT_PACKS_JSON: '[{"key":"ai_1k","credits":1000,"usd":15}]' })).toEqual([{ key: "ai_1k", credits: 1000, usd: 15 }]);
    expect(creditPacks({ CREDIT_PACKS_JSON: "broken" }).length).toBe(3);
    expect(packByKey("ai_500", {})?.credits).toBe(500);
    const id = "33333333-3333-3333-3333-333333333333";
    expect(parsePackRef(packOrderRef(id, "abcd12"))).toBe(id);
    expect(parsePackRef("org:pro:month:x")).toBeNull();
  });
  it("Ctrl+K matches labels / keywords and respects permissions", () => {
    const label = (k: string) => k;
    expect(matchCommands("קמפ", label, () => true)[0]!.key).toBe("newCampaign");
    expect(matchCommands("quote", label, () => true).map((a) => a.key)).toContain("newQuote");
    expect(matchCommands("קמפ", label, () => false).map((a) => a.key)).not.toContain("newCampaign");
    expect(matchCommands("x", label, () => true)).toEqual([]);
    for (const a of COMMAND_ACTIONS) expect((he as unknown as { cmd: Record<string, string> }).cmd[a.key]).toBeTruthy();
  });
  it("appointment reminder text with confirm / cancel", () => {
    const tx = appointmentReminderText("he", "24h", { title: "ייעוץ", starts_at: "2026-10-21T09:00:00Z", location: "תל אביב", org: "העסק" }, "Asia/Jerusalem", { confirm: "https://a/c", cancel: "https://a/x" });
    expect(tx).toContain("מחר");
    expect(tx).toContain("https://a/c");
    expect(appointmentReminderText("en", "1h", { title: null, starts_at: "2026-10-21T09:00:00Z", location: null, org: "" }, "UTC", { confirm: "c", cancel: "x" })).not.toContain("Confirm:");
  });
});

describe("automations, plans, legal", () => {
  it("new triggers + recipes validate", () => {
    for (const t of ["site.behavior", "quote.viewed", "contract.signed", "lead.hot", "customer.opted_out"]) expect(AUTOMATION_TRIGGERS).toContain(t);
    for (const r of AUTOMATION_RECIPES) {
      expect(automationSchema.safeParse({ name: r.key, trigger_type: r.trigger_type, trigger_config: r.trigger_config ?? {}, conditions: r.conditions ?? [], actions: r.actions }).success).toBe(true);
    }
    expect(LIVE_FEATURES.has("ab_testing")).toBe(true);
  });
  it("GDPR additions only when enabled", () => {
    const i = { siteName: "Site", email: "a@b.co" };
    expect(legalText("privacy", "he", i)).not.toContain("GDPR");
    expect(legalText("privacy", "he", { ...i, gdpr: true })).toContain("GDPR");
    expect(legalText("cookies", "en", { ...i, gdpr: true })).toContain("Do Not Track");
    expect(gdprSection("terms", "en", i)).toBe("");
  });
});

/* ---------------------------------------------- sentiment follow-ups + documents ---- */
import { followupHours, followupTone } from "@/lib/ai/followup-tone";
import { documentKind, documentPrompt, isPdfBuffer, maskSecrets, readPlainText } from "@/lib/ai/document-core";

describe("follow-up by mood", () => {
  it("negative customers are not chased, hot ones sooner", () => {
    expect(followupHours(3, "negative", null)).toBeNull();
    expect(followupHours(3, "positive", null)).toBe(1.5);
    expect(followupHours(1, null, "hot")).toBe(1);
    expect(followupHours(3, "neutral", null)).toBe(3);
    expect(followupHours(0, "neutral", null)).toBeNull();
  });
  it("tone guidance follows mood and stage", () => {
    expect(followupTone({ sentiment: "negative", stage: null, leadScore: null })).toMatch(/Do NOT sell/);
    expect(followupTone({ sentiment: null, stage: "ready", leadScore: null })).toMatch(/ONE concrete next step/);
    expect(followupTone({ sentiment: "neutral", stage: "considering", leadScore: null, objections: "price" })).toMatch(/doubt: price/);
    expect(followupTone({ sentiment: null, stage: null, leadScore: null })).toMatch(/light and helpful/);
  });
});

describe("documents from customers", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
  it("detects PDF by its bytes, text by mime / name", () => {
    expect(isPdfBuffer(pdf)).toBe(true);
    expect(documentKind(pdf, "application/octet-stream")).toBe("pdf");
    expect(documentKind(new TextEncoder().encode("hi"), "text/plain")).toBe("text");
    expect(documentKind(new TextEncoder().encode("hi"), "application/octet-stream", "a.txt")).toBe("text");
    expect(documentKind(new Uint8Array([1, 2, 3, 4, 5]), "application/zip", "a.zip")).toBeNull();
  });
  it("masks card and ID numbers, prompt asks for a summary in the agent language", () => {
    expect(maskSecrets("card 4580 1234 5678 9012 id 123456789 total 450")).toBe("card [hidden] id [hidden] total 450");
    expect(readPlainText(new TextEncoder().encode("  הצעת מחיר: 1200 ₪  "))).toBe("הצעת מחיר: 1200 ₪");
    expect(documentPrompt("he", "quote.pdf")).toMatch(/Hebrew.*summary/);
    expect(documentPrompt("en")).toMatch(/English/);
  });
});
