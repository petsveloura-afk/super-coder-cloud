"use client";

import { useEffect, useSyncExternalStore } from "react";
import * as DM from "@radix-ui/react-dropdown-menu";
import { Download, PlusSquare, Share } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { resolveInstallMode, type InstallEnv, type InstallMode } from "@/lib/pwa/install-core";
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
