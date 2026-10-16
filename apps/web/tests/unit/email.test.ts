import { afterEach, describe, expect, it, vi } from "vitest";
import { emailConfigured, escapeHtml, invitationEmail, sendEmail } from "@/lib/email/send";

const ENV_KEYS = ["EMAIL_PROVIDER_API_KEY", "EMAIL_FROM_ADDRESS", "EMAIL_PROVIDER_API_BASE"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("email: escaping", () => {
  it("escapes every HTML-significant character", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });
});

describe("email: invitation template", () => {
  const base = { orgName: `Acme <b>"Ltd"</b>`, inviterName: "Dana <img src=x>", roleLabel: "מנהל", link: "https://app.test/he/invite/abc?x=1&y=2" };

  it("Hebrew and Arabic are RTL, English is LTR", () => {
    expect(invitationEmail({ ...base, locale: "he" }).html).toContain(`lang="he" dir="rtl"`);
    expect(invitationEmail({ ...base, locale: "ar" }).html).toContain(`lang="ar" dir="rtl"`);
    expect(invitationEmail({ ...base, locale: "en" }).html).toContain(`lang="en" dir="ltr"`);
  });

  it("never injects raw HTML from organization or inviter names", () => {
    const { html, subject, text } = invitationEmail({ ...base, locale: "he" });
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain(`href="https://app.test/he/invite/abc?x=1&amp;y=2"`);
    expect(subject).toContain("Acme");
    expect(text).toContain(base.link);
  });
});

describe("email: sending", () => {
  it("is a no-op when not configured", async () => {
    delete process.env.EMAIL_PROVIDER_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(emailConfigured()).toBe(false);
    expect(await sendEmail({ to: "a@b.co", subject: "s", html: "<p>h</p>", text: "t" })).toEqual({ sent: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the Resend API with bearer auth and the configured sender", async () => {
    process.env.EMAIL_PROVIDER_API_KEY = "re_test_key";
    process.env.EMAIL_FROM_ADDRESS = "Super Coder <no-reply@example.com>";
    process.env.EMAIL_PROVIDER_API_BASE = "http://mock.local/resend/";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const r = await sendEmail({ to: "a@b.co", subject: "Hello", html: "<p>h</p>", text: "t" });
    expect(r).toEqual({ sent: true });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://mock.local/resend/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(String(init.body))).toMatchObject({ from: "Super Coder <no-reply@example.com>", to: ["a@b.co"], subject: "Hello" });
  });

  it("reports provider errors without throwing", async () => {
    process.env.EMAIL_PROVIDER_API_KEY = "re_test_key";
    process.env.EMAIL_FROM_ADDRESS = "x@example.com";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 422 })));
    expect(await sendEmail({ to: "a@b.co", subject: "s", html: "h", text: "t" })).toEqual({ sent: false, reason: "provider_error" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await sendEmail({ to: "a@b.co", subject: "s", html: "h", text: "t" })).toEqual({ sent: false, reason: "provider_error" });
  });
});
