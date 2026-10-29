"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Download, PlusSquare, Share } from "lucide-react";
import { BellRing, Copy, ExternalLink, Maximize2, MoreVertical, Smartphone, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { resolveInstallMode, type InstallEnv, type InstallMode } from "@/lib/pwa/install-core";
import { resolveInstallHint, shouldShowInstallBanner, type InstallHint } from "@/lib/pwa/install-core";
import { cn } from "@/lib/utils";

/**
 * "Install app" — lets anyone who wants it add the app to their home screen.
 * - Chrome / Edge / Android: uses the browser's own install prompt (beforeinstallprompt).
 * - iPhone / iPad: shows the Share → "Add to Home Screen" steps (iOS has no prompt API).
 * - Already installed / unsupported / in-app browsers: renders nothing.
 * Additive: relies on the existing manifest + service worker, changes neither.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface Snapshot {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
  env: InstallEnv | null;
  helpOpen: boolean;
}

const INITIAL: Snapshot = { deferred: null, installed: false, env: null, helpOpen: false };
let snap: Snapshot = INITIAL;
const listeners = new Set<() => void>();

function update(patch: Partial<Snapshot>) {
  snap = { ...snap, ...patch };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => snap;
const getServerSnapshot = () => INITIAL;

function readEnv(): InstallEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent || "",
    platform: nav.platform || "",
    maxTouchPoints: nav.maxTouchPoints || 0,
    standaloneMedia: typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: nav.standalone === true,
  };
}

/**
 * iPhone / iPad: Apple has no API that adds an app to the home screen, so the closest thing is opening the
 * system share sheet directly (where "Add to Home Screen" is one tap away). Used by the button in the steps dialog.
 */
async function openIosShare() {
  try {
    await navigator.share({ url: window.location.href, title: document.title });
  } catch {
    /* cancelled, or the browser refused — the steps stay visible in the dialog */
  }
}

/** Opens the native prompt when the browser offered one, otherwise the iPhone steps. */
async function requestInstall() {
  const d = snap.deferred;
  if (!d) {
    update({ helpOpen: true });
    return;
  }
  update({ deferred: null }); // a captured prompt can be used once
  try {
    await d.prompt();
    const choice = await d.userChoice;
    if (choice.outcome === "accepted") update({ installed: true });
  } catch {
    /* the browser refused to show it — nothing to do */
  }
}

function useInstallMode(): InstallMode {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return resolveInstallMode({ env: s.env, hasPrompt: Boolean(s.deferred), installed: s.installed });
}

/** Mount once (locale layout). Captures the browser event early and hosts the iPhone help dialog. */
export function InstallAppCapture() {
  const { t } = useI18n();
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    update({ env: readEnv() });
    const onPrompt = (e: Event) => {
      e.preventDefault(); // we show our own button instead of the browser mini-bar
      update({ deferred: e as BeforeInstallPromptEvent });
    };
    const onInstalled = () => {
      update({ installed: true, deferred: null, helpOpen: false });
      toast.success(t("pwa.installedOk"));
    };
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)") : null;
    const onMode = () => update({ env: readEnv() });
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    mq?.addEventListener?.("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq?.removeEventListener?.("change", onMode);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable per locale; listeners must not re-register
  }, []);

  return (
    <Dialog open={s.helpOpen} onOpenChange={(open) => update({ helpOpen: open })} title={t("pwa.iosTitle")} description={t("pwa.installBenefit")}>
      <ol className="space-y-3 text-[14px] text-fg">
        <li className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Share className="h-4 w-4" aria-hidden /></span>
          <span className="pt-1">{t("pwa.iosStep1")}</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><PlusSquare className="h-4 w-4" aria-hidden /></span>
          <span className="pt-1">{t("pwa.iosStep2")}</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Download className="h-4 w-4" aria-hidden /></span>
          <span className="pt-1">{t("pwa.iosStep3")}</span>
        </li>
      </ol>
      <p className="mt-4 text-[12.5px] text-muted">{t("pwa.iosNote")}</p>
      {typeof navigator !== "undefined" && typeof navigator.share === "function" ? (
        <button
          type="button"
          onClick={() => void openIosShare()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[14px] font-semibold text-white"
          data-testid="install-ios-share-button"
        >
          <Share className="h-4 w-4" aria-hidden /> {t("pwa.iosShareBtn")}
        </button>
      ) : null}
    </Dialog>
  );
}

/** Header button. Hidden unless installing is actually possible. */
export function InstallAppButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const mode = useInstallMode();
  if (mode === "none") return null;
  return (
    <button
      type="button"
      onClick={() => void requestInstall()}
      className={cn("grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-hover hover:text-fg", className)}
      aria-label={t("pwa.install")}
      title={t("pwa.install")}
      data-testid="install-app-button"
    >
      <Download className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}

