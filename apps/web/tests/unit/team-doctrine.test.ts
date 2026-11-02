import { describe, expect, it } from "vitest";
import { ROLE_KEYS } from "@/lib/team/roles";
import { DIAGNOSTIC_METHOD, EXPERTISE, WORKING_DOCTRINE, expertisePrompt, isDiagnosticTask } from "@/lib/team/doctrine";
import { employeeSystem, goalPrompt, type EngineMember, type TeamContext } from "@/lib/team/engine-core";

const member = (role: EngineMember["role"]): EngineMember => ({ id: "m1", role, name: "Test", tone: null, instructions: "", tools: [], autonomy: "approve", auto_actions: [], status: "active", limits: {} });
const ctx = { profile: "Name: Dana", memories: [], known: "", playbookExtra: "", reviewer: null, reviewerExtra: null } as unknown as TeamContext;

describe("team doctrine (the shared professional brain)", () => {
  it("every role has deep expertise", () => {
    for (const r of ROLE_KEYS) {
      expect(EXPERTISE[r].length, r).toBeGreaterThanOrEqual(1);
      expect(expertisePrompt(r)).toContain("YOUR EXPERTISE");
    }
  });

  it("recognises review / why-is-it-not-working tasks in Hebrew and English", () => {
    expect(isDiagnosticTask("לבצע סקירה מעמיקה ולמצוא סיבות למה הפרסום והשיווק לא עובד מספיק טוב ולשפר")).toBe(true);
    expect(isDiagnosticTask("Why is our marketing not working? Audit it")).toBe(true);
    expect(isDiagnosticTask("Reply to Dana about her appointment")).toBe(false);
  });

  it("the employee prompt carries the doctrine and the role expertise, and the diagnostic method only when needed", () => {
    const s = employeeSystem(member("marketing"), ctx, "he", "Reply to a customer");
    expect(s).toContain(WORKING_DOCTRINE.slice(0, 40));
    expect(s).toContain("YOUR EXPERTISE");
    expect(s).not.toContain(DIAGNOSTIC_METHOD.slice(0, 30));
    const d = employeeSystem(member("marketing"), ctx, "he", "למה השיווק לא עובד - סקירה");
    expect(d).toContain(DIAGNOSTIC_METHOD.slice(0, 30));
  });

  it("the manager's goal prompt asks for parallel evidence + one synthesis task", () => {
    const p = goalPrompt("review marketing", [{ role: "marketing", name: "Shira", load: 0 }]);
    expect(p).toContain("synthesis");
    expect(p).toContain("depends_on");
  });
});

import { isAutomatedSender } from "@/lib/team/safety-core";
describe("automated senders are not customers", () => {
  it("skips no-reply and service notifications, keeps real people", () => {
    expect(isAutomatedSender({ email: "noreply@accounts.google.com" })).toBe(true);
    expect(isAutomatedSender({ email: "no-reply@vercel.com" })).toBe(true);
    expect(isAutomatedSender({ email: "notifications@github.com" })).toBe(true);
    expect(isAutomatedSender({ name: "Supabase Auth" })).toBe(true);
    expect(isAutomatedSender({ name: "Render" })).toBe(true);
    expect(isAutomatedSender({ email: "dana@salon.co.il", name: "Dana" })).toBe(false);
    expect(isAutomatedSender({ email: "info@smallbusiness.co.il" })).toBe(false);
    expect(isAutomatedSender({ name: "Lotus" })).toBe(false);
  });
});
describe("automated sender detector does not over-match", () => {
  it("keeps look-alike customer domains", () => {
    expect(isAutomatedSender({ email: "dan@box.com" })).toBe(false);
    expect(isAutomatedSender({ email: "dana@gmail.com" })).toBe(false);
    expect(isAutomatedSender({ email: "x@mail.vercel.com" })).toBe(true);
  });
});
