import { describe, expect, it } from "vitest";
import { askOrAssume, calibrate, calibrationScore, calibrationTable, customerModel, editDistance, errorCost, extractEntities, hebrewNumber, matchesWord, normalizeText, ownerModel, readIntent, skeleton, understand, understandingPrompt } from "@/lib/team/understanding-core";

const SERVICES = ["תספורת", "צבע", "החלקה"];
const u = (m: string, ctx = { knownServices: SERVICES }) => understand(m, ctx);

describe("normalizeText — real Hebrew", () => {
  it("strips niqqud, stretched letters, fillers, laughter, address words and repeated words", () => {
    const n = normalizeText("אממ אחי מההההר אני אני רוצה חחח תור");
    expect(n.text).toBe("מהר אני רוצה תור");
    expect(n.noise).toBeGreaterThan(0.3);
    expect(normalizeText("שָׁלוֹם").text).toBe("שלום");
  });
  it("maps slang phrases to standard ones", () => {
    expect(normalizeText("בא לי תספורת").text).toBe("אני רוצה תספורת");
    expect(normalizeText("כמה זה יוצא החלקה").text).toBe("מחיר החלקה");
    expect(normalizeText("מתי אתם פתוחים").text).toBe("שעות פתיחה");
    expect(normalizeText("אפשר בן אדם אמיתי").text).toContain("נציג");
  });
  it("keeps numbers, times and legit double letters", () => {
    expect(normalizeText("ב 17:30 וגם 120").tokens).toContain("17:30");
    expect(normalizeText("וואלה").text).toBe("וואלה");
  });
});

describe("spelling tolerance (כתיב חסר / שגוי)", () => {
  it("skeleton ignores ו / י inside the word and final letters", () => {
    expect(skeleton("לקבוע")).toBe(skeleton("לקבע"));
    expect(skeleton("פתוחים")).toBe(skeleton("פתחים"));
    expect(skeleton("מחיר")).toBe(skeleton("מחר").length === 3 ? "מחר" : skeleton("מחיר"));
  });
  it("matches with Hebrew prefixes and one typo, but not unrelated words", () => {
    expect(matchesWord("לבטל", "לבטל")).toBe("exact");
    expect(matchesWord("ולבתל", "לבטל")).toBe("fuzzy");
    expect(matchesWord("שהמחיר", "מחיר")).toBe("exact");
    expect(matchesWord("מחירון", "מחיר")).toBeNull();
    expect(matchesWord("שולחן", "תור")).toBeNull();
  });
  it("edit distance is bounded", () => {
    expect(editDistance("abc", "abd", 1)).toBe(1);
    expect(editDistance("abc", "xyzxyz", 1)).toBeGreaterThan(1);
  });
});

describe("Hebrew number words", () => {
  it("parses spoken amounts", () => {
    expect(hebrewNumber(["מאה", "עשרים"])).toBe(120);
    expect(hebrewNumber(["מאתיים", "וחמישים"])).toBe(250);
    expect(hebrewNumber(["שלוש", "מאות"])).toBe(300);
    expect(hebrewNumber(["אלף", "ומאתיים"])).toBe(1200);
    expect(hebrewNumber(["שלום"])).toBeNull();
  });
  it("extracts amounts, times, dates and phones from a message", () => {
    const m = "אני רוצה מחר ב17:30 בערך מאה עשרים שקל, הטלפון 052-123-4567";
    const e = extractEntities(normalizeText(m).tokens, m);
    expect(e.amounts).toContainEqual({ value: 120, currency: "ILS" });
    expect(e.times).toContain("17:30");
    expect(e.dates).toContain("מחר");
    expect(e.phones).toContain("0521234567");
    expect(extractEntities([], "₪350 ועוד 80 שח").amounts.map((a) => a.value).sort((a, b) => a - b)).toEqual([80, 350]);
  });
});

