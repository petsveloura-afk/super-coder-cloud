"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Bot, Pencil, Plus, Send, Sparkles, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { FormAlert, SubmitButton, useFieldError } from "@/components/ui/form-bits";
import { agentChatAction, deleteAgentAction, saveAgentAction } from "@/app/[locale]/(dashboard)/ai-agents/actions";
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
}

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
        <Field label={t("ai.name")} htmlFor="agent-name" error={err("name")}>
          <Input id="agent-name" name="name" required defaultValue={v("name", agent?.name ?? "")} aria-invalid={Boolean(err("name"))} />
        </Field>
        <Field label={t("ai.instructions")} htmlFor="agent-instructions" error={err("instructions")} hint={t("ai.instructionsHint")}>
          <Textarea id="agent-instructions" name="instructions" className="min-h-32" defaultValue={v("instructions", agent?.instructions ?? "")} />
        </Field>
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
