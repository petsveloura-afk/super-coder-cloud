"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { duplicateSiteAction } from "@/app/[locale]/(dashboard)/websites/actions";

/** Wave 31 — one click: a new draft copy of the site, opened for editing. */
export function DuplicateSite({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const fd = new FormData();
          fd.set("locale", locale);
          fd.set("id", id);
          const r = await duplicateSiteAction(fd);
          if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
          toast.success(t("websites.duplicated"));
          router.push(`/${locale}/websites/${r.data.id}`);
        })
      }
      className="inline-flex items-center gap-1 text-sm text-accent hover:underline disabled:opacity-50"
      data-testid="site-duplicate"
    >
      <Copy className="h-3.5 w-3.5" /> {t("websites.duplicate")}
    </button>
  );
}
