"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Eye, EyeOff, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { bulkSitesAction } from "@/app/[locale]/(dashboard)/websites/actions";
import { siteSelection, useSiteSelection } from "./selection-store";

/** Wave 32 — the tick box on a site card. */
export function SiteSelectBox({ id, label }: { id: string; label: string }) {
  const selected = useSiteSelection();
  return <input type="checkbox" checked={selected.includes(id)} onChange={() => siteSelection.toggle(id)} aria-label={label} className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]" data-testid="site-select" />;
}

/** Wave 32 — manage many sites at once: publish, unpublish, duplicate, delete. */
export function SitesBulkBar({ allIds }: { allIds: string[] }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const selected = useSiteSelection();
  const [pending, start] = useTransition();
  const run = (op: "publish" | "unpublish" | "duplicate" | "delete") => {
    if (op === "delete" && !window.confirm(t("websites.bulk.confirmDelete", { count: selected.length }))) return;
    start(async () => {
      const r = await bulkSitesAction({ locale, ids: selected, op });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      const { done, failed, limited } = r.data;
      if (failed || limited) toast.warning(t("websites.bulk.partial", { done, failed: failed + limited }));
      else toast.success(t("websites.bulk.done", { count: done }));
      siteSelection.clear();
      router.refresh();
    });
  };
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2.5" data-testid="sites-bulk-bar">
      <button type="button" className="rounded-lg px-2 py-1 text-[12.5px] text-accent hover:bg-accent-soft" onClick={() => siteSelection.set(selected.length === allIds.length ? [] : allIds)}>
        {t(selected.length === allIds.length ? "websites.bulk.clear" : "websites.bulk.selectAll")}
      </button>
      {selected.length ? (
        <>
          <span className="text-[12.5px] font-medium">{t("websites.bulk.selected", { count: selected.length })}</span>
          <span className="flex-1" />
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("publish")}>
            <Eye className="h-3.5 w-3.5" /> {t("websites.bulk.publish")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("unpublish")}>
            <EyeOff className="h-3.5 w-3.5" /> {t("websites.bulk.unpublish")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("duplicate")}>
            <Copy className="h-3.5 w-3.5" /> {t("websites.bulk.duplicate")}
          </Button>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("delete")}>
            <Trash2 className="h-3.5 w-3.5" /> {t("websites.bulk.delete")}
          </Button>
          <button type="button" aria-label={t("websites.bulk.clear")} className="rounded-lg p-1 text-muted hover:bg-surface-hover" onClick={() => siteSelection.clear()}>
            <X className="h-4 w-4" />
          </button>
        </>
      ) : (
        <span className="text-[12.5px] text-muted">{t("websites.bulk.hint")}</span>
      )}
    </div>
  );
}
