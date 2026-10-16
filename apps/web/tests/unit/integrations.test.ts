import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isPrivateAddress } from "@/lib/net/safe-url";
import { toE164 } from "@/lib/channels/secrets";
import { verifyMetaSignature, verifyTwilioSignature } from "@/lib/channels/providers";
import { mergeContact, parseContactBody } from "@/lib/public-api-contacts";

describe("SSRF guard", () => {
  it("flags private, loopback, link-local, CGNAT, metadata and ULA addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("rejects non-https, credentials, odd ports, localhost and private IP literals", async () => {
    await expect(assertPublicHttpsUrl("http://example.com")).rejects.toThrow("https_required");
    await expect(assertPublicHttpsUrl("https://user:pw@example.com")).rejects.toThrow("credentials_in_url");
    await expect(assertPublicHttpsUrl("https://example.com:22/x")).rejects.toThrow("port_not_allowed");
    await expect(assertPublicHttpsUrl("https://localhost/x")).rejects.toThrow("host_not_allowed");
    await expect(assertPublicHttpsUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow("host_not_allowed");
    await expect(assertPublicHttpsUrl("https://[::1]/x")).rejects.toThrow("host_not_allowed");
    await expect(assertPublicHttpsUrl("not a url")).rejects.toThrow("invalid_url");
    await expect(assertPublicHttpsUrl("https://8.8.8.8/hook")).resolves.toBeInstanceOf(URL);
  });
});

describe("phone normalisation for messaging", () => {
  it("converts Israeli local numbers and keeps international ones", () => {
    expect(toE164("050-123-4567")).toBe("+972501234567");
    expect(toE164("+1 (415) 555-0100")).toBe("+14155550100");
    expect(toE164("00972501234567")).toBe("+972501234567");
    expect(toE164("12")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe("provider webhook signatures", () => {
  it("Meta X-Hub-Signature-256", () => {
    const body = '{"entry":[]}';
    const sig = `sha256=${createHmac("sha256", "appsecret").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, sig, "appsecret")).toBe(true);
    expect(verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(verifyMetaSignature(`${body} `, sig, "appsecret")).toBe(false);
    expect(verifyMetaSignature(body, null, "appsecret")).toBe(false);
  });

  it("Twilio X-Twilio-Signature (url + sorted params, HMAC-SHA1, base64)", () => {
    const url = "https://app.example.com/api/channels/sms/abc";
    const params = { To: "+15005550006", From: "+972501234567", Body: "Hi", MessageSid: "SM1" };
    const data = url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("");
    const sig = createHmac("sha1", "authtoken").update(data).digest("base64");
    expect(verifyTwilioSignature(url, params, sig, "authtoken")).toBe(true);
    expect(verifyTwilioSignature(url, { ...params, Body: "tampered" }, sig, "authtoken")).toBe(false);
    expect(verifyTwilioSignature(url, params, null, "authtoken")).toBe(false);
  });
});

describe("public API contact bodies", () => {
  it("validates with the UI schema and maps to columns", () => {
    expect(parseContactBody({ first_name: "Dana", email: "DANA@x.io", phone: "050-111-2222" })).toEqual({
      row: { first_name: "Dana", last_name: "", email: "dana@x.io", phone: "0501112222", company_name: null, job_title: null, status: "lead", source: "api", marketing_consent: false },
    });
    expect("errors" in parseContactBody({ first_name: "No contact info" })).toBe(true);
    expect("errors" in parseContactBody({ first_name: "x", email: "bad" })).toBe(true);
  });

  it("PATCH merges only provided fields over the stored record", () => {
    const merged = mergeContact({ first_name: "Dana", email: "d@x.io", phone: null, status: "lead", source: "api", marketing_consent: true }, { status: "customer" });
    expect(merged).toMatchObject({ first_name: "Dana", email: "d@x.io", status: "customer", marketing_consent: true });
  });
});
