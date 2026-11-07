"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckSquare, Eraser, ListChecks, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Keep lists clean (additive). Every user decides what they still want to see:
 *   • "Select" → tick items (or "select all") → hide / delete the ticked ones;
 *   • "Clear all" → hide everything that is there now (new items still show up);
 *   • "Show all again" → undo the hiding.
 * Hiding is a personal view on this device (localStorage) — the business's records and audit trail are never deleted by it.
 * Lists whose items really belong to the user (their own notifications) pass `onDelete` and delete for real instead.
 */
export function readCleanup(key: string): { hidden: string[]; before: number } {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as { hidden?: unknown; before?: unknown }) : {};
    return { hidden: Array.isArray(v.hidden) ? v.hidden.map(String).slice(-2000) : [], before: Number(v.before) || 0 };
  } catch {
    return { hidden: [], before: 0 };
  }
}

function writeCleanup(key: string, v: { hidden: string[]; before: number }) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ hidden: v.hidden.slice(-2000), before: v.before }));
    window.dispatchEvent(new Event("scc-cleanup"));
  } catch {
    /* private mode — the view simply is not remembered */
  }
}

/** pure: is an item visible under the user's cleanup choices */
export function visibleAfterCleanup(item: { id: string; at: number }, state: { hidden: string[]; before: number }): boolean {
  return !state.hidden.includes(item.id) && !(state.before && item.at <= state.before);
}

export function useCleanup(key: string) {
  const [state, setState] = useState<{ hidden: string[]; before: number }>({ hidden: [], before: 0 });
  useEffect(() => {
    const load = () => setState(readCleanup(key));
    const id = setTimeout(load, 0);
    window.addEventListener("scc-cleanup", load);
    window.addEventListener("storage", load);
    return () => {
      clearTimeout(id);
      window.removeEventListener("scc-cleanup", load);
      window.removeEventListener("storage", load);
    };
  }, [key]);
  const hide = useCallback((ids: string[]) => writeCleanup(key, { ...readCleanup(key), hidden: [...new Set([...readCleanup(key).hidden, ...ids])] }), [key]);
  const clearAll = useCallback((upTo: number) => writeCleanup(key, { hidden: [], before: Math.max(upTo, readCleanup(key).before) }), [key]);
  const restore = useCallback(() => writeCleanup(key, { hidden: [], before: 0 }), [key]);
  const visible = useCallback((item: { id: string; at: number }) => visibleAfterCleanup(item, state), [state]);
  const active = state.hidden.length > 0 || state.before > 0;
  return { state, hide, clearAll, restore, visible, active };
}

/** selection state for a list */
export function useSelection(ids: string[]) {
  const [on, setOn] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const idsKey = ids.join("|");
  const valid = useMemo(() => new Set(idsKey ? idsKey.split("|") : []), [idsKey]);
  const selected = useMemo(() => [...sel].filter((x) => valid.has(x)), [sel, valid]);
  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = selected.length > 0 && selected.length === valid.size;
  const toggleAll = () => setSel(all ? new Set() : new Set(valid));
  const stop = () => {
    setOn(false);
    setSel(new Set());
  };
  return { on, start: () => setOn(true), stop, selected, isSelected: (id: string) => sel.has(id) && valid.has(id), toggle, all, toggleAll };
}

const chip = "inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12px] font-medium text-muted transition hover:bg-surface-hover hover:text-fg disabled:opacity-50";

export function CleanupBar({
  count,
  selection,
  hiddenActive,
  onHideSelected,
  onClearAll,
  onRestore,
  deleteMode = false,
  busy = false,
  extra,
}: {
  count: number;
  selection: ReturnType<typeof useSelection>;
  hiddenActive?: boolean;
  onHideSelected: (ids: string[]) => void;
  onClearAll: () => void;
  onRestore?: () => void;
  /** true = the actions delete for real (the user's own items) — the labels say "delete" */
  deleteMode?: boolean;
  busy?: boolean;
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const [confirmAll, setConfirmAll] = useState(false);
  if (!count && !hiddenActive) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" data-testid="cleanup-bar">
      {count ? (
        selection.on ? (
          <>
            <button type="button" className={chip} onClick={selection.toggleAll} data-testid="cleanup-select-all">
              {selection.all ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />} {t("cleanup.selectAll")}
            </button>
            <button
              type="button"
              className={cn(chip, "border-danger/40 text-danger hover:text-danger")}
              disabled={!selection.selected.length || busy}
              onClick={() => {
                onHideSelected(selection.selected);
                selection.stop();
              }}
              data-testid="cleanup-remove-selected"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t(deleteMode ? "cleanup.deleteSelected" : "cleanup.hideSelected", { n: selection.selected.length })}
            </button>
            <button type="button" className={chip} onClick={selection.stop} aria-label={t("common.cancel")}>
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <>
            <button type="button" className={chip} onClick={selection.start} data-testid="cleanup-select">
              <ListChecks className="h-3.5 w-3.5" /> {t("cleanup.select")}
            </button>
            {confirmAll ? (
              <>
                <button
                  type="button"
                  className={cn(chip, "border-danger/40 text-danger hover:text-danger")}
                  disabled={busy}
                  onClick={() => {
                    onClearAll();
                    setConfirmAll(false);
                  }}
                  data-testid="cleanup-clear-confirm"
                >
                  <Eraser className="h-3.5 w-3.5" /> {t(deleteMode ? "cleanup.deleteAllConfirm" : "cleanup.clearAllConfirm", { n: count })}
                </button>
                <button type="button" className={chip} onClick={() => setConfirmAll(false)} aria-label={t("common.cancel")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <button type="button" className={chip} onClick={() => setConfirmAll(true)} data-testid="cleanup-clear-all">
                <Eraser className="h-3.5 w-3.5" /> {t(deleteMode ? "cleanup.deleteAll" : "cleanup.clearAll")}
              </button>
            )}
          </>
        )
      ) : null}
      {hiddenActive && onRestore ? (
        <button type="button" className={chip} onClick={onRestore} data-testid="cleanup-restore">
          <RotateCcw className="h-3.5 w-3.5" /> {t("cleanup.restore")}
        </button>
      ) : null}
      {extra}
    </div>
  );
}

/** the tick box shown next to an item while selecting */
export function SelectTick({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent-solid)]" checked={checked} onChange={onChange} aria-label={label} />;
}
