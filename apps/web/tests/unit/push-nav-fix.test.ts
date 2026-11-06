import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateVapidKeys, pushRefusal, vapidAuthHeader, vapidSubject } from "@/lib/push/webpush-core";
import { keyToBytes, sameServerKey } from "@/lib/push/client";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("push notifications fix — once allowed, they arrive", () => {
  it("the VAPID subject is always a valid mailto: / https: URL (a bare e-mail broke iPhones)", () => {
    expect(vapidSubject("me@biz.co.il")).toBe("mailto:me@biz.co.il");
    expect(vapidSubject(" mailto:me@biz.co.il ")).toBe("mailto:me@biz.co.il");
    expect(vapidSubject("https://super-coder-cloud.vercel.app")).toBe("https://super-coder-cloud.vercel.app");
    expect(vapidSubject("\"me@biz.com\"")).toBe("mailto:me@biz.com");
    expect(vapidSubject("")).toBe("mailto:support@supercoder.cloud");
    expect(vapidSubject("support")).toBe("mailto:support@supercoder.cloud");
  });

  it("the JWT lives one hour and carries the fixed subject", () => {
    const k = generateVapidKeys();
    const now = Date.parse("2026-11-06T12:00:00Z");
    const h = vapidAuthHeader("https://web.push.apple.com/abc", { ...k, subject: "owner@biz.com" }, now);
    const claims = JSON.parse(Buffer.from(h.split(" t=")[1]!.split(".")[1]!, "base64url").toString());
    expect(claims).toEqual({ aud: "https://web.push.apple.com", exp: now / 1000 + 3600, sub: "mailto:owner@biz.com" });
  });

  it("refusals: expired / old-key subscriptions are dead (removed + re-subscribed), key problems are reported", () => {
    expect(pushRefusal(410, "")).toEqual({ gone: true, reason: "expired" });
    expect(pushRefusal(400, '{"reason":"VapidPkHashMismatch"}')).toEqual({ gone: true, reason: "key_mismatch" });
    expect(pushRefusal(403, "the key in the authorization header does not correspond to the sender ID used to subscribe")).toEqual({ gone: true, reason: "key_mismatch" });
    expect(pushRefusal(403, '{"reason":"BadJwtToken"}')).toEqual({ gone: false, reason: "bad_jwt" });
    expect(pushRefusal(429, "")).toMatchObject({ reason: "too_many" });
    expect(pushRefusal(500, "boom")).toEqual({ gone: false, reason: "other" });
  });

  it("the browser keeps a subscription only when it was made with the server's current key", () => {
    const k = generateVapidKeys();
    const other = generateVapidKeys();
    expect(sameServerKey(keyToBytes(k.publicKey).buffer, k.publicKey)).toBe(true);
    expect(sameServerKey(keyToBytes(other.publicKey).buffer, k.publicKey)).toBe(false);
    expect(sameServerKey(null, k.publicKey)).toBe(true);
  });

  it("wiring: every device of the member, dead subscriptions healed, auto-sync, rotation, renew route, more test attempts", () => {
    const send = read("lib/push/send.ts");
    expect(send).toContain('.select("id, endpoint, p256dh, auth").eq("user_id", n.user_id).limit(10)');
    expect(send).toContain("pushRefusal(res.status, text)");
    const act = read("app/[locale]/(dashboard)/settings/push-actions.ts");
    expect(act).toContain("p_limit: 12");
    expect(act).toContain('return { error: "push.deviceRenewed" };');
    expect(read("components/settings/push-card.tsx")).toContain("const sub = await ensureSubscription(vapidKey);");
    expect(read("app/[locale]/(dashboard)/layout.tsx")).toContain("<PushAutoSync vapidKey=");
    expect(read("components/layout/push-auto-sync.tsx")).toContain('Notification.permission !== "granted"');
    const sw = readFileSync(join(root, "public/sw.js"), "utf8");
    expect(sw).toContain('self.addEventListener("pushsubscriptionchange"');
    expect(sw).toContain('fetch("/api/push/renew"');
    expect(read("app/api/push/renew/route.ts")).toContain('.eq("user_id", auth.user.id).eq("endpoint", old)');
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(read(`lib/i18n/dictionaries/${l}.json`));
      for (const k of ["deviceRenewed", "serverKeys", "renewed"]) expect(typeof d.push[k], `${l}.${k}`).toBe("string");
      for (const k of ["findModule", "recent", "noModule"]) expect(typeof d.nav[k], `${l}.nav.${k}`).toBe("string");
    }
  });
});

describe("menu design — tidy, foldable, findable", () => {
  it("foldable groups (the open screen's group stays open), counts on desktop too, module filter + recent on phones", () => {
    const s = read("components/layout/app-shell.tsx");
    expect(s).toContain("aria-expanded={open}");
    expect(s).toContain("const open = collapsed || here || !folded.has(s.key);");
    expect(s).toContain('<CountsContext.Provider value={{ inbox: props.unreadInbox ?? 0 }}>');
    expect(s).toContain('data-testid="nav-filter"');
    expect(s).toContain('t("nav.recent")');
    expect(s).toContain('data-testid="tab-more-dot"');
    const css = read("app/globals.css");
    const block = css.slice(css.indexOf("menu design (additive)"));
    expect(block).toContain("@layer components {");
    expect(block).not.toMatch(/\btranslate:/);
  });
});
