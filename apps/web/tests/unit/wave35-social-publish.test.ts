import { describe, expect, it } from "vitest";
import { classifyPublishError, publishHintKey, publishRetryDelayMs, MAX_PUBLISH_ATTEMPTS } from "@/lib/social/errors";
import fs from "node:fs";
import path from "node:path";

describe("wave 35 — social publish errors", () => {
  it("recognises the permission error seen in production", () => {
    const k = classifyPublishError("(#283) Requires pages_read_engagement permission to manage the object");
    expect(k).toBe("permission");
    expect(publishHintKey(k)).toBe("social.errPermission");
  });
  it("separates expired logins, temporary trouble and the rest", () => {
    expect(classifyPublishError("Error validating access token: Session has expired")).toBe("token");
    expect(classifyPublishError("HTTP 503")).toBe("transient");
    expect(classifyPublishError("(#4) Application request limit reached")).toBe("transient");
    expect(classifyPublishError("not_connected")).toBe("not_connected");
    expect(classifyPublishError("instagram_needs_image")).toBe("needs_image");
    expect(classifyPublishError("something else")).toBe("other");
    expect(publishHintKey("other")).toBeNull();
  });
  it("retries back off and are limited", () => {
    expect(publishRetryDelayMs(1)).toBe(5 * 60_000);
    expect(publishRetryDelayMs(2)).toBe(10 * 60_000);
    expect(MAX_PUBLISH_ATTEMPTS).toBeGreaterThanOrEqual(2);
  });
  it("new strings exist in he, en and ar", () => {
    for (const l of ["he", "en", "ar"]) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, `../../lib/i18n/dictionaries/${l}.json`), "utf8"));
      for (const k of ["errPermission", "errToken", "errTransient", "publishedNow", "retrying", "reconnect"]) expect(typeof d.social[k], `${l}.social.${k}`).toBe("string");
    }
  });
});
