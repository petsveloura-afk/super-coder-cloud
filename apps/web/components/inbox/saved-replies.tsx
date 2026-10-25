"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { MessageSquareText, Plus, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";
import { fillReply, filterReplies, type SavedReply } from "@/lib/inbox/saved-replies-core";
import {
  addStarterRepliesAction,
  createSavedReplyAction,
  deleteSavedReplyAction,
  listSavedRepliesAction,
  countSavedReplyUseAction,
} from "@/app/[locale]/(dashboard)/inbox/saved-actions";

/**
 * Wave 24 — saved replies above the reply box: pick one, it lands in the text box ready to send
 * (via the "scc:fill-reply" event the reply box already listens to). {name}/{business} are filled in.
 */
export function SavedReplies({ conversationId, locale, customerName, businessName }: { conversationId: string; locale: string; customerName: string | null; businessName: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [items, setItems] = useState<SavedReply[] | null>(null);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ title: "", body: "", shortcut: "" });
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || items !== null) return;
    let alive = true;
    listSavedRepliesAction({ locale }).then((r) => alive && setItems(r.data ?? []));
    return () => {
      alive = false;
    };
  }, [open, items, locale]);

  const shown = useMemo(() => filterReplies(items ?? [], q), [items, q]);

  function pick(r: SavedReply) {
    const text = fillReply(r.body, { name: customerName, business: businessName });
    window.dispatchEvent(new CustomEvent("scc:fill-reply", { detail: { conversationId, text } }));
    setItems((cur) => (cur ?? []).map((x) => (x.id === r.id ? { ...x, use_count: x.use_count + 1 } : x)));
    void countSavedReplyUseAction({ id: r.id });
    setQ("");
    setOpen(false);
  }

  function save() {
    start(async () => {
      const res = await createSavedReplyAction({ locale, ...form });
      if (res.error) return void toast.error(t(res.error));
      toast.success(t("inbox.saved.added"));
      if (res.data) setItems((cur) => [res.data as SavedReply, ...(cur ?? [])]);
      setForm({ title: "", body: "", shortcut: "" });
      setQ("");
      setAdding(false);
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteSavedReplyAction({ locale, id });
      if (res.error) return void toast.error(t(res.error));
      setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
    });
  }

  function starters() {
    start(async () => {
      const res = await addStarterRepliesAction({ locale });
      if (res.error) return void toast.error(t(res.error));
      setItems(res.data ?? []);
    });
  }

  return (
    <div className="border-t border-line px-3 pt-2" data-testid="saved-replies">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[12.5px] font-medium text-muted hover:border-accent hover:text-accent">
        <MessageSquareText className="h-3.5 w-3.5" /> {t("inbox.saved.button")}
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-line bg-surface p-2 shadow-sm" role="dialog" aria-label={t("inbox.saved.button")}>
          <div className="flex items-center gap-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("inbox.saved.search")} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-accent" />
            <button type="button" onClick={() => setAdding((v) => !v)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-accent hover:bg-accent-soft" data-testid="saved-add-toggle">
              <Plus className="h-3.5 w-3.5" /> {t("inbox.saved.new")}
            </button>
            <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-hover">
              <X className="h-4 w-4" />
            </button>
          </div>
          {adding ? (
            <div className="mt-2 grid gap-2 rounded-lg bg-surface-hover/60 p-2">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t("inbox.saved.titleField")} maxLength={80} className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[13px]" data-testid="saved-title" />
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={t("inbox.saved.bodyField")} maxLength={4000} rows={3} className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px]" data-testid="saved-body" />
              <div className="flex items-center gap-2">
                <input value={form.shortcut} onChange={(e) => setForm({ ...form, shortcut: e.target.value })} placeholder={t("inbox.saved.shortcutField")} maxLength={25} className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[13px]" />
                <Button type="button" size="sm" onClick={save} disabled={pending || !form.title.trim() || !form.body.trim()} data-testid="saved-save">
                  {t("common.save")}
                </Button>
              </div>
              <p className="text-[11.5px] text-subtle">{t("inbox.saved.hint")}</p>
            </div>
          ) : null}
          {items === null ? (
            <p className="p-3 text-center text-[12.5px] text-subtle">…</p>
          ) : items.length === 0 ? (
            <div className="p-3 text-center">
              <p className="text-[12.5px] text-muted">{t("inbox.saved.empty")}</p>
              <button type="button" onClick={starters} disabled={pending} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline" data-testid="saved-starters">
                <Sparkles className="h-3.5 w-3.5" /> {t("inbox.saved.starters")}
              </button>
            </div>
          ) : (
            <ul className="mt-2 max-h-56 divide-y divide-line overflow-y-auto">
              {shown.map((r) => (
                <li key={r.id} className="flex items-start gap-2 py-1.5">
                  <button type="button" onClick={() => pick(r)} className="min-w-0 flex-1 rounded-lg px-2 py-1 text-start hover:bg-accent-soft" data-testid="saved-item">
                    <span className="flex items-center gap-2 text-[13px] font-medium">
                      {r.title}
                      {r.shortcut ? <span className="rounded bg-surface-hover px-1.5 text-[11px] text-subtle">/{r.shortcut}</span> : null}
                    </span>
                    <span className="line-clamp-2 text-[12px] text-muted" dir="auto">{fillReply(r.body, { name: customerName, business: businessName })}</span>
                  </button>
                  <button type="button" onClick={() => remove(r.id)} disabled={pending} aria-label={t("common.delete")} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-subtle hover:bg-danger/10 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {shown.length === 0 ? <li className="p-3 text-center text-[12.5px] text-subtle">{t("inbox.saved.noMatch")}</li> : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
