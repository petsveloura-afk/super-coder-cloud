"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";

/** Shows the result of the Google / Microsoft sign-in (?mail=connected|failed|…) once, then cleans the URL. */
export function IntegrationsNotice() {
  const { t, locale } = useI18n();
  const sp = useSearchParams();
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    const mail = sp.get("mail");
    if (!mail || done.current) return;
    done.current = true;
    const detail = sp.get("detail") ?? "";
    if (mail === "connected") toast.success(t("integrations.mail.connected"));
    else if (mail === "cancelled") toast(t("integrations.mail.cancelled"));
    else if (mail === "not_configured") toast.error(t("integrations.mail.oauthNotConfigured"));
    else if (mail === "forbidden") toast.error(t("errors.forbidden"));
    else toast.error(t("integrations.mail.oauthFailed", { detail }));
    router.replace(`/${locale}/integrations`);
  }, [sp, t, router, locale]);
  return null;
}
