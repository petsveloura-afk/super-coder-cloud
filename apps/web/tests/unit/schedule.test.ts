import { describe, expect, it } from "vitest";
import { localParts, nextOpenText, normalizeSchedule, scheduleInstructions, scheduleStatus, weeklyText, type BusinessSchedule } from "@/lib/ai/schedule";

/** Wave 12 — opening hours: open/closed, next opening, past midnight, holidays, prompt. */
const base: BusinessSchedule = {
  enabled: true,
  tz: "Asia/Jerusalem",
  days: {
    sun: [{ open: "09:00", close: "18:00" }],
    mon: [{ open: "09:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
    tue: [{ open: "09:00", close: "18:00" }],
    wed: [{ open: "09:00", close: "18:00" }],
    thu: [{ open: "18:00", close: "02:00" }],
    fri: [{ open: "08:00", close: "14:00" }],
  },
  closed_dates: ["2026-10-21"],
  after_hours: "book_next",
};
// 2026-10-18 is a Sunday. Israel is UTC+3 in October 2026 (summer time until Oct 25).
const il = (iso: string) => new Date(`${iso}+03:00`);

describe("opening hours", () => {
  it("reads local time in the business time zone", () => {
    expect(localParts(il("2026-10-18T09:30:00"), "Asia/Jerusalem")).toMatchObject({ date: "2026-10-18", day: "sun", hm: "09:30" });
  });

  it("open inside a range, closed outside, with closing time", () => {
    expect(scheduleStatus(base, il("2026-10-18T10:00:00"))).toMatchObject({ open: true, closesAt: "18:00", today: "09:00–18:00" });
    const evening = scheduleStatus(base, il("2026-10-18T19:00:00"));
    expect(evening.open).toBe(false);
    expect(evening.nextOpen).toEqual({ date: "2026-10-19", day: "mon", time: "09:00", inDays: 1 });
  });

  it("split day: closed at the break, next opening the same day", () => {
    const st = scheduleStatus(base, il("2026-10-19T14:00:00"));
    expect(st.open).toBe(false);
    expect(st.nextOpen).toMatchObject({ date: "2026-10-19", time: "16:00", inDays: 0 });
    expect(nextOpenText(st)).toBe("היום ב-16:00");
  });

  it("holiday is closed all day; the next open day is found", () => {
    const st = scheduleStatus(base, il("2026-10-21T10:00:00")); // Wednesday, holiday
    expect(st.open).toBe(false);
    expect(st.today).toBe("closed");
    expect(st.nextOpen).toMatchObject({ date: "2026-10-22", day: "thu", time: "18:00" });
  });

  it("a range past midnight keeps the place open after 00:00", () => {
    expect(scheduleStatus(base, il("2026-10-22T23:30:00")).open).toBe(true); // Thursday night
    expect(scheduleStatus(base, il("2026-10-23T01:30:00"))).toMatchObject({ open: true, closesAt: "02:00" }); // Friday 01:30
    expect(scheduleStatus(base, il("2026-10-23T03:00:00")).open).toBe(false);
  });

  it("Saturday closed → next opening Sunday, text in Hebrew", () => {
    const st = scheduleStatus(base, il("2026-10-24T12:00:00"));
    expect(st.nextOpen).toMatchObject({ day: "sun", time: "09:00", inDays: 1 });
    expect(nextOpenText(st)).toBe("מחר ב-09:00");
    const fri = scheduleStatus(base, il("2026-10-23T15:00:00"));
    expect(nextOpenText(fri)).toBe("ביום ראשון ב-09:00");
  });

  it("normalises bad input: invalid times dropped, max 2 ranges, unknown tz → Israel, disabled → null", () => {
    const n = normalizeSchedule({ tz: "Mars/Base", days: { sun: [{ open: "25:00", close: "10:00" }, { open: "09:00", close: "12:00" }, { open: "13:00", close: "14:00" }, { open: "15:00", close: "16:00" }] }, closed_dates: ["bad", "2026-12-25"], after_hours: "x" as never });
    expect(n).toMatchObject({ tz: "Asia/Jerusalem", closed_dates: ["2026-12-25"], after_hours: "book_next" });
    expect(n!.days!.sun).toHaveLength(2);
    expect(normalizeSchedule({ enabled: false, days: base.days })).toBeNull();
    expect(weeklyText(base)).toContain("שבת: סגור");
  });

  it("prompt: tells the agent the time, status, hours and to book only open times; closed → book for next opening", () => {
    const closed = scheduleInstructions(base, il("2026-10-24T12:00:00"));
    expect(closed).toContain("Local time now: Sat 12:00");
    expect(closed).toContain("CLOSED now. Next opening: 2026-10-25 (Sunday) at 09:00");
    expect(closed).toContain("INSIDE the opening hours");
    expect(closed).toContain("try to close the deal for the next opening");
    const msg = scheduleInstructions({ ...base, after_hours: "closed_message", closed_note: "חוזרים אחרי החג" }, il("2026-10-24T12:00:00"));
    expect(msg).toContain("tell the customer the place is closed now");
    expect(msg).toContain("חוזרים אחרי החג");
    const open = scheduleInstructions(base, il("2026-10-18T10:00:00"));
    expect(open).toContain("OPEN now (until 18:00)");
    expect(scheduleInstructions(null)).toBe("");
  });
});
