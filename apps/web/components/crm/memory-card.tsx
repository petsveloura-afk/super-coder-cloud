"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Brain, Plus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { addMemoryAction, deleteMemoryAction } from "@/app/[locale]/(dashboard)/crm/memory-actions";

export interface MemoryItem {
  id: string;
  fact: string;
  kind: string;
  source: string;
  created_at: string;
}

/** Wave 54 — what the AI agents remember about this customer (all channels), with add / remove for the team. */
export function MemoryCard({ contactId, items, canWrite }: { contactId: string; items: MemoryItem[]; canWrite: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [fact, setFact] = useState("");
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      const r = await addMemoryAction({ locale, contactId, fact });
      if (r.error) return void toast.error(t(r.error));
      setFact("");
      toast.success(t("memory.saved"));
      router.refresh();
    });
  const remove = (id: string) =>
    start(async () => {
      const r = await deleteMemoryAction({ locale, id, contactId });
      if (r.error) return void toast.error(t(r.error));
      router.refresh();
    });
  return (
    <div className="space-y-3 p-4 sm:p-5" data-testid="memory-card">
      {items.length ? (
        <ul className="stagger space-y-1.5">
          {items.map((m) => (
            <li key={m.id} className="group flex items-start gap-2.5 rounded-xl border border-line bg-surface px-3 py-2">
              <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg", m.source === "team" || m.source === "operator" ? "bg-teal-soft text-teal" : "bg-accent-soft text-accent")} title={t(`memory.source.${m.source}`)}>
                {m.source === "team" || m.source === "operator" ? <UserRound className="h-3.5 w-3.5" aria-hidden /> : <Bot className="h-3.5 w-3.5" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 text-[13px] leading-snug" dir="auto">
                {m.fact}
              </span>
              {canWrite ? (
                <button type="button" onClick={() => remove(m.id)} disabled={pending} className="shrink-0 rounded-lg p-1 text-subtle hover:bg-danger-soft hover:text-danger" aria-label={t("memory.remove")}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-muted">
          <Brain className="h-4 w-4" aria-hidden /> {t("memory.empty")}
        </p>
      )}
      {canWrite ? (
        <div className="flex gap-2">
          <Input value={fact} onChange={(e) => setFact(e.target.value)} maxLength={300} placeholder={t("memory.placeholder")} aria-label={t("memory.placeholder")} dir="auto" className="h-9 flex-1" onKeyDown={(e) => e.key === "Enter" && fact.trim().length >= 2 && add()} />
          <Button size="sm" variant="secondary" onClick={add} loading={pending} disabled={fact.trim().length < 2}>
            <Plus className="h-4 w-4" aria-hidden /> {t("memory.add")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
