import { describe, expect, it } from "vitest";
import he from "@/lib/i18n/dictionaries/he.json";
import ar from "@/lib/i18n/dictionaries/ar.json";
import en from "@/lib/i18n/dictionaries/en.json";
import { isInAppBrowser, isIosDevice, isStandaloneMode, resolveInstallMode, type InstallEnv } from "@/lib/pwa/install-core";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const env = (o: Partial<InstallEnv>): InstallEnv => ({
  userAgent: DESKTOP, platform: "Win32", maxTouchPoints: 0, standaloneMedia: false, navigatorStandalone: false, ...o,
});

describe("install detection", () => {
  it("recognises iPhone and iPadOS (Mac UA + touch)", () => {
    expect(isIosDevice({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: DESKTOP, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: DESKTOP, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(isIosDevice({ userAgent: ANDROID, platform: "Linux armv8l", maxTouchPoints: 5 })).toBe(false);
  });
  it("detects in-app browsers", () => {
    expect(isInAppBrowser(`${IPHONE} [FBAN/FBIOS;FBAV/450]`)).toBe(true);
    expect(isInAppBrowser(`${IPHONE} Instagram 320`)).toBe(true);
    expect(isInAppBrowser(IPHONE)).toBe(false);
  });
  it("detects installed (standalone) mode on both engines", () => {
    expect(isStandaloneMode({ standaloneMedia: true, navigatorStandalone: false })).toBe(true);
    expect(isStandaloneMode({ standaloneMedia: false, navigatorStandalone: true })).toBe(true);
    expect(isStandaloneMode({ standaloneMedia: false, navigatorStandalone: false })).toBe(false);
  });
});

describe("resolveInstallMode", () => {
  it("shows nothing before hydration", () => {
    expect(resolveInstallMode({ env: null, hasPrompt: true, installed: false })).toBe("none");
  });
  it("uses the native prompt when the browser provided one", () => {
    expect(resolveInstallMode({ env: env({ userAgent: ANDROID }), hasPrompt: true, installed: false })).toBe("native");
  });
  it("shows the iPhone steps on Safari for iOS", () => {
    expect(resolveInstallMode({ env: env({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 }), hasPrompt: false, installed: false })).toBe("ios");
  });
  it("offers nothing in iOS in-app browsers, desktop without a prompt, or once installed", () => {
    expect(resolveInstallMode({ env: env({ userAgent: `${IPHONE} Instagram 320`, platform: "iPhone", maxTouchPoints: 5 }), hasPrompt: false, installed: false })).toBe("none");
    expect(resolveInstallMode({ env: env({}), hasPrompt: false, installed: false })).toBe("none");
    expect(resolveInstallMode({ env: env({ userAgent: ANDROID }), hasPrompt: true, installed: true })).toBe("none");
    expect(resolveInstallMode({ env: env({ standaloneMedia: true, userAgent: ANDROID }), hasPrompt: true, installed: false })).toBe("none");
  });
});

describe("install translations", () => {
  const keys = ["install", "iosTitle", "iosStep1", "iosStep2", "iosStep3", "iosNote", "iosShareBtn", "installBenefit", "installedOk"] as const;
  for (const [name, d] of Object.entries({ he, ar, en })) {
    it(`${name} has every pwa key`, () => {
      for (const k of keys) expect((d.pwa as Record<string, string>)[k], `${name}:pwa.${k}`).toBeTruthy();
    });
  }
});
