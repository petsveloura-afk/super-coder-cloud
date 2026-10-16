"use client";

import { CheckCircle2, CircleDashed, Copy, MessageCircle, Send, Smartphone, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import { connectChannelAction, disconnectChannelAction } from "@/app/[locale]/(dashboard)/integrations/actions";
import { formatDateTime } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

export interface ChannelRow {
  id: string;
  kind: "whatsapp" | "telegram" | "sms";
  name: string;
  status: "active" | "error" | "disabled";
  config: Record<string, string>;
  webhook_token: string;
  last_error: string | null;
  last_inbound_at: string | null;
}

const ICONS = { whatsapp: MessageCircle, telegram: Send, sms: Smartphone } as const;
const FIELDS: Record<ChannelRow["kind"], { name: string; secret: boolean; placeholder: string }[]> = {
  telegram: [{ name: "bot_token", secret: true, placeholder: "123456789:AA…" }],
  whatsapp: [
    { name: "phone_number_id", secret: false, placeholder: "1234567890" },
    { name: "access_token", secret: true, placeholder: "EAAG…" },
    { name: "app_secret", secret: true, placeholder: "32 hex" },
  ],
  sms: [
    { name: "account_sid", secret: false, placeholder: "AC…" },
    { name: "auth_token", secret: true, placeholder: "32 hex" },
    { name: "from_number", secret: false, placeholder: "+972…" },
  ],
};

function Copyable({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <span className="text-[12px] text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-elevated px-2.5 py-1.5 text-[11.5px]">
          {value}
        </code>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${t("common.copy")} ${label}`}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            toast.success(t("common.copied"));
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ChannelFields({ kind, state }: { kind: ChannelRow["kind"]; state: ActionState<unknown> }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-elevated p-3 text-[13px] leading-relaxed text-muted">{t(`integrations.channels.${kind}.howto`)}</p>
      {FIELDS[kind].map((f) => (
        <Field key={f.name} label={t(`integrations.channels.fields.${f.name}`)} htmlFor={`ch-${kind}-${f.name}`} error={err(f.name)}>
          <Input
            id={`ch-${kind}-${f.name}`}
            name={f.name}
            dir="ltr"
            type={f.secret ? "password" : "text"}
            autoComplete="off"
            placeholder={f.placeholder}
            defaultValue={f.secret ? "" : (state.values?.[f.name] ?? "")}
            required
          />
        </Field>
      ))}
    </div>
  );
}

export function ChannelCard({ kind, row, webhookUrl, encryptionReady }: { kind: ChannelRow["kind"]; row: ChannelRow | null; webhookUrl: string | null; encryptionReady: boolean }) {
  const { t, locale } = useI18n();
  const Icon = ICONS[kind];
  const connected = Boolean(row);
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-line p-4" data-channel={kind}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-5 w-5 text-accent" />
        <span className="me-auto font-semibold">{t(`integrations.channels.${kind}.name`)}</span>
        {row?.status === "active" ? (
          <Badge tone="success">
            <CheckCircle2 className="me-1 inline h-3.5 w-3.5" />
            {t("integrations.connected")}
          </Badge>
        ) : row?.status === "error" ? (
          <Badge tone="danger">
            <TriangleAlert className="me-1 inline h-3.5 w-3.5" />
            {t("integrations.channels.error")}
          </Badge>
        ) : (
          <Badge tone="neutral">
            <CircleDashed className="me-1 inline h-3.5 w-3.5" />
            {t("integrations.notConnected")}
          </Badge>
        )}
      </div>
      <p className="text-[12.5px] text-muted">{t(`integrations.channels.${kind}.body`)}</p>
      {row ? (
        <div className="space-y-2 text-[12.5px]">
          <div className="font-medium" dir="ltr">
            {kind === "telegram" ? `@${row.config.username}` : kind === "whatsapp" ? `${row.config.display_phone_number} · ${row.config.verified_name}` : row.config.from_number}
          </div>
          {row.last_inbound_at ? <div className="text-subtle">{t("integrations.channels.lastInbound", { date: formatDateTime(locale, row.last_inbound_at) })}</div> : null}
          {row.last_error ? <div className="text-danger">{row.last_error}</div> : null}
          {kind !== "telegram" && webhookUrl ? <Copyable label={t("integrations.channels.callbackUrl")} value={webhookUrl} /> : null}
          {kind === "whatsapp" ? <Copyable label={t("integrations.channels.verifyToken")} value={row.webhook_token} /> : null}
        </div>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        {!encryptionReady ? (
          <p className="text-[12.5px] text-danger">{t("integrations.channels.encryptionMissing")}</p>
        ) : (
          <FormDialog
            action={connectChannelAction}
            title={t(`integrations.channels.${kind}.name`)}
            hidden={{ kind }}
            submitLabel={t("integrations.channels.connect")}
            trigger={
              <Button variant={connected ? "secondary" : "primary"} size="sm">
                {connected ? t("integrations.channels.reconnect") : t("integrations.channels.connect")}
              </Button>
            }
          >
            {(state) => <ChannelFields kind={kind} state={state} />}
          </FormDialog>
        )}
        {connected ? <ConfirmActionButton action={disconnectChannelAction} fields={{ kind }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} /> : null}
      </div>
    </div>
  );
}
