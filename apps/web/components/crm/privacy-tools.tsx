"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Eraser } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { eraseContactAction } from "@/app/[locale]/(dashboard)/crm/privacy-actions";

/** Spec I4 — personal data export (JSON) and anonymization ("right to be forgotten") for one contact. */
export function PrivacyTools({ id, canExport, canErase }: { id: string; canExport: boolean; canErase: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  if (!canExport && !canErase) return null;
  return (
    <>
      {canExport ? (
        <a href={`/api/v1/contacts/${id}/privacy`} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line px-3 text-sm hover:bg-surface-hover" data-testid="privacy-export">
          <Download className="h-4 w-4" /> {t("privacy.export")}
        </a>
      ) : null}
      {canErase ? (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={t("privacy.eraseTitle")}
          description={t("privacy.eraseBody")}
          trigger={
            <Button variant="ghost" className="text-danger" data-testid="privacy-erase">
              <Eraser className="h-4 w-4" /> {t("privacy.erase")}
            </Button>
          }
        >
          <div className="space-y-3">
            <label className="block space-y-1 text-[13px]">
              <span className="font-medium text-muted">{t("privacy.typeErase")}</span>
              <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" placeholder="ERASE" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" disabled={confirm !== "ERASE"} loading={pending} onClick={() => start(async () => { const r = await eraseContactAction({ locale, id, confirm }); if (r.error) return void toast.error(t(r.error)); toast.success(t(r.message ?? "privacy.erased")); setOpen(false); router.refresh(); })}>
                {t("privacy.eraseNow")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
