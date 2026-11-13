"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MousePointerClick } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Card } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { setMetaModeAction } from "@/app/[locale]/(dashboard)/admin/meta-mode-actions";

/**
 * Round 16 — platform admin: how businesses connect Facebook + Instagram, in one switch.
 * Switching never disconnects anyone: both kinds of connection keep working side by side.
 */
export function MetaModeCard({ mode, counts, platformReady }: { mode: "platform" | "own_app"; counts: { platform: number; own: number }; platformReady: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (m: "platform" | "own_app") => {
    if (m === mode) return;
    setBusy(m);
    const r = await setMetaModeAction({ locale, mode: m });
    setBusy(null);
    if (r.error) return toast.error(t(r.error));
    toast.success(t(r.message ?? "common.saved"));
    router.refresh();
  };
  const opt = (m: "platform" | "own_app", Icon: typeof KeyRound, n: number) => (
    <button
      type="button"
      onClick={() => pick(m)}
      aria-pressed={mode === m}
      disabled={busy !== null}
      className={cn("flex min-w-0 flex-1 items-start gap-3 rounded-2xl border p-3 text-start transition", mode === m ? "border-accent bg-accent-soft/50 shadow-sm" : "border-line hover:bg-surface-hover")}
      data-testid={`meta-mode-${m}`}
    >
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", mode === m ? "bg-accent-solid text-accent-fg" : "bg-elevated")}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-semibold">
          {t(`metaMode.${m}.title`)}
          {mode === m ? <Badge tone="success">{t("metaMode.active")}</Badge> : null}
          {busy === m ? <span className="text-[11.5px] text-subtle">…</span> : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{t(`metaMode.${m}.body`)}</span>
        <span className="mt-1 block text-[11.5px] text-subtle">{t("metaMode.connected", { n })}</span>
      </span>
    </button>
  );
  return (
    <Card className="mb-4 space-y-3 p-4" data-testid="meta-mode-card">
      <div>
        <h2 className="font-bold">{t("metaMode.title")}</h2>
        <p className="text-[12.5px] text-muted">{t("metaMode.subtitle")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {opt("own_app", KeyRound, counts.own)}
        {opt("platform", MousePointerClick, counts.platform)}
      </div>
      {!platformReady ? <p className="rounded-xl bg-warning/10 px-3 py-2 text-[12px] text-warning">{t("metaMode.platformNotReady")}</p> : null}
      <p className="text-[11.5px] text-subtle">{t("metaMode.keep")}</p>
    </Card>
  );
}
