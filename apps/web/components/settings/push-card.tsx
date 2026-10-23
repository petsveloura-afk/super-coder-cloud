"use client";

import { useEffect, useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card } from "@/components/ui/primitives";
import { subscribePushAction, testPushAction, unsubscribePushAction } from "@/app/[locale]/(dashboard)/settings/push-actions";

function keyToBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob((b64u + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Wave 17 — notifications on this phone / computer (also when the app is closed). */
export function PushCard({ vapidKey }: { vapidKey: string | null }) {
  const { t, locale } = useI18n();
  const [supported, setSupported] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const ok = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    // async: no synchronous setState inside the effect
    void Promise.resolve().then(() => setSupported(ok));
    if (!ok) return;
    navigator.serviceWorker.getRegistration("/").then(
      (reg) => reg?.pushManager.getSubscription().then((s) => setEndpoint(s?.endpoint ?? null)),
      () => undefined,
    );
  }, []);

  if (!vapidKey) return null;

  const enable = () =>
    start(async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          toast.error(t("push.denied"));
          return;
        }
        const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
        await navigator.serviceWorker.ready;
        const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(vapidKey) }));
        const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
        const res = await subscribePushAction({ locale, sub: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }, userAgent: navigator.userAgent });
        if (res.error) toast.error(t(res.error));
        else {
          setEndpoint(sub.endpoint);
          toast.success(t(res.message ?? "push.enabled"));
        }
      } catch {
        toast.error(t("push.failed"));
      }
    });

  const disable = () =>
    start(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await unsubscribePushAction({ locale, endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setEndpoint(null);
        toast.success(t("push.disabled"));
      } catch {
        toast.error(t("push.failed"));
      }
    });

  return (
    <Card className="space-y-3 p-5" data-testid="push-card">
      <h2 className="flex items-center gap-2 font-semibold">
        <BellRing className="h-4 w-4 text-accent" /> {t("push.title")}
      </h2>
      <p className="text-[13px] text-muted">{t("push.hint")}</p>
      {!supported ? (
        <p className="text-[12.5px] text-subtle">{t("push.unsupported")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {endpoint ? (
            <>
              <Button
                variant="secondary"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await testPushAction({ locale });
                    if (r.error) toast.error(t(r.error));
                    else toast.success(t(r.message ?? "push.testSent"));
                  })
                }
              >
                {t("push.test")}
              </Button>
              <Button variant="ghost" loading={pending} onClick={disable}>
                {t("push.disable")}
              </Button>
            </>
          ) : (
            <Button loading={pending} onClick={enable}>
              <BellRing className="h-4 w-4" /> {t("push.enable")}
            </Button>
          )}
        </div>
      )}
      <p className="text-[12px] text-subtle">{t("push.iosNote")}</p>
    </Card>
  );
}
