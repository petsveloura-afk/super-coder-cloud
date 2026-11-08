"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { duplicateAutomationAction } from "@/app/[locale]/(dashboard)/automations/actions";
import { intelT } from "@/components/automations/intel-i18n";

/** Duplicates an automation (the copy starts OFF) and opens it. */
export function DuplicateAutomationButton({ id, compact }: { id: string; compact?: boolean }) {
  const { t, locale } = useI18n();
  const it = intelT(locale);
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size={compact ? "sm" : "md"}
      loading={pending}
      aria-label={it("o.duplicate")}
      title={it("o.duplicate")}
      onClick={() =>
        start(async () => {
          const res = await duplicateAutomationAction({ locale, id });
          if (res.error) {
            toast.error(t(res.error));
            return;
          }
          toast.success(it("o.duplicated"));
          if (res.data?.id) router.push(`/${locale}/automations/${res.data.id}`);
          else router.refresh();
        })
      }
    >
      <Copy className="h-4 w-4" />
      {compact ? null : <span>{it("o.duplicate")}</span>}
    </Button>
  );
}