describe("intent — slang, voice transcripts, English, Arabic", () => {
  const cases: [string, string][] = [
    ["היי אפשר לקבוע תור לתספורת מחר בחמש", "booking"],
    ["אממ כאילו אני רוצה לקבע תר ליום שלישי בערב", "booking"],
    ["בא לי להזמין תור לצבע", "booking"],
    ["אחי אני צריך לבטל את התור של מחר", "cancel"],
    ["אפשר לדחות את הפגישה לשבוע הבא", "cancel"],
    ["כמה זה יוצא החלקה", "price"],
    ["מה המחיר של תספורת", "price"],
    ["כמה עולא צבע", "price"],
    ["מתי אתם פתוחים בשישי", "hours"],
    ["עד מתי פתוח היום", "hours"],
    ["השירות היה גרוע ואני מאוד לא מרוצה", "complaint"],
    ["זה מחורבן, חיכיתי שעה בטלפון", "complaint"],
    ["אפשר לדבר עם נציג בבקשה", "human"],
    ["I want to book an appointment for tomorrow", "booking"],
    ["How much is a haircut?", "price"],
    ["أريد حجز موعد غدا", "booking"],
    ["كم سعر الصبغة", "price"],
    ["תודה רבה", "thanks"],
    ["מה המצב עם ההזמנה שלי? עדיין לא קיבלתי עדכון", "followup"],
  ];
  for (const [msg, want] of cases) {
    it(`${want}: ${msg}`, () => expect(u(msg).intent).toBe(want));
  }
  it("random chatter is 'info' or 'unknown' with LOW confidence — never a confident guess", () => {
    const r = u("שמעתי שיהיה גשם בסוף השבוע");
    expect(["info", "unknown"]).toContain(r.intent);
    expect(r.confidence).toBeLessThan(0.6);
    expect(u("אה").intent).toBe("unknown");
    expect(u("אה").confidence).toBeLessThanOrEqual(0.2);
  });
  it("readIntent reports a runner-up when two intents compete", () => {
    const r = readIntent(normalizeText("אני רוצה לבטל ולהזמין תור חדש").tokens);
    expect(r.runnerUp).not.toBeNull();
  });
});

describe("missing details, urgency, emotion", () => {
  it("booking without a date or time lists exactly what is missing", () => {
    expect(u("אפשר תור לתספורת").missing).toEqual(["date", "time"]);
    expect(u("אפשר תור").missing).toEqual(["service", "date", "time"]);
    expect(u("תור לתספורת מחר ב17:30").missing).toEqual([]);
  });
  it("urgency from words and 'today'; emotion from the existing reader", () => {
    expect(u("דחוף! צריך תור היום").urgency).toBeGreaterThanOrEqual(0.7);
    expect(u("אשמח לתור בשבוע הבא").urgency).toBeLessThan(0.4);
    expect(u("זה בושה, שירות מחורבן").emotion).toBe("angry");
  });
  it("voice-transcript noise lowers confidence", () => {
    const clean = u("אני רוצה לקבוע תור לתספורת מחר בחמש");
    const noisy = u("אממ אה אני אני כאילו רוצה אממ לקבוע תור אה לתספורת מחר בחמש");
    expect(noisy.noise).toBeGreaterThan(clean.noise);
    expect(noisy.confidence).toBeLessThanOrEqual(clean.confidence);
  });
});

