"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkPlus, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { isActiveView, viewHref, type ViewEntity } from "@/lib/views-core";
import { deleteViewAction, saveViewAction } from "@/app/[locale]/(dashboard)/views-actions";

export interface SavedViewRow {
  id: string;
  name: string;
  filters: Record<string, string>;
  shared: boolean;
  mine: boolean;
}

/** Spec B4 — saved views as chips above a list: one click restores filters; save the current filters in a click. */
export function SavedViews({ entity, base, views, current }: { entity: ViewEntity; base: string; views: SavedViewRow[]; current: Record<string, string | undefined> }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [pending, start] = useTransition();
  const hasFilters = Object.entries(current).some(([k, v]) => k !== "page" && typeof v === "string" && v);
  const save = () =>
    start(async () => {
      const filters = Object.fromEntries(Object.entries(current).filter(([k, v]) => k !== "page" && typeof v === "string" && v)) as Record<string, string>;
      const r = await saveViewAction({ locale, entity, name, filters, shared });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "views.saved"));
      setOpen(false);
      setName("");
      router.refresh();
    });
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5" data-testid="saved-views">
      <Bookmark className="h-4 w-4 text-subtle" aria-hidden />
      {views.map((v) => (
        <span key={v.id} className={cn("inline-flex items-center rounded-full border text-[12.5px]", isActiveView(v.filters, current) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted")}>
          <Link href={`/${locale}${viewHref(base, v.filters)}`} className="inline-flex items-center gap-1 px-3 py-1">
            {v.shared ? <Share2 className="h-3 w-3" aria-label={t("views.shared")} /> : null}
            {v.name}
          </Link>
          {v.mine ? (
            <button type="button" className="pe-2 ps-0.5 text-subtle hover:text-danger" aria-label={t("views.delete")} disabled={pending} onClick={() => start(async () => { const r = await deleteViewAction({ locale, id: v.id, entity }); if (r.error) toast.error(t(r.error)); else router.refresh(); })}>
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      ))}
      {open ? (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Input className="h-8 w-40" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("views.namePh")} aria-label={t("views.name")} dir="auto" autoFocus />
          <label className="inline-flex items-center gap-1 text-[12px] text-muted">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t("views.shareTeam")}
          </label>
          <Button size="sm" disabled={!name.trim() || pending} onClick={save}>
            {t("common.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
        </span>
      ) : hasFilters ? (
        <button type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1 text-[12.5px] text-accent hover:bg-surface-hover" onClick={() => setOpen(true)} data-testid="view-save">
          <BookmarkPlus className="h-3.5 w-3.5" /> {t("views.saveCurrent")}
        </button>
      ) : views.length ? null : (
        <span className="text-[12px] text-subtle">{t("views.hint")}</span>
      )}
    </div>
  );
}
