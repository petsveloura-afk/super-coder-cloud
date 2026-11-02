import { describe, expect, it } from "vitest";
import { parseWeekPlan } from "@/lib/social/brain-core";
import { diagnosePlanAnswer, escapeControlInStrings, parseWeekPlanTolerant, stripTrailingCommas, topLevelObjects } from "@/lib/team/json-repair-core";

const body = "הוק חזק לפוסט\nשורה שנייה עם תוכן מספיק ארוך\nקריאה לפעולה #עסק";
const esc = body.replace(/\n/g, "\\n");

describe("tolerant week-plan parser (fallback for social.plan_week ai.failed)", () => {
  it("matches the strict parser on a valid answer (nothing changes when the strict parser works)", () => {
    const raw = JSON.stringify([{ post: body, pillar: "a", scene: "s", headline: "h" }]);
    expect(parseWeekPlanTolerant(raw)).toEqual(parseWeekPlan(raw));
  });
  it("reads answers the strict parser rejects", () => {
    const shapes = [
      `[{"post": "${body}", "pillar": "a"}]`, // literal newlines inside the string
      `[{"post": "חברת דוגמה בע"מ מזמינה אתכם להצטרף לשבוע מיוחד", "pillar": "a"}]`, // unescaped Hebrew quote
      `[{"post": "${esc}"},]`, // trailing comma
      `[הערה] הנה: [{"post": "${esc}"}]`, // preamble with [
      "```json\n" + `[{"post": "${esc}"}]` + "\n```",
    ];
    for (const raw of shapes) expect(parseWeekPlanTolerant(raw).length, raw).toBe(1);
    expect(parseWeekPlan(shapes[0]!)).toHaveLength(0);
  });
  it("keeps complete posts from a cut-off answer and never invents the unfinished one", () => {
    const raw = `[{"post": "${esc}"},{"post": "${esc} שני"},{"post": "פוסט שלישי שנחת`;
    expect(parseWeekPlanTolerant(raw)).toHaveLength(2);
    expect(diagnosePlanAnswer(raw)).toBe("truncated");
  });
  it("returns nothing for text without posts, respects max and drops too-short posts", () => {
    expect(parseWeekPlanTolerant("sorry, I cannot")).toEqual([]);
    expect(diagnosePlanAnswer("")).toBe("empty");
    expect(diagnosePlanAnswer("hello")).toBe("no_json");
    const many = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ post: `${body} ${i}` })));
    expect(parseWeekPlanTolerant(many, 3)).toHaveLength(3);
    expect(parseWeekPlanTolerant(`[{"post":"קצר"}]`)).toEqual([]);
  });
  it("helpers behave", () => {
    expect(stripTrailingCommas("[1,2,]")).toBe("[1,2]");
    expect(escapeControlInStrings('{"a":"x\ny"}')).toBe('{"a":"x\\ny"}');
    expect(topLevelObjects('[{"a":"}"},{"b":1},{"c":')).toEqual(['{"a":"}"}', '{"b":1}']);
  });
});