describe("ask or assume — by the cost of a wrong guess", () => {
  it("cost: complaints, money and irreversible actions are high; booking / cancel medium; questions low", () => {
    expect(errorCost(u("זה מחורבן"))).toBe("high");
    expect(errorCost(u("מה המחיר"), "money")).toBe("high");
    expect(errorCost(u("תור מחר"))).toBe("medium");
    expect(errorCost(u("מתי פתוחים"))).toBe("low");
    expect(errorCost(u("אני רוצה החזר של 200 שקל"))).toBe("high");
    expect(errorCost(u("תור לתספורת ב150 שקל"))).toBe("medium");
  });
  it("low cost + something missing → ASSUME out loud, never block the customer", () => {
    const r = u("כמה עולה");
    const p = askOrAssume(r, errorCost(r), "he");
    expect(p.mode).toBe("assume");
    expect(p.assumptions.length).toBeGreaterThan(0);
    expect(p.question).toBeNull();
  });
  it("medium cost + missing → ask exactly ONE question, the most important missing thing first", () => {
    const r = u("אפשר תור");
    const p = askOrAssume(r, errorCost(r), "he");
    expect(p.mode).toBe("ask");
    expect(p.question).toBe("על איזה שירות מדובר?");
    expect(askOrAssume(u("אפשר תור לתספורת"), "medium", "en").question).toBe("Which day would you like?");
    expect(askOrAssume(u("אפשר תור לתספורת מחר"), "medium", "ar").question).toBe("ما الوقت المناسب لك؟");
  });
  it("high cost never guesses: it asks unless everything is present and the reading is very sure", () => {
    expect(askOrAssume({ intent: "cancel", missing: ["which_appointment"], confidence: 0.95 }, "high").mode).toBe("ask");
    expect(askOrAssume({ intent: "cancel", missing: [], confidence: 0.6 }, "high").mode).toBe("ask");
    expect(askOrAssume({ intent: "cancel", missing: [], confidence: 0.9 }, "high").mode).toBe("proceed");
  });
  it("a complete, clear request just proceeds", () => {
    const r = u("תור לתספורת מחר ב17:30");
    expect(askOrAssume(r, errorCost(r)).mode).toBe("proceed");
  });
  it("the prompt block is honest about its own uncertainty", () => {
    const r = u("אפשר תור");
    const p = askOrAssume(r, "medium", "he");
    const text = understandingPrompt(r, p, 0.5);
    expect(text).toContain("may be wrong");
    expect(text).toContain("ONE question");
  });
});

describe("owner and customer models", () => {
  it("owner: language, brevity, casual speech and standing rules", () => {
    const m = ownerModel(["סבבה תמשיך", "תמיד תשאל אותי לפני שליחה ללקוחות", "יאללה אחי"]);
    expect(m.language).toBe("he");
    expect(m.prefersShort).toBe(true);
    expect(m.casual).toBe(true);
    expect(m.standingRules[0]).toContain("תמיד");
    expect(ownerModel(["Please prepare a detailed summary of all the leads from last week and tell me why they dropped", "I would like a full explanation with the numbers"]).language).toBe("en");
    expect(ownerModel(["שלום תמשיך", "please continue with the report"]).language).toBe("mixed");
    expect(ownerModel([]).language).toBe("he");
  });
  it("customer: usual intent, complaints, style and language", () => {
    const m = customerModel(["היי כמה עולה תספורת", "וצבע?", "מה המחיר של החלקה"]);
    expect(m.usualIntent).toBe("price");
    expect(m.complaints).toBe(0);
    expect(m.language).toBe("he");
    expect(customerModel(["זה גרוע", "שירות נורא", "אני לא מרוצה"]).complaints).toBe(3);
    expect(customerModel(["How much is color"]).language).toBe("en");
  });
});

describe("confidence calibration", () => {
  const overconfident = Array.from({ length: 40 }, (_, i) => ({ confidence: 0.9, correct: i % 2 === 0 }));
  it("with no history the raw value is kept", () => expect(calibrate(0.8, calibrationTable([]))).toBe(0.8));
  it("an overconfident reader is pulled DOWN toward its real hit rate", () => {
    const c = calibrate(0.9, calibrationTable(overconfident));
    expect(c).toBeLessThan(0.65);
    expect(c).toBeGreaterThan(0.45);
  });
  it("an underconfident reader is pulled UP", () => {
    const under = Array.from({ length: 40 }, () => ({ confidence: 0.3, correct: true }));
    expect(calibrate(0.3, calibrationTable(under))).toBeGreaterThan(0.8);
  });
  it("few samples barely move it (the prior is worth 5 samples)", () => {
    const few = [{ confidence: 0.9, correct: false }];
    expect(calibrate(0.9, calibrationTable(few))).toBeGreaterThan(0.7);
  });
  it("Brier and calibration error expose miscalibration, and are ~0 for a perfect reader", () => {
    const bad = calibrationScore(overconfident);
    const perfect = calibrationScore(Array.from({ length: 20 }, () => ({ confidence: 1, correct: true })));
    expect(bad.ece).toBeGreaterThan(0.3);
    expect(perfect.brier).toBe(0);
    expect(perfect.ece).toBe(0);
    expect(calibrationScore([]).n).toBe(0);
  });
});