/** Item for the user menu (the way phones reach it). Must be rendered inside <DM.Content>. */
export function InstallAppMenuItem() {
  const { t } = useI18n();
  const mode = useInstallMode();
  if (mode === "none") return null;
  return (
    <>
      <DM.Separator className="my-1 h-px bg-line" />
      <DM.Item
        // let the menu close first so the dialog / browser prompt gets focus cleanly
        onSelect={() => window.setTimeout(() => void requestInstall(), 60)}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium text-accent outline-none data-[highlighted]:bg-accent-soft"
        data-testid="install-app-menu-item"
      >
        <Download className="h-4 w-4" aria-hidden /> {t("pwa.install")}
      </DM.Item>
    </>
  );
}

/* ---------------------------------------------------------------- wave 48 — smart install banner (additive) */

const SNOOZE_KEY = "scc.install.snoozedAt";

function readSnooze(): number | null {
  try {
    const v = Number(window.localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeSnooze(ts: number) {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(ts));
  } catch {
    /* private mode — the banner simply shows again next time */
  }
}

function useInstallHint(): InstallHint {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return resolveInstallHint({ env: s.env, hasPrompt: Boolean(s.deferred), installed: s.installed });
}

/**
 * A friendly card that explains the benefits and gives the right one-tap action for this exact device:
 * native prompt, iPhone steps, "open in your browser" for Facebook/Instagram in-app browsers,
 * Android ⋮ menu steps, or the desktop address-bar icon. "Not now" hides it for 7 days.
 */
export function InstallAppBanner({ className }: { className?: string }) {
  const { t } = useI18n();
  const hint = useInstallHint();
  const [snoozed, setSnoozed] = useState<boolean | undefined>(undefined);
  const [open, setOpen] = useState(false);
  // read the snooze once after hydration (time and storage are only read in effects / handlers)
  useEffect(() => {
    const at = readSnooze();
    const timer = window.setTimeout(() => setSnoozed(!shouldShowInstallBanner({ hint: "native", dismissedAt: at, now: Date.now() })), 0);
    return () => window.clearTimeout(timer);
  }, []);
  if (snoozed === undefined || snoozed || hint === "none") return null;

  const snooze = () => {
    writeSnooze(Date.now());
    setSnoozed(true);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("pwaPro.linkCopied"));
    } catch {
      toast.error(t("errors.generic"));
    }
  };
  const primary = () => {
    if (hint === "native" || hint === "ios") return void requestInstall();
    setOpen((v) => !v);
  };
  const steps: string[] =
    hint === "inapp"
      ? [t("pwaPro.inappStep1"), t("pwaPro.inappStep2"), t("pwaPro.inappStep3")]
      : hint === "android_manual"
        ? [t("pwaPro.androidStep1"), t("pwaPro.androidStep2"), t("pwaPro.androidStep3")]
        : hint === "desktop_manual"
          ? [t("pwaPro.desktopStep1"), t("pwaPro.desktopStep2")]
          : [];

  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-accent/30 bg-gradient-to-l from-accent-soft/60 via-surface to-surface p-4 shadow-sm", className)} data-testid="install-app-banner">
      <button type="button" onClick={snooze} className="absolute end-2 top-2 rounded-full p-1.5 text-muted hover:bg-surface-hover hover:text-fg" aria-label={t("pwaPro.notNow")}>
        <X className="h-4 w-4" />
      </button>
      <div className="flex flex-wrap items-center gap-4 pe-6">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-solid text-accent-fg shadow-md">
          <Smartphone className="h-6 w-6" aria-hidden />
        </span>
        <div className="min-w-[12rem] flex-1">
          <p className="text-[15px] font-semibold">{t("pwaPro.title")}</p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
            <li className="inline-flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-accent" aria-hidden /> {t("pwaPro.benefitFast")}</li>
            <li className="inline-flex items-center gap-1.5"><BellRing className="h-3.5 w-3.5 text-accent" aria-hidden /> {t("pwaPro.benefitPush")}</li>
            <li className="inline-flex items-center gap-1.5"><Maximize2 className="h-3.5 w-3.5 text-accent" aria-hidden /> {t("pwaPro.benefitFull")}</li>
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={primary} className="inline-flex items-center gap-2 rounded-xl bg-accent-solid px-4 py-2.5 text-[14px] font-semibold text-accent-fg shadow-sm transition hover:bg-accent-solid-hover" data-testid="install-app-banner-cta">
            {hint === "inapp" ? <ExternalLink className="h-4 w-4" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            {hint === "inapp" ? t("pwaPro.openInBrowser") : t("pwa.install")}
          </button>
          <button type="button" onClick={snooze} className="rounded-xl px-3 py-2.5 text-[13px] text-muted hover:bg-surface-hover">
            {t("pwaPro.notNow")}
          </button>
        </div>
      </div>
      {open && steps.length ? (
        <div className="mt-4 rounded-xl border border-line bg-surface p-3">
          <ol className="space-y-2.5 text-[13.5px]">
            {steps.map((st, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-[12px] font-semibold text-accent">
                  {hint === "android_manual" && i === 0 ? <MoreVertical className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <span className="pt-0.5">{st}</span>
              </li>
            ))}
          </ol>
          {hint === "inapp" ? (
            <button type="button" onClick={() => void copyLink()} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-[13px] hover:bg-surface-hover">
              <Copy className="h-4 w-4" aria-hidden /> {t("pwaPro.copyLink")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
