import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Stage 1 audit, kept as a permanent guard: every server action of the platform is checked statically on every run.
 *   1. it identifies the caller (getOrgContext / a guard helper in the same file that does) — or it is on the short,
 *      reviewed list of actions that are public by design or act only on the signed-in person's own account
 *   2. a dashboard action that identifies the business also checks a permission (ctx.can / platform admin) — or acts
 *      only on the person's own data (reviewed list)
 *   3. every literal translation key used in code exists in he, en and ar (a missing key shows a raw key to users)
 */
const root = join(__dirname, "../..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

/** public by design (sign-in, public pages) or acting only on the signed-in person's own account / data */
const REVIEWED: Record<string, string> = {
  "createOrganizationAction": "any signed-in person may create their own business",
  "acceptInvitationAction": "token-based invitation, checked in the database",
  "switchOrganizationAction": "membership checked by the database function",
  "forgotPasswordAction": "public sign-in flow",
  "updatePasswordAction": "the signed-in person's own password",
  "signOutAction": "own session",
  "saveViewAction": "own saved views (RLS: own or shared in the same business)",
  "deleteViewAction": "own saved views (RLS)",
  "addMyChannelAction": "own notification channel",
  "updateMyChannelAction": "own notification channel",
  "deleteMyChannelAction": "own notification channel",
  "setMyAvailabilityAction": "own availability",
  "updateProfileAction": "own profile",
  "markNotificationsReadAction": "own notifications",
  "updateProfileProAction": "own profile",
  "createAvatarUploadAction": "own avatar",
  "setAvatarAction": "own avatar",
  "updateCalendarAction": "own calendar connection",
  "mfaStatusAction": "own two-step sign-in (Supabase Auth session)",
  "mfaEnrollAction": "own two-step sign-in",
  "mfaVerifyAction": "own two-step sign-in",
  "mfaDisableAction": "own two-step sign-in",
  "signOutOthersAction": "own sessions",
  "testPushAction": "own push subscription",
  "countSavedReplyUseAction": "the database function checks inbox.reply",
  "startDocumentPayment": "public payment page (document token)",
  "startDocumentPayPal": "public payment page (document token)",
  "performActAction": "public signed link",
  "markArticleHelpful": "public help article",
  "answerSurveyAction": "public survey link (token)",
  "signInAction": "public sign-in",
  "signUpAction": "public sign-up",
  "signInWithGoogleAction": "public sign-in",
  "mfaLoginAction": "the second sign-in step of the person's own session",
  "subscribePushAction": "own push subscription",
  "unsubscribePushAction": "own push subscription",
  "submitPublicForm": "public form (validated + rate limited in the database)",
  "bookPublicAppointment": "public booking page",
  "cancelPublicAppointment": "public booking (cancel token)",
  "unsubscribePublic": "public unsubscribe link (token)",
  "createPublicTicket": "public help center",
  "replyPublicTicket": "public ticket (token)",
  "acceptPublicQuote": "public quote (token)",
  "signPublicQuote": "public quote (token)",
};

interface Act {
  file: string;
  name: string;
  body: string;
  helpers: string[];
}

function serverActions(): Act[] {
  const out: Act[] = [];
  for (const p of walk(join(root, "app"))) {
    const s = readFileSync(p, "utf8");
    if (!s.trimStart().startsWith('"use server"')) continue;
    // local helpers that identify the caller (guard / aiGate / ctxFor …)
    const helpers = [...s.matchAll(/(?:^|\n)(?:async )?function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g)].filter((m) => /getOrgContext\(|requirePlatformAdmin|isPlatformAdmin/.test(m[2] ?? "")).map((m) => m[1]!);
    const starts = [...s.matchAll(/\nexport async function (\w+)\s*\(/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1]!.index! : s.length;
      out.push({ file: relative(root, p), name: m[1]!, body: s.slice(m.index!, end), helpers });
    });
  }
  return out;
}

describe("stage 1 audit — every server action", () => {
  const acts = serverActions();

  it("finds the platform's actions", () => {
    expect(acts.length).toBeGreaterThan(250);
  });

  it("every action identifies the caller (or is reviewed as public / own-account)", () => {
    const bad = acts.filter((a) => {
      if (REVIEWED[a.name]) return false;
      if (/getOrgContext\(|requirePlatformAdmin|auth\.getUser\(|getUser\(\)/.test(a.body)) return false;
      return !a.helpers.some((h) => new RegExp(`\\b${h}\\(`).test(a.body));
    });
    expect(bad.map((a) => `${a.file}#${a.name}`)).toEqual([]);
  });

  it("dashboard actions that identify the business check a permission (or act on own data)", () => {
    const bad = acts.filter((a) => {
      if (!a.file.includes("(dashboard)") || REVIEWED[a.name]) return false;
      if (/\.can\(|isPlatformAdmin|requirePlatformAdmin/.test(a.body)) return false;
      // the guard helper of the file checks the permission
      const file = readFileSync(join(root, a.file), "utf8");
      return !a.helpers.some((h) => new RegExp(`\\b${h}\\(`).test(a.body) && new RegExp(`function ${h}[\\s\\S]{0,1500}?\\.can\\(`).test(file));
    });
    expect(bad.map((a) => `${a.file}#${a.name}`)).toEqual([]);
  });
});

describe("stage 1 audit — translations used in code exist", () => {
  const dicts = ["he", "en", "ar"].map((l) => JSON.parse(readFileSync(join(root, `lib/i18n/dictionaries/${l}.json`), "utf8")) as Record<string, unknown>);
  const has = (d: Record<string, unknown>, k: string) => typeof k.split(".").reduce<unknown>((c, p) => (c && typeof c === "object" ? (c as Record<string, unknown>)[p] : undefined), d) === "string";
  it("every literal key (t(\"…\"), error: \"…\", message: \"…\") is translated in he, en and ar", () => {
    const re = /(?:\bt\(|error:\s*|message:\s*|titleKey:\s*|title_key:\s*)\s*["']([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)["']/g;
    const missing = new Set<string>();
    for (const base of ["app", "lib", "components"]) {
      for (const p of walk(join(root, base))) {
        if (p.includes("/i18n/")) continue;
        for (const m of readFileSync(p, "utf8").matchAll(re)) {
          const k = m[1]!;
          if (/^(next|react|node)\./.test(k)) continue;
          if (dicts.some((d) => !has(d, k))) missing.add(`${k} (${relative(root, p)})`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
