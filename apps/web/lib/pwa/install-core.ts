/**
 * "Add to home screen" — pure detection logic (no DOM access, fully unit-testable).
 * The browser-facing wiring lives in components/layout/install-app.tsx.
 */
export interface InstallEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** matchMedia("(display-mode: standalone)").matches */
  standaloneMedia: boolean;
  /** navigator.standalone (iOS Safari only) */
  navigatorStandalone: boolean;
}

/** iPhone / iPad / iPod, including iPadOS which reports itself as a Mac with touch. */
export function isIosDevice(env: Pick<InstallEnv, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (/iphone|ipad|ipod/i.test(env.userAgent)) return true;
  return env.platform === "MacIntel" && env.maxTouchPoints > 1;
}

/** Facebook / Instagram / TikTok / LINE in-app browsers: their share sheet has no "Add to Home Screen". */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Line\/|Snapchat|Messenger/i.test(userAgent);
}

/** The app is already running as an installed app. */
export function isStandaloneMode(env: Pick<InstallEnv, "standaloneMedia" | "navigatorStandalone">): boolean {
  return env.standaloneMedia || env.navigatorStandalone;
}

/**
 * native → the browser gave us an install prompt (Chrome, Edge, Samsung Internet, Android…)
 * ios    → no prompt API, show the "Share → Add to Home Screen" steps
 * none   → nothing to offer (already installed, unsupported browser, in-app browser, not hydrated yet)
 */
export type InstallMode = "native" | "ios" | "none";

export function resolveInstallMode(input: { env: InstallEnv | null; hasPrompt: boolean; installed: boolean }): InstallMode {
  const { env, hasPrompt, installed } = input;
  if (!env || installed || isStandaloneMode(env)) return "none";
  if (hasPrompt) return "native";
  if (isIosDevice(env) && !isInAppBrowser(env.userAgent)) return "ios";
  return "none";
}

/* ---------------------------------------------------------------- wave 48 — smarter install guidance (additive) */

export function isAndroidDevice(userAgent: string): boolean {
  return /android/i.test(userAgent);
}

export function isMobileDevice(env: Pick<InstallEnv, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  return isIosDevice(env) || isAndroidDevice(env.userAgent) || /mobile/i.test(env.userAgent);
}

/**
 * Richer than resolveInstallMode (which stays as is): it also covers the cases where the browser gives no prompt,
 * so the person still gets the right instructions instead of nothing.
 *   inapp           → Facebook / Instagram / TikTok in-app browser: open the page in Chrome / Safari first
 *   android_manual  → Android browser without a prompt yet: ⋮ menu → "Install app" / "Add to Home screen"
 *   desktop_manual  → desktop Chrome / Edge without a prompt yet: the install icon in the address bar
 */
export type InstallHint = InstallMode | "inapp" | "android_manual" | "desktop_manual";

export function resolveInstallHint(input: { env: InstallEnv | null; hasPrompt: boolean; installed: boolean }): InstallHint {
  const base = resolveInstallMode(input);
  if (base !== "none") return base;
  const { env, installed } = input;
  if (!env || installed || isStandaloneMode(env)) return "none";
  if (isInAppBrowser(env.userAgent)) return "inapp";
  if (isAndroidDevice(env.userAgent)) return "android_manual";
  if (/Chrome\/|Edg\//.test(env.userAgent) && !isMobileDevice(env)) return "desktop_manual";
  return "none";
}

/** The banner shows again this long after "not now". */
export const INSTALL_SNOOZE_MS = 7 * 24 * 3_600_000;

/** Show the install banner: something useful to offer, and not snoozed recently. */
export function shouldShowInstallBanner(input: { hint: InstallHint; dismissedAt: number | null; now: number }): boolean {
  if (input.hint === "none") return false;
  if (input.dismissedAt && input.now - input.dismissedAt < INSTALL_SNOOZE_MS) return false;
  return true;
}
