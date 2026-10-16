"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Bot, Pencil, Plus, Send, Sparkles, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { agentChatAction, createQuickAgentAction, deleteAgentAction, saveAgentAction } from "@/app/[locale]/(dashboard)/ai-agents/actions";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

export interface AgentRow {
  id: string;
  name: string;
  instructions: string;
  provider: "openai" | "anthropic" | "gemini";
  model: string;
  temperature: number;
  language: string;
  enabled: boolean;
  allowed_tools: string[];
  autopilot_channels?: string[];
  greeting?: string;
  handoff_rules?: string;
  profile?: Record<string, string> | null;
  lead_goal?: string | null;
  followup_hours?: number | null;
}

const PROFILE_FIELDS = [
  { key: "business", rows: 2 },
  { key: "services", rows: 4 },
  { key: "hours", rows: 1 },
  { key: "location", rows: 1 },
  { key: "phone", rows: 1 },
  { key: "website", rows: 1 },
  { key: "faq", rows: 3 },
] as const;

/** Channels the agent can answer on by itself (wave 6). */
export const AUTOPILOT_CHANNEL_OPTIONS = ["web", "whatsapp", "whatsapp_qr", "telegram", "email", "sms"] as const;
const AUTOPILOT_DEFAULT = ["web", "whatsapp", "whatsapp_qr", "telegram", "email"];
const TEMPLATE_KEYS = ["sales", "booking", "support", "realestate", "ecommerce"] as const;

