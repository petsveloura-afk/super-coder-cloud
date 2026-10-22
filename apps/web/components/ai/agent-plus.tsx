"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CornerDownLeft, GitBranch, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { deleteFlowAction, saveFlowAction, saveGuardrailsAction } from "@/app/[locale]/(dashboard)/ai-agents/plus-actions";
import type { FlowNode, FlowNodeType } from "@/lib/ai/flows-core";

export interface RailsValue {
  max_replies_per_day: number;
  banned: string[];
  price_guard: boolean;
  angry_handoff: boolean;
  kb: boolean;
  voice_replies: boolean;
}

/** Wave 16 — quality & budget rules for this agent. */
export function GuardrailsCard({ agentId, value, ttsReady }: { agentId: string; value: RailsValue; ttsReady: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<RailsValue>(value);
  const [banned, setBanned] = useState(value.banned.join("\n"));
  const [pending, start] = useTransition();
  const toggle = (k: keyof RailsValue) => setV((x) => ({ ...x, [k]: !x[k] }));
  const save = () =>
    start(async () => {
      const r = await saveGuardrailsAction({ locale, agentId, rails: { ...v, banned: banned.split("\n").map((x) => x.trim()).filter((x) => x.length >= 2) } });
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t(r.message ?? "common.saved"));
        router.refresh();
      }
    });
  const row = ({ k, label, hint, disabled }: { k: keyof RailsValue; label: string; hint: string; disabled?: boolean }) => (
    <label key={k} className={`flex items-start gap-3 rounded-xl border border-line p-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" checked={Boolean(v[k])} disabled={disabled} onChange={() => toggle(k)} className="mt-0.5 h-5 w-5 accent-[var(--brand)]" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[12.5px] text-muted">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="space-y-3 p-5" data-testid="guardrails-card">
      {row({ k: "angry_handoff", label: t("rails.angry"), hint: t("rails.angryHint") })}
      {row({ k: "kb", label: t("rails.kb"), hint: t("rails.kbHint") })}
      {row({ k: "price_guard", label: t("rails.price"), hint: t("rails.priceHint") })}
      {row({ k: "voice_replies", label: t("rails.voice"), hint: t(ttsReady ? "rails.voiceHint" : "rails.voiceNeedsKey"), disabled: !ttsReady })}
      <Field label={t("rails.maxReplies")} htmlFor="rails-max" hint={t("rails.maxRepliesHint")}>
        <Input id="rails-max" type="number" min={0} max={500} dir="ltr" value={v.max_replies_per_day} onChange={(e) => setV((x) => ({ ...x, max_replies_per_day: Number(e.target.value) || 0 }))} />
      </Field>
      <Field label={t("rails.banned")} htmlFor="rails-banned" hint={t("rails.bannedHint")}>
        <Textarea id="rails-banned" rows={4} value={banned} onChange={(e) => setBanned(e.target.value)} placeholder={t("rails.bannedPlaceholder")} />
      </Field>
      <Button onClick={save} loading={pending} data-testid="rails-save">
        <ShieldAlert className="h-4 w-4" /> {t("common.save")}
      </Button>
    </div>
  );
}

export interface FlowView {
  id: string;
  name: string;
  enabled: boolean;
  trigger_keywords: string[];
  on_first_message: boolean;
  nodes: FlowNode[];
  runs: number;
  completions: number;
}

const TYPES: FlowNodeType[] = ["message", "buttons", "collect", "handoff", "ai", "end"];
const newId = () => `s${Math.random().toString(36).slice(2, 7)}`;

function template(kind: "qualify" | "menu", t: (k: string) => string): Omit<FlowView, "id" | "runs" | "completions"> {
  if (kind === "menu") {
    return {
      name: t("flows.tplMenu"),
      enabled: true,
      trigger_keywords: [t("flows.kwMenu")],
      on_first_message: false,
      nodes: [
        { id: "start", type: "buttons", text: t("flows.tplMenuQ"), buttons: [{ label: t("flows.tplPrices"), next: "prices" }, { label: t("flows.tplBook"), next: "name" }, { label: t("flows.tplHuman"), next: "human" }] },
        { id: "prices", type: "ai", text: "", next: null },
        { id: "name", type: "collect", field: "name", text: t("flows.askName"), next: "phone" },
        { id: "phone", type: "collect", field: "phone", text: t("flows.askPhone"), next: "done" },
        { id: "done", type: "end", text: t("flows.thanks"), next: null },
        { id: "human", type: "handoff", text: t("flows.toHuman"), next: null },
      ],
    };
  }
  return {
    name: t("flows.tplQualify"),
    enabled: true,
    trigger_keywords: [],
    on_first_message: true,
    nodes: [
      { id: "start", type: "message", text: t("flows.welcome"), next: "need" },
      { id: "need", type: "collect", field: "need", text: t("flows.askNeed"), next: "when" },
      { id: "when", type: "buttons", text: t("flows.askWhen"), buttons: [{ label: t("flows.now"), next: "phone" }, { label: t("flows.thisMonth"), next: "phone" }, { label: t("flows.justChecking"), next: "ai" }] },
      { id: "phone", type: "collect", field: "phone", text: t("flows.askPhone"), next: "done" },
      { id: "done", type: "handoff", text: t("flows.thanksHuman"), next: null },
      { id: "ai", type: "ai", text: "", next: null },
    ],
  };
}

/** Wave 16 — conversation flows: exact steps where it matters, then the AI or a person. */
export function FlowsEditor({ agentId, flows, locked }: { agentId: string; flows: FlowView[]; locked: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [edit, setEdit] = useState<(Omit<FlowView, "runs" | "completions"> & { runs?: number }) | null>(null);
  const [kw, setKw] = useState("");
  const [pending, start] = useTransition();

  const open = (f: Omit<FlowView, "runs" | "completions">) => {
    setEdit(JSON.parse(JSON.stringify(f)));
    setKw(f.trigger_keywords.join(", "));
  };
  const setNode = (i: number, patch: Partial<FlowNode>) => setEdit((e) => (e ? { ...e, nodes: e.nodes.map((n, j) => (j === i ? { ...n, ...patch } : n)) } : e));
  const move = (i: number, d: -1 | 1) =>
    setEdit((e) => {
      if (!e) return e;
      const nodes = [...e.nodes];
      const j = i + d;
      if (j < 0 || j >= nodes.length) return e;
      [nodes[i], nodes[j]] = [nodes[j]!, nodes[i]!];
      return { ...e, nodes };
    });
  const save = () =>
    start(async () => {
      if (!edit) return;
      const flow = { name: edit.name, enabled: edit.enabled, on_first_message: edit.on_first_message, trigger_keywords: kw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean), nodes: edit.nodes };
      const r = await saveFlowAction({ locale, agentId, flowId: edit.id || null, flow });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      setEdit(null);
      router.refresh();
    });
  const remove = (id: string) =>
    start(async () => {
      if (!window.confirm(t("common.confirmDelete"))) return;
      const r = await deleteFlowAction({ locale, flowId: id, agentId });
      if (r.error) toast.error(t(r.error));
      else router.refresh();
    });

  if (locked) return <p className="p-5 text-[13px] text-muted">{t("plans.locked.flow_builder.body", { plan: t("billing.plans.pro.name") })}</p>;

  if (!edit) {
    return (
      <div className="space-y-3 p-5" data-testid="flows-list">
        <p className="text-[13px] text-muted">{t("flows.hint")}</p>
        {flows.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {flows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                <GitBranch className="h-4 w-4 text-accent" />
                <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                <Badge tone={f.enabled ? "success" : "neutral"}>{t(f.enabled ? "flows.on" : "flows.off")}</Badge>
                <span className="text-[12px] text-muted">{t("flows.stats", { runs: f.runs, done: f.completions })}</span>
                <Button size="sm" variant="ghost" onClick={() => open(f)}>
                  {t("common.edit")}
                </Button>
                <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => remove(f.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => open({ id: "", ...template("qualify", t) })} data-testid="flow-new-qualify">
            <Plus className="h-4 w-4" /> {t("flows.tplQualify")}
          </Button>
          <Button variant="secondary" onClick={() => open({ id: "", ...template("menu", t) })}>
            <Plus className="h-4 w-4" /> {t("flows.tplMenu")}
          </Button>
          <Button variant="ghost" onClick={() => open({ id: "", name: t("flows.newFlow"), enabled: true, trigger_keywords: [], on_first_message: false, nodes: [{ id: "start", type: "message", text: "", next: null }] })}>
            <Plus className="h-4 w-4" /> {t("flows.empty")}
          </Button>
        </div>
      </div>
    );
  }

  const stepOptions = edit.nodes.map((n, i) => ({ id: n.id, label: `${i + 1}. ${t(`flows.types.${n.type}`)}${n.text ? ` — ${n.text.slice(0, 24)}` : ""}` }));
  const NextSelect = ({ value, onChange, id }: { value: string | null | undefined; onChange: (v: string | null) => void; id: string }) => (
    <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="h-9 text-[13px]">
      <option value="">{t("flows.nextNone")}</option>
      {stepOptions.map((o) => (
        <option key={o.id} value={o.id}>
          → {o.label}
        </option>
      ))}
    </Select>
  );
  return (
    <div className="space-y-4 p-5" data-testid="flow-editor">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("flows.name")} htmlFor="flow-name">
          <Input id="flow-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
        </Field>
        <Field label={t("flows.keywords")} htmlFor="flow-kw" hint={t("flows.keywordsHint")}>
          <Input id="flow-kw" value={kw} onChange={(e) => setKw(e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={edit.on_first_message} onChange={(e) => setEdit({ ...edit, on_first_message: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" /> {t("flows.firstMessage")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" /> {t("flows.enabled")}
        </label>
      </div>
      <ol className="space-y-3">
        {edit.nodes.map((n, i) => (
          <li key={n.id} className="rounded-2xl border border-line bg-elevated p-3" data-step={n.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{i + 1}</span>
              <Select aria-label={t("flows.type")} value={n.type} onChange={(e) => setNode(i, { type: e.target.value as FlowNodeType, buttons: e.target.value === "buttons" ? (n.buttons?.length ? n.buttons : [{ label: "", next: null }]) : n.buttons })} className="h-9 w-auto text-[13px]">
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`flows.types.${ty}`)}
                  </option>
                ))}
              </Select>
              {n.type === "collect" ? (
                <Select aria-label={t("flows.field")} value={n.field ?? "custom"} onChange={(e) => setNode(i, { field: e.target.value })} className="h-9 w-auto text-[13px]">
                  {["name", "phone", "email", "need", "budget", "date", "custom"].map((f) => (
                    <option key={f} value={f}>
                      {t(`flows.fields.${f}`)}
                    </option>
                  ))}
                </Select>
              ) : null}
              <span className="ms-auto flex gap-1">
                <Button size="sm" variant="ghost" aria-label={t("deals.moveEarlier")} onClick={() => move(i, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label={t("deals.moveLater")} onClick={() => move(i, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label={t("common.delete")} disabled={edit.nodes.length === 1} onClick={() => setEdit({ ...edit, nodes: edit.nodes.filter((_, j) => j !== i) })}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </span>
            </div>
            {n.type !== "ai" || n.text ? (
              <Textarea aria-label={t("flows.text")} rows={2} value={n.text ?? ""} onChange={(e) => setNode(i, { text: e.target.value })} placeholder={t(`flows.placeholders.${n.type}`)} />
            ) : (
              <p className="text-[12.5px] text-muted">{t("flows.aiTakesOver")}</p>
            )}
            {n.type === "buttons" ? (
              <ul className="mt-2 space-y-1.5">
                {(n.buttons ?? []).map((b, bi) => (
                  <li key={bi} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                    <Input aria-label={t("flows.buttonLabel")} value={b.label} onChange={(e) => setNode(i, { buttons: (n.buttons ?? []).map((x, xi) => (xi === bi ? { ...x, label: e.target.value } : x)) })} className="h-9" placeholder={t("flows.buttonLabel")} />
                    <NextSelect id={`fb-${n.id}-${bi}`} value={b.next} onChange={(nx) => setNode(i, { buttons: (n.buttons ?? []).map((x, xi) => (xi === bi ? { ...x, next: nx } : x)) })} />
                    <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => setNode(i, { buttons: (n.buttons ?? []).filter((_, xi) => xi !== bi) })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setNode(i, { buttons: [...(n.buttons ?? []), { label: "", next: null }] })} disabled={(n.buttons ?? []).length >= 10}>
                  <Plus className="h-4 w-4" /> {t("flows.addButton")}
                </Button>
              </ul>
            ) : null}
            {["message", "collect"].includes(n.type) ? (
              <div className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
                <CornerDownLeft className="h-4 w-4" /> {t("flows.then")}
                <div className="flex-1">
                  <NextSelect id={`fn-${n.id}`} value={n.next} onChange={(nx) => setNode(i, { next: nx })} />
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setEdit({ ...edit, nodes: [...edit.nodes, { id: newId(), type: "message", text: "", next: null }] })} disabled={edit.nodes.length >= 60}>
          <Plus className="h-4 w-4" /> {t("flows.addStep")}
        </Button>
        <Button onClick={save} loading={pending} data-testid="flow-save">
          <Save className="h-4 w-4" /> {t("common.save")}
        </Button>
        <Button variant="ghost" onClick={() => setEdit(null)}>
          {t("common.cancel")}
        </Button>
      </div>
      <p className="text-[12px] text-subtle">{t("flows.rules")}</p>
    </div>
  );
}
