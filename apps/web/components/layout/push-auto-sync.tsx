"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/client";
import { ensureSubscription, pushSupported, subPayload } from "@/lib/push/client";
import { subscribePushAction } from "@/app/[locale]/(dashboard)/settings/push-actions";

/**
 * Push fix (additive): "once I allowed it, it works". When notifications are already allowed on this device, every new session makes
 * sure the device holds a valid subscription for the current server key and that the server knows it (a subscription the server
 * removed, one made with an old key, or one made while another workspace was open are all healed silently). Never prompts.
 */
export function PushAutoSync({ vapidKey }: { vapidKey: string | null }) {
  const { locale } = useI18n();
  useEffect(() => {
    if (!vapidKey || !pushSupported() || Notification.permission !== "granted") return;
    let done = false;
    try {
      done = sessionStorage.getItem("scc-push-sync") === vapidKey.slice(0, 16);
    } catch {
      /* storage blocked — sync anyway */
    }
    if (done) return;
    const id = window.setTimeout(() => {
      ensureSubscription(vapidKey)
        .then((sub) => subscribePushAction({ locale, sub: subPayload(sub), userAgent: navigator.userAgent }))
        .then((r) => {
          if (r && !r.error) {
            try {
              sessionStorage.setItem("scc-push-sync", vapidKey.slice(0, 16));
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearTimeout(id);
  }, [vapidKey, locale]);
  return null;
}