export function AgentDialog({ agent, defaults }: { agent?: AgentRow; defaults: { openai: string; anthropic: string; gemini: string; provider: "openai" | "anthropic" | "gemini" } }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(saveAgentAction, {} as ActionState);
  const err = useFieldError(state);
  const [provider, setProvider] = useState<"openai" | "anthropic" | "gemini">(agent?.provider ?? defaults.provider);
  const handled = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      toast.success(t("ai.saved"));
      setOpen(false);
    }
  }, [state, t]);
  const v = (k: string, fb: string) => state.values?.[k] ?? fb;
  const nameRef = useRef<HTMLInputElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const greetingRef = useRef<HTMLTextAreaElement>(null);
  const applyTemplate = (key: string) => {
    if (!key) return;
    if (instructionsRef.current && (!instructionsRef.current.value.trim() || window.confirm(t("ai.templates.replaceConfirm")))) {
      instructionsRef.current.value = t(`ai.templates.${key}.instructions`);
    }
    if (nameRef.current && !nameRef.current.value.trim()) nameRef.current.value = t(`ai.templates.${key}.name`);
    if (greetingRef.current && !greetingRef.current.value.trim()) greetingRef.current.value = t(`ai.templates.${key}.greeting`);
  };
  const channels = agent ? (agent.autopilot_channels ?? []) : AUTOPILOT_DEFAULT;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t(agent ? "ai.editAgent" : "ai.newAgent")}
      className="sm:max-w-2xl"
      trigger={
        agent ? (
          <Button variant="ghost" size="sm" aria-label={t("common.edit")}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button>
            <Plus className="h-4 w-4" /> {t("ai.newAgent")}
          </Button>
        )
      }
    >
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="locale" value={locale} />
        {agent ? <input type="hidden" name="id" value={agent.id} /> : null}
        {!state.ok ? <FormAlert state={state} /> : null}
        <Field label={t("ai.templates.label")} htmlFor="agent-template" hint={t("ai.templates.hint")}>
          <Select id="agent-template" defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">{t("ai.templates.pick")}</option>
            {TEMPLATE_KEYS.map((k) => (
              <option key={k} value={k}>
                {t(`ai.templates.${k}.label`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("ai.name")} htmlFor="agent-name" error={err("name")}>
          <Input ref={nameRef} id="agent-name" name="name" required defaultValue={v("name", agent?.name ?? "")} aria-invalid={Boolean(err("name"))} />
        </Field>
        <Field label={t("ai.instructions")} htmlFor="agent-instructions" error={err("instructions")} hint={t("ai.instructionsHint")}>
          <Textarea ref={instructionsRef} id="agent-instructions" name="instructions" className="min-h-32" defaultValue={v("instructions", agent?.instructions ?? "")} />
        </Field>
        <fieldset className="space-y-3 rounded-2xl border border-accent/25 bg-accent-soft/40 p-4" data-testid="autopilot-settings">
          <input type="hidden" name="autopilotForm" value="1" />
          <legend className="px-1 text-sm font-semibold">{t("ai.autopilot.title")}</legend>
          <p className="text-[12.5px] text-muted">{t("ai.autopilot.hint")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {AUTOPILOT_CHANNEL_OPTIONS.map((c) => (
              <label key={c} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                <input type="checkbox" name="autopilot" value={c} defaultChecked={channels.includes(c)} className="h-4 w-4 accent-[var(--accent)]" />
                {t(`ai.autopilot.channels.${c}`)}
              </label>
            ))}
          </div>
          <Field label={t("ai.autopilot.greeting")} htmlFor="agent-greeting" hint={t("ai.autopilot.greetingHint")} error={err("greeting")}>
            <Textarea ref={greetingRef} id="agent-greeting" name="greeting" rows={2} maxLength={500} defaultValue={v("greeting", agent?.greeting ?? "")} />
          </Field>
          <Field label={t("ai.autopilot.handoff")} htmlFor="agent-handoff" hint={t("ai.autopilot.handoffHint")} error={err("handoffRules")}>
            <Textarea id="agent-handoff" name="handoffRules" rows={2} maxLength={2000} defaultValue={v("handoffRules", agent?.handoff_rules ?? "")} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t("ai.sales.goal")} htmlFor="agent-goal">
              <Select id="agent-goal" name="leadGoal" defaultValue={agent?.lead_goal ?? "lead"}>
                {(["lead", "booking", "sale", "support"] as const).map((g) => (
                  <option key={g} value={g}>
                    {t(`ai.sales.goals.${g}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ai.sales.tone")} htmlFor="agent-tone">
              <Select id="agent-tone" name="profile_tone" defaultValue={agent?.profile?.tone ?? "friendly"}>
                {(["friendly", "professional", "luxury", "casual"] as const).map((g) => (
                  <option key={g} value={g}>
                    {t(`ai.sales.tones.${g}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("ai.sales.followup")} htmlFor="agent-followup" hint={t("ai.sales.followupHint")}>
              <Select id="agent-followup" name="followupHours" defaultValue={String(agent?.followup_hours ?? (agent ? 0 : 3))}>
                {[0, 1, 3, 6, 12, 24, 48].map((h) => (
                  <option key={h} value={h}>
                    {h === 0 ? t("ai.sales.followupOff") : t("ai.sales.followupAfter", { h })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-2xl border border-line p-4" data-testid="agent-profile">
          <legend className="px-1 text-sm font-semibold">{t("ai.sales.profileTitle")}</legend>
          <p className="text-[12.5px] text-muted">{t("ai.sales.profileHint")}</p>
          {PROFILE_FIELDS.map((f) => (
            <Field key={f.key} label={t(`ai.sales.fields.${f.key}`)} htmlFor={`agent-p-${f.key}`}>
              {f.rows > 1 ? (
                <Textarea id={`agent-p-${f.key}`} name={`profile_${f.key}`} rows={f.rows} maxLength={3000} placeholder={t(`ai.sales.placeholders.${f.key}`)} defaultValue={agent?.profile?.[f.key] ?? ""} />
              ) : (
                <Input id={`agent-p-${f.key}`} name={`profile_${f.key}`} maxLength={300} placeholder={t(`ai.sales.placeholders.${f.key}`)} defaultValue={agent?.profile?.[f.key] ?? ""} dir={f.key === "phone" || f.key === "website" ? "ltr" : undefined} />
              )}
            </Field>
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("ai.provider")} htmlFor="agent-provider">
            <Select id="agent-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value as "openai" | "anthropic" | "gemini")} dir="ltr">
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
            </Select>
          </Field>
          <Field label={t("ai.model")} htmlFor="agent-model" error={err("model")}>
            <Input id="agent-model" name="model" dir="ltr" key={provider} defaultValue={agent && agent.provider === provider ? agent.model : defaults[provider]} />
          </Field>
          <Field label={t("ai.temperature")} htmlFor="agent-temp">
            <Input id="agent-temp" name="temperature" type="number" min={0} max={1} step={0.1} dir="ltr" defaultValue={String(agent?.temperature ?? 0.3)} />
          </Field>
          <Field label={t("ai.language")} htmlFor="agent-lang">
            <Select id="agent-lang" name="language" defaultValue={agent?.language ?? locale}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>{LOCALE_META[l].label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2.5 text-sm text-muted">
          <input type="checkbox" name="crmLookup" defaultChecked={agent ? agent.allowed_tools.includes("crm_lookup") : true} className="h-4 w-4 accent-[var(--accent)]" />
          {t("ai.toolCrm")}
        </label>
        <label className="flex items-center gap-2.5 text-sm text-muted">
          <input type="checkbox" name="siteBuilder" defaultChecked={agent ? agent.allowed_tools.includes("site_builder") : true} className="h-4 w-4 accent-[var(--accent)]" />
          {t("ai.toolSiteBuilder")}
        </label>
        <label className="flex items-center gap-2.5 text-sm text-muted">
          <input type="checkbox" name="imageGen" defaultChecked={agent ? agent.allowed_tools.includes("image_gen") : true} className="h-4 w-4 accent-[var(--accent)]" />
          {t("ai.toolImages")}
        </label>
        <label className="flex items-center gap-2.5 text-sm text-muted">
          <input type="checkbox" name="enabled" defaultChecked={agent?.enabled ?? true} className="h-4 w-4 accent-[var(--accent)]" />
          {t("ai.enabled")}
        </label>
        <div className="flex justify-end">
          <SubmitButton>{t("common.save")}</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}

export function DeleteAgentButton({ id }: { id: string }) {
  const { t, locale } = useI18n();
  return (
    <form
      action={deleteAgentAction}
      onSubmit={(e) => {
        if (!window.confirm(t("common.confirmDelete"))) e.preventDefault();
      }}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" aria-label={t("common.delete")}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}

type Msg = { role: "user" | "assistant"; content: string };

export function AgentChat({ agents }: { agents: AgentRow[] }) {
  const { t, locale } = useI18n();
  const usable = agents.filter((a) => a.enabled);
  const [selectedId, setAgentId] = useState(usable[0]?.id ?? "");
  // Agents can be created/removed after mount → always resolve to an existing enabled agent.
  const agentId = usable.some((a) => a.id === selectedId) ? selectedId : (usable[0]?.id ?? "");
  const [state, action] = useActionState(agentChatAction, {} as ActionState<{ reply: string; history: Msg[] }>);
  // History comes from the last server response; "clear" hides it until the next reply.
  const [clearedFor, setClearedFor] = useState<unknown>(null);
  const history: Msg[] = clearedFor === state ? [] : (state.data?.history ?? []);
  const clear = () => setClearedFor(state);

  if (usable.length === 0) return <p className="text-sm text-subtle">{t("ai.noEnabledAgents")}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          aria-label={t("ai.agent")}
          value={agentId}
          onChange={(e) => {
            setAgentId(e.target.value);
            clear();
          }}
          className="h-10 max-w-xs"
        >
          {usable.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
        <Button variant="ghost" size="sm" onClick={clear}>
          {t("ai.clear")}
        </Button>
      </div>
      <div className="max-h-[420px] min-h-40 space-y-3 overflow-y-auto rounded-xl border border-line bg-elevated p-3" aria-live="polite" tabIndex={0} aria-label={t("ai.testChat")}>
        {history.length === 0 ? <p className="py-8 text-center text-sm text-subtle">{t("ai.chatEmpty")}</p> : null}
        {history.map((m, i) => (
          <div key={i} className={cn("flex gap-2.5", m.role === "user" ? "flex-row" : "flex-row")}>
            <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-accent-soft text-accent" : "bg-gold-soft text-gold")}>
              {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </span>
            <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm", m.role === "user" ? "bg-surface" : "border border-gold/25 bg-surface")}>
              {m.content}
              {m.role === "assistant" ? (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-subtle">
                  <Sparkles className="h-3 w-3" /> {t("ai.aiNotice")}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {state.error ? <FormAlert state={state} /> : null}
      <form action={action} className="flex gap-2">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="agentId" value={agentId} />
        <input type="hidden" name="history" value={JSON.stringify(history)} />
        <Input key={history.length} name="message" placeholder={t("ai.messagePlaceholder")} aria-label={t("ai.messagePlaceholder")} maxLength={2000} required autoComplete="off" />
        <SubmitButton aria-label={t("ai.send")}>
          <Send className="h-4 w-4 rtl:rotate-180" />
        </SubmitButton>
      </form>
    </div>
  );
}

export function AgentStatus({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  return <Badge tone={enabled ? "success" : "neutral"}>{t(enabled ? "ai.enabled" : "ai.disabled")}</Badge>;
}

/** One click: a ready "sales & service" agent that answers customers on every connected channel. */
export function QuickAgentButton({ provider, model }: { provider: "openai" | "anthropic" | "gemini"; model: string }) {
  const { t, locale } = useI18n();
  const [pending, setPending] = useState(false);
  return (
    <Button
      loading={pending}
      data-testid="quick-agent"
      onClick={async () => {
        setPending(true);
        const r = await createQuickAgentAction({
          locale,
          provider,
          model,
          name: t("ai.templates.sales.name"),
          instructions: t("ai.templates.sales.instructions"),
          greeting: t("ai.templates.sales.greeting"),
        });
        setPending(false);
        if (r.error) toast.error(t(r.error));
        else toast.success(t("ai.quickCreated"));
      }}
    >
      <Sparkles className="h-4 w-4" /> {t("ai.quickCreate")}
    </Button>
  );
}
