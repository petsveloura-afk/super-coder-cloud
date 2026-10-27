"use client";

import { useSyncExternalStore } from "react";

/** Wave 32 — tiny shared selection (which site cards are ticked) for the bulk bar; no provider needed. */
const EMPTY: string[] = [];
let current = new Set<string>();
let snapshot: string[] = EMPTY;
const subs = new Set<() => void>();
const emit = () => {
  snapshot = current.size ? [...current] : EMPTY;
  subs.forEach((f) => f());
};
export const siteSelection = {
  toggle(id: string) {
    const n = new Set(current);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    current = n;
    emit();
  },
  set(ids: string[]) {
    current = new Set(ids);
    emit();
  },
  clear() {
    current = new Set();
    emit();
  },
};
export function useSiteSelection(): string[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => snapshot,
    () => EMPTY,
  );
}
