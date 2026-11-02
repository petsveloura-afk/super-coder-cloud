"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, Check, History, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { decideFactAction, saveFactAction } from "@/app/[locale]/(dashboard)/ai-team/facts-actions";
import { FACT_KINDS, currentOf, groupByKey, isStale, normalizeFact, openConflicts, resolveIncoming, type FactVersion } from "@/lib/team/business-facts-core";
import type { TeamFactsData } from "./types";

const day = (iso: string) => iso.slice(0, 10);

/**
 * Business facts (upgrade 7 / stage B): what the team knows as FACT — prices, hours, policies, contacts, offers — with the
 * version history, where each came from, whether the owner confirmed it, and the proposals waiting for the owner's decision.
 * Optimistic: a decision or a new value shows at once (the same rules as the server run in the browser); a server error
 * puts everything back and says so.
 */
export function FactsPanel({ facts, canManage, locale, now, onRefresh }: { facts: TeamFactsData; canManage: boolean; locale: string; now: number; onRefresh: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<FactVersion[]>(facts.rows);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", value: "", kind: "price" as (typeof FACT_KINDS)[number] });
  const [busy, setBusy] = useState(false);
  // after a refresh the server's rows replace the local (optimistic) ones
  const [seen, setSeen] = useState(facts.rows);
  if (seen !== facts.rows) {
    setSeen(facts.rows);
    setRows(facts.rows);
  }

  const byKey = useMemo(() => groupByKey(rows), [rows]);
  const current = useMemo(() => [...byKey.values()].map((v) => currentOf(v, now)).filter((x): x is FactVersion => !!x).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)), [byKey, now]);
  const conflicts = useMemo(() => openConflicts(rows, now), [rows, now]);

  const fail = (previous: FactVersion[], key: string) => {
    setRows(previous);
    toast.error(t(key));
  };

  const decide = async (id: string, accept: boolean) => {
    const previous = rows;
    const target = rows.find((r) => r.id === id);
    if (!target) return;
    const stamp = new Date(now).toISOString();
    // optimistic: the answer shows before the server replies
    setRows(
      rows.map((r) => {
        if (r.id === id) return accept ? { ...r, status: "current", owner_confirmed: true, valid_from: stamp } : { ...r, status: "rejected" };
        if (accept && r.fact_key === target.fact_key && r.status === "current") return { ...r, status: "superseded", valid_to: stamp };
        return r;
      }),
    );
    try {
      const r = await decideFactAction({ locale, id, accept });
      if (r.error) return fail(previous, r.error);
      toast.success(r.data?.line ?? t("common.saved"));
      onRefresh();
    } catch (e) {
      console.error("[ai-team] fact decision failed", e);
      fail(previous, "common.error");
    }
  };

  const add = async () => {
    const n = normalizeFact({ ...form, source: "owner" }, now);
    if ("rejected" in n) return toast.error(t("validation.invalid"));
    const previous = rows;
    const history = rows.filter((r) => r.fact_key === n.fact.fact_key);
    const res = resolveIncoming(history, n.fact, now);
    if (res.action === "duplicate" || res.action === "ignore") return toast.success(t("aiTeam.facts.same"));
    const stamp = new Date(now).toISOString();
    const temp: FactVersion = { ...n.fact, id: `temp-${now}`, status: "current", version: res.version, supersedes: res.action === "new_current" ? res.supersedesId : null, created_at: stamp };
    setRows([...rows.map((r) => (res.action === "new_current" && r.id === res.supersedesId ? { ...r, status: "superseded" as const, valid_to: stamp } : r)), temp]);
    setForm({ label: "", value: "", kind: form.kind });
    setBusy(true);
    try {
      const r = await saveFactAction({ locale, label: n.fact.label, value: n.fact.value, kind: n.fact.kind });
      if (r.error) {
        setForm({ label: form.label, value: form.value, kind: form.kind });
        return fail(previous, r.error);
      }
      toast.success(r.data?.line ?? t("common.saved"));
      onRefresh();
    } catch (e) {
      console.error("[ai-team] fact save failed", e);
      setForm({ label: form.label, value: form.value, kind: form.kind });
      fail(previous, "common.error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 p-5" data-testid="facts-panel">
      <div className="flex items-center gap-3">
        <BadgeCheck className="h-6 w-6 text-muted" />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold">{t("aiTeam.facts.title")}</h3>
          <p className="text-[12.5px] text-muted">{t("aiTeam.facts.about")}</p>
        </div>
      </div>

      {conflicts.length ? (
        <div className="space-y-2" data-testid="facts-conflicts">
          <h4 className="flex items-center gap-2 text-[12.5px] font-semibold">
            <TriangleAlert className="h-4 w-4 text-warning" /> {t("aiTeam.facts.waiting")}
          </h4>
          <ul className="space-y-2">
            {conflicts.map(({ proposed: p, current: c }) => (
              <li key={p.id} className="rounded-2xl border border-line p-3 text-[13px]">
                <div className="font-semibold">{p.label}</div>
                <div className="grid gap-1 text-[12.5px] sm:grid-cols-2">
                  <span>
                    <span className="text-subtle">{t("aiTeam.facts.now")}: </span>
                    {c ? `${c.value}${c.unit ? ` ${c.unit}` : ""}` : "—"}
                  </span>
                  <span>
                    <span className="text-subtle">{t("aiTeam.facts.suggested")}: </span>
                    {p.value}
                    {p.unit ? ` ${p.unit}` : ""}
                  </span>
                </div>
                <div className="mt-0.5 text-[11.5px] text-subtle">
                  {t(`aiTeam.facts.source.${p.source}`)}
                  {p.source_ref ? ` · ${p.source_ref.slice(0, 80)}` : ""} · {day(p.observed_at)} · {Math.round(p.confidence * 100)}%
                </div>
                {canManage ? (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => decide(p.id, true)} data-testid="fact-accept">
                      <Check className="h-4 w-4" /> {t("aiTeam.facts.accept")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => decide(p.id, false)} data-testid="fact-reject">
                      <X className="h-4 w-4" /> {t("aiTeam.facts.reject")}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="space-y-2">
        {current.map((f) => {
          const hist = [...(byKey.get(f.fact_key) ?? [])].sort((a, b) => b.version - a.version);
          const stale = isStale(f, now);
          return (
            <li key={f.id} className="rounded-2xl border border-line bg-surface p-3 text-[13px]" data-testid="fact-row">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                <Badge tone="neutral">{t(`aiTeam.facts.kind.${f.kind}`)}</Badge>
                <Badge tone={f.owner_confirmed ? "success" : "warning"}>{t(f.owner_confirmed ? "aiTeam.facts.confirmed" : "aiTeam.facts.unconfirmed")}</Badge>
                {stale ? <Badge tone="warning">{t("aiTeam.facts.stale")}</Badge> : null}
                <span className="text-subtle">
                  v{f.version} · {t(`aiTeam.facts.source.${f.source}`)} · {day(f.observed_at)} · {Math.round(f.confidence * 100)}%{f.valid_to ? ` · ${t("aiTeam.facts.until")} ${day(f.valid_to)}` : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{f.label}</span>
                <span>
                  {f.value}
                  {f.unit ? ` ${f.unit}` : ""}
                </span>
              </div>
              {hist.length > 1 ? (
                <button type="button" className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted hover:text-text" onClick={() => setOpen(open === f.fact_key ? null : f.fact_key)}>
                  <History className="h-3.5 w-3.5" /> {t("aiTeam.facts.history")} ({hist.length})
                </button>
              ) : null}
              {open === f.fact_key ? (
                <ol className="mt-2 space-y-1 border-s border-line ps-3 text-[12px] text-muted">
                  {hist.map((h) => (
                    <li key={h.id}>
                      v{h.version} · {h.value}
                      {h.unit ? ` ${h.unit}` : ""} · {t(`aiTeam.facts.status.${h.status}`)} · {day(h.valid_from)}
                      {h.valid_to ? ` → ${day(h.valid_to)}` : ""}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
        {!current.length ? <li className="rounded-2xl bg-elevated p-6 text-center text-[13px] text-muted">{t("aiTeam.facts.empty")}</li> : null}
      </ul>

      {canManage ? (
        <div className="space-y-2">
          <h4 className="text-[12.5px] font-semibold">{t("aiTeam.facts.addTitle")}</h4>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as (typeof FACT_KINDS)[number] })} className="sm:w-40" aria-label={t("aiTeam.facts.kindLabel")}>
              {FACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`aiTeam.facts.kind.${k}`)}
                </option>
              ))}
            </Select>
            <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t("aiTeam.facts.labelPh")} maxLength={120} />
            <Input value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={t("aiTeam.facts.valuePh")} maxLength={600} />
            <Button onClick={add} loading={busy} disabled={form.label.trim().length < 2 || !form.value.trim()} data-testid="fact-add">
              {t("common.save")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
