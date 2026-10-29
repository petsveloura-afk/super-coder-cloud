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
