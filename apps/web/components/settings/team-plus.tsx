"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Copy, Pause, Play, Shuffle, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input, Select } from "@/components/ui/primitives";
import { FormAlert, SubmitButton } from "@/components/ui/form-bits";
import type { ActionState } from "@/lib/action-state";
import { addMyChannelAction, deleteMyChannelAction, saveLeadRoutingAction, setMyAvailabilityAction, updateMyChannelAction } from "@/app/[locale]/(dashboard)/settings/team-actions";
import { saveConversationPolicyAction } from "@/app/[locale]/(dashboard)/settings/policy-actions";

function useOkToast(state: ActionState<unknown>) {
  const { t } = useI18n();
  const router = useRouter();
  const seen = useRef<ActionState<unknown> | null>(null);
  useEffect(() => {
    if (state.ok && seen.current !== state) {
      seen.current = state;
      toast.success(t(state.message ?? "common.saved"));
      router.refresh();
    }
  }, [state, t, router]);
}

export interface MyChannel {
  id: string;
  kind: string;
  target: string | null;
  events: string[];
  enabled: boolean;
  invite_code: string | null;
  last_error: string | null;
}

const MY_EVENTS = ["tasks", "appointments", "escalation", "leads", "handoff"] as const;

/** Wave 15 — my own channels for reminders + "available for new leads". */
export function MyChannelsCard({ channels, botUsername, available }: { channels: MyChannel[]; botUsername: string | null; available: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [kind, setKind] = useState(botUsername ? "telegram" : "whatsapp");
  const [target, setTarget] = useState("");
  const [events, setEvents] = useState<string[]>(["tasks", "appointments"]);
  const [pending, start] = useTransition();
  const link = (code: string) => (botUsername ? `https://t.me/${botUsername}?start=n_${code}` : "");
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast.success(t("notify.copied")), () => undefined);
  const act = (fn: () => Promise<ActionState<unknown>>, ok?: (r: ActionState<unknown>) => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(t(r.error));
      else {
        if (r.message) toast.success(t(r.message));
        ok?.(r);
        router.refresh();
      }
    });
  return (
    <div className="space-y-4 p-5" data-testid="my-channels">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3">
        <span className={`h-2.5 w-2.5 rounded-full ${available ? "bg-success" : "bg-subtle"}`} />
        <span className="flex-1 text-sm">{t(available ? "routing.available" : "routing.away")}</span>
        <Button size="sm" variant="secondary" loading={pending} onClick={() => act(() => setMyAvailabilityAction({ locale, available: !available }))} data-testid="availability-toggle">
          {available ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {t(available ? "routing.setAway" : "routing.setAvailable")}
        </Button>
      </div>
      <p className="text-[13px] text-muted">{t("myChannels.hint")}</p>
      {channels.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {channels.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
              <Badge tone="accent">{t(`notify.kinds.${c.kind}`)}</Badge>
              <bdi dir="ltr" className="min-w-0 flex-1 truncate text-[13px]">
                {c.target ?? t("notify.waiting")}
              </bdi>
              <span className="text-[12px] text-muted">{c.events.map((e) => t(`myChannels.events.${e}`)).join(" · ")}</span>
              {!c.target && c.invite_code && botUsername ? (
                <Button size="sm" variant="ghost" onClick={() => copy(link(c.invite_code!))}>
                  <Copy className="h-4 w-4" /> {t("notify.copy")}
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => act(() => updateMyChannelAction({ locale, id: c.id, enabled: !c.enabled }))}>
                {c.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="ghost" aria-label={t("common.delete")} onClick={() => act(() => deleteMyChannelAction({ locale, id: c.id }))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Field label={t("notify.kind")} htmlFor="my-kind">
          <Select id="my-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {["telegram", "whatsapp", "sms", "email", "call"].map((k) => (
              <option key={k} value={k}>
                {t(`notify.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        {kind !== "telegram" ? (
          <Field label={t("notify.target")} htmlFor="my-target">
            <Input id="my-target" dir="ltr" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={kind === "email" ? "me@example.com" : "050-1234567"} />
          </Field>
        ) : (
          <p className="self-end text-[12.5px] text-muted">{botUsername ? t("myChannels.telegramHint", { bot: `@${botUsername}` }) : t("myChannels.needBot")}</p>
        )}
      </div>
      <fieldset className="flex flex-wrap gap-2">
        {MY_EVENTS.map((e) => (
          <label key={e} className="flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-[13px]">
            <input type="checkbox" checked={events.includes(e)} onChange={(x) => setEvents((v) => (x.target.checked ? [...v, e] : v.filter((y) => y !== e)))} className="h-4 w-4 accent-[var(--brand)]" />
            {t(`myChannels.events.${e}`)}
          </label>
        ))}
      </fieldset>
      <Button
        loading={pending}
        disabled={!events.length || (kind === "telegram" && !botUsername)}
        data-testid="my-channel-add"
        onClick={() =>
          act(
            () => addMyChannelAction({ locale, kind, target, events }),
            (r) => {
              setTarget("");
              const invite = (r.data as { invite?: string } | undefined)?.invite;
              if (invite) copy(link(invite));
            },
          )
        }
      >
        <Bell className="h-4 w-4" /> {t(kind === "telegram" ? "notify.createInvite" : "notify.add")}
      </Button>
    </div>
  );
}

/** Wave 15 — who gets new leads and conversations automatically. */
export function LeadRoutingCard({ routing, members, locked }: { routing: { mode?: string; members?: string[]; contacts?: boolean; conversations?: boolean }; members: { id: string; label: string; available: boolean }[]; locked: boolean }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(saveLeadRoutingAction, {} as ActionState);
  useOkToast(state);
  const shown = state.ok ? ({} as ActionState) : state;
  return (
    <form action={action} className="space-y-4 p-5" data-testid="lead-routing">
      <input type="hidden" name="locale" value={locale} />
      <p className="text-[13px] text-muted">{t("routing.hint")}</p>
      {locked ? <p className="rounded-xl border border-gold/30 bg-gold-soft p-3 text-[13px]">{t("plans.locked.lead_routing.body", { plan: t("billing.plans.pro.name") })}</p> : null}
      <FormAlert state={shown} />
      <Field label={t("routing.mode")} htmlFor="rt-mode">
        <Select id="rt-mode" name="mode" defaultValue={routing.mode ?? "off"}>
          {["off", "round_robin", "least_loaded"].map((m) => (
            <option key={m} value={m}>
              {t(`routing.modes.${m}`)}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-muted">{t("routing.members")}</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {members.map((m) => (
            <label key={m.id} className="flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-[13px]">
              <input type="checkbox" name="members" value={m.id} defaultChecked={!routing.members?.length || routing.members.includes(m.id)} className="h-4 w-4 accent-[var(--brand)]" />
              <span className="flex-1 truncate">{m.label}</span>
              <span className={`h-2 w-2 rounded-full ${m.available ? "bg-success" : "bg-subtle"}`} title={t(m.available ? "routing.available" : "routing.away")} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="contacts" defaultChecked={routing.contacts !== false} className="h-4 w-4 accent-[var(--brand)]" /> {t("routing.contacts")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="conversations" defaultChecked={routing.conversations === true} className="h-4 w-4 accent-[var(--brand)]" /> {t("routing.conversations")}
        </label>
      </div>
      <SubmitButton>
        <Shuffle className="h-4 w-4" /> {t("common.save")}
      </SubmitButton>
    </form>
  );
}

/** Conversation guard — the workspace rules for automated messages. */
export function ConversationPolicyCard({ policy }: { policy: Record<string, unknown> }) {
  const { t, locale } = useI18n();
  const [state, action] = useActionState(saveConversationPolicyAction, {} as ActionState);
  useOkToast(state);
  const shown = state.ok ? ({} as ActionState) : state;
  const v = (k: string, d: string) => (policy[k] === null || policy[k] === undefined ? d : String(policy[k]));
  return (
    <form action={action} className="space-y-4 p-5" data-testid="conversation-policy">
      <input type="hidden" name="locale" value={locale} />
      <p className="text-[13px] leading-relaxed text-muted">{t("guard.policyHint")}</p>
      <FormAlert state={shown} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("guard.followupMax")} htmlFor="pol-fmax">
          <Input id="pol-fmax" name="followup_max" type="number" min={1} max={5} dir="ltr" defaultValue={v("followup_max", "1")} />
        </Field>
        <Field label={t("guard.followupGap")} htmlFor="pol-fgap">
          <Input id="pol-fgap" name="followup_gap_hours" type="number" min={1} max={168} dir="ltr" defaultValue={v("followup_gap_hours", "24")} />
        </Field>
        <Field label={t("guard.minGap")} htmlFor="pol-gap">
          <Input id="pol-gap" name="min_gap_minutes" type="number" min={0} max={1440} dir="ltr" defaultValue={v("min_gap_minutes", "2")} />
        </Field>
        <Field label={t("guard.dailyCap")} htmlFor="pol-cap">
          <Input id="pol-cap" name="daily_cap" type="number" min={1} max={100} dir="ltr" defaultValue={v("daily_cap", "12")} />
        </Field>
        <Field label={t("guard.quietStart")} htmlFor="pol-qs">
          <Input id="pol-qs" name="quiet_start" type="time" dir="ltr" defaultValue={v("quiet_start", "")} />
        </Field>
        <Field label={t("guard.quietEnd")} htmlFor="pol-qe">
          <Input id="pol-qe" name="quiet_end" type="time" dir="ltr" defaultValue={v("quiet_end", "")} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="opt_out_reply" defaultChecked={policy.opt_out_reply !== false} className="h-4 w-4 accent-[var(--brand)]" /> {t("guard.optOutReply")}
      </label>
      <ul className="list-disc space-y-1 ps-5 text-[12.5px] text-muted">
        <li>{t("guard.rule1")}</li>
        <li>{t("guard.rule2")}</li>
        <li>{t("guard.rule3")}</li>
        <li>{t("guard.rule4")}</li>
      </ul>
      <SubmitButton>
        <ShieldCheck className="h-4 w-4" /> {t("common.save")}
      </SubmitButton>
    </form>
  );
}
