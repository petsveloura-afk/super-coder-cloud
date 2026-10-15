"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production only. Fails silently on
 * browsers without SW support (the app works fully without it).
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(
      (reg) => {
        // Activate updated workers on next navigation.
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          w?.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) w.postMessage("SKIP_WAITING");
          });
        });
      },
      () => undefined,
    );
  }, []);
  return null;
}
