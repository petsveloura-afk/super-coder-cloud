"use client";

import { useState } from "react";
import { triggerLabel } from "@/lib/labels";
import { Copy, Eye, EyeOff, KeyRound, Plus, RefreshCw, Webhook } from "lucide-react";
import { toast } from "sonner";
import { AUTOMATION_TRIGGERS } from "@scc/shared/automations";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import {
  createApiKeyAction,
  deleteWebhookAction,
  revokeApiKeyAction,
  rotateWebhookSecretAction,
  saveWebhookAction,
  toggleWebhookAction,
} from "@/app/[locale]/(dashboard)/integrations/actions";
import { formatDateTime } from "@/lib/format";

const SCOPES = ["contacts.read", "contacts.write", "deals.read", "deals.write", "tasks.write", "events.read", "webhooks.manage"] as const;
const EVENTS = ["*", ...AUTOMATION_TRIGGERS.filter((x) => x !== "webhook.inbound")];

function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        toast.success(t("common.copied"));
      }}
    >
      <Copy className="h-4 w-4" /> {t("common.copy")}
    </Button>
  );
}

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function ApiKeys({ keys }: { keys: ApiKeyRow[] }) {
  const { t, locale } = useI18n();
  const [created, setCreated] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {created ? (
        <div role="status" className="space-y-2 rounded-xl border border-gold/40 bg-gold-soft p-4">
          <p className="text-sm font-semibold">{t("integrations.keyOnce")}</p>
          <div className="flex items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-elevated px-3 py-2 text-[12.5px]" data-testid="new-api-key">
              {created}
            </code>
            <CopyButton value={created} />
          </div>
        </div>
      ) : null}
      {keys.length === 0 ? <p className="text-sm text-subtle">{t("integrations.noKeys")}</p> : null}
      <ul className="divide-y divide-line rounded-xl border border-line">
        {keys.map((k) => (
          <li key={k.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-subtle" />
                <span className="font-medium">{k.name}</span>
                {k.revoked_at ? <Badge tone="danger">{t("integrations.revoked")}</Badge> : <Badge tone="success">{t("integrations.active")}</Badge>}
              </div>
              <div className="mt-1 text-[12px] text-muted">
                <code dir="ltr">{k.prefix}…</code> · {k.scopes.join(", ")} · {k.last_used_at ? t("integrations.lastUsed", { date: formatDateTime(locale, k.last_used_at) }) : t("integrations.neverUsed")}
              </div>
            </div>
            {!k.revoked_at ? <ConfirmActionButton action={revokeApiKeyAction} fields={{ id: k.id }} size="sm" label={t("integrations.revoke")} confirm={t("integrations.confirmRevoke")} /> : null}
          </li>
        ))}
      </ul>
      <FormDialog<{ key: string }>
        action={createApiKeyAction}
        title={t("integrations.newKey")}
        submitLabel={t("common.create")}
        redirectTo={(d) => {
          if (d?.key) setCreated(d.key);
          return null;
        }}
        trigger={
          <Button variant="secondary">
            <Plus className="h-4 w-4" /> {t("integrations.newKey")}
          </Button>
        }
      >
        {(state) => <KeyFields state={state} />}
      </FormDialog>
    </div>
  );
}

function KeyFields({ state }: { state: { fieldErrors?: Record<string, string>; values?: Record<string, string> } }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  return (
    <div className="space-y-4">
      <Field label={t("integrations.keyName")} htmlFor="key-name" error={err("name")}>
        <Input id="key-name" name="name" placeholder="Zapier" defaultValue={state.values?.name ?? ""} required />
      </Field>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-muted">{t("integrations.scopes")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="scopes" value={s} defaultChecked={s.endsWith(".read")} className="h-4 w-4 accent-[var(--accent)]" />
              <span>{t(`integrations.scopeNames.${s.replace(".", "_")}`)}</span>
            </label>
          ))}
        </div>
        {err("scopes") ? <p className="mt-1 text-[13px] text-danger">{err("scopes")}</p> : null}
      </fieldset>
    </div>
  );
}

export interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secret: string;
  enabled: boolean;
  last_status: number | null;
  last_delivery_at: string | null;
  failure_count: number;
}

function WebhookFields({ state, hook }: { state: { fieldErrors?: Record<string, string>; values?: Record<string, string> }; hook?: WebhookRow }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const selected = new Set(hook?.events ?? ["contact.created"]);
  return (
    <div className="space-y-4">
      <Field label="URL (https)" htmlFor="wh-url" error={err("url")}>
        <Input id="wh-url" name="url" dir="ltr" placeholder="https://example.com/webhooks/scc" defaultValue={state.values?.url ?? hook?.url ?? ""} required />
      </Field>
      <Field label={t("automations.description")} htmlFor="wh-desc" error={err("description")}>
        <Input id="wh-desc" name="description" defaultValue={state.values?.description ?? hook?.description ?? ""} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium text-muted">{t("integrations.events")}</legend>
        <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
          {EVENTS.map((ev) => (
            <label key={ev} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="events" value={ev} defaultChecked={selected.has(ev)} className="h-4 w-4 accent-[var(--accent)]" />
              <span>{ev === "*" ? t("integrations.allEvents") : triggerLabel(t, ev)}</span>
            </label>
          ))}
        </div>
        {err("events") ? <p className="mt-1 text-[13px] text-danger">{err("events")}</p> : null}
      </fieldset>
    </div>
  );
}

export function Webhooks({ hooks, deliveries }: { hooks: WebhookRow[]; deliveries: { id: number; webhook_id: string; status: string; response_status: number | null; created_at: string; last_error: string | null }[] }) {
  const { t, locale } = useI18n();
  const [shown, setShown] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-3">
      {hooks.length === 0 ? <p className="text-sm text-subtle">{t("integrations.noWebhooks")}</p> : null}
      <ul className="space-y-3">
        {hooks.map((h) => {
          const recent = deliveries.filter((d) => d.webhook_id === h.id).slice(0, 5);
          return (
            <li key={h.id} className="rounded-xl border border-line p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4 text-subtle" />
                    <code dir="ltr" className="truncate text-[13px]">
                      {h.url}
                    </code>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
                    {h.enabled ? <Badge tone="success">{t("integrations.active")}</Badge> : <Badge tone="neutral">{t("integrations.paused")}</Badge>}
                    {h.last_status ? <Badge tone={h.last_status < 300 ? "success" : "danger"}>HTTP {h.last_status}</Badge> : null}
                    {h.failure_count > 0 ? <Badge tone="warning">{t("integrations.failures", { count: h.failure_count })}</Badge> : null}
                    <span className="text-muted">{h.events.map((e) => (e === "*" ? t("integrations.allEvents") : triggerLabel(t, e))).join(" · ")}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <FormDialog
                    action={saveWebhookAction}
                    title={t("integrations.editWebhook")}
                    hidden={{ id: h.id }}
                    trigger={
                      <Button variant="ghost" size="sm">
                        {t("common.edit")}
                      </Button>
                    }
                  >
                    {(state) => <WebhookFields state={state} hook={h} />}
                  </FormDialog>
                  <ConfirmActionButton action={toggleWebhookAction} fields={{ id: h.id, enabled: String(!h.enabled) }} confirm={false} variant="ghost" size="sm" icon={<span />} label={h.enabled ? t("integrations.pause") : t("integrations.resume")} />
                  <ConfirmActionButton action={deleteWebhookAction} fields={{ id: h.id }} variant="ghost" size="sm" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="text-muted">{t("integrations.signingSecret")}:</span>
                <code dir="ltr" className="rounded bg-elevated px-2 py-1">
                  {shown[h.id] ? h.secret : "••••••••••••••••"}
                </code>
                <Button variant="ghost" size="sm" onClick={() => setShown((s) => ({ ...s, [h.id]: !s[h.id] }))} aria-label={t(shown[h.id] ? "integrations.hide" : "integrations.reveal")}>
                  {shown[h.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                {shown[h.id] ? <CopyButton value={h.secret} /> : null}
                <ConfirmActionButton action={rotateWebhookSecretAction} fields={{ id: h.id }} confirm={t("integrations.confirmRotate")} variant="ghost" size="sm" icon={<RefreshCw className="h-4 w-4" />} label={t("integrations.rotate")} />
              </div>
              {recent.length ? (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12px] text-muted">
                  {recent.map((d) => (
                    <li key={d.id} className="flex flex-wrap gap-2">
                      <span className={d.status === "done" ? "text-success" : d.status === "dead" ? "text-danger" : ""}>{t(`automations.jobStatus.${d.status}`)}</span>
                      {d.response_status ? <span>HTTP {d.response_status}</span> : null}
                      <span className="text-subtle">{formatDateTime(locale, d.created_at)}</span>
                      {d.last_error ? <span className="truncate text-danger">{d.last_error}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      <FormDialog
        action={saveWebhookAction}
        title={t("integrations.newWebhook")}
        submitLabel={t("common.create")}
        trigger={
          <Button variant="secondary">
            <Plus className="h-4 w-4" /> {t("integrations.newWebhook")}
          </Button>
        }
      >
        {(state) => <WebhookFields state={state} />}
      </FormDialog>
    </div>
  );
}

export function ApiDocs({ baseUrl }: { baseUrl: string }) {
  const { t } = useI18n();
  const curl = `curl -X POST ${baseUrl}/api/public/v1/contacts \\
  -H "Authorization: Bearer scc_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{"first_name":"Dana","email":"dana@example.com","phone":"+972501234567","tags":["zapier"]}'`;
  const verify = `// Node.js — verify X-SCC-Signature
const expected = "sha256=" + crypto.createHmac("sha256", SECRET)
  .update(req.headers["x-scc-timestamp"] + "." + rawBody).digest("hex");
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-scc-signature"]));`;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">{t("integrations.apiIntro")}</p>
      <ul className="grid gap-1.5 text-[13px]" dir="ltr">
        {[
          "GET  /api/public/v1/me",
          "GET  /api/public/v1/contacts?email=&limit=&offset=",
          "POST /api/public/v1/contacts   (upsert by e-mail)",
          "GET|PATCH /api/public/v1/contacts/{id}",
          "GET|POST  /api/public/v1/deals",
          "POST /api/public/v1/tasks",
          "GET  /api/public/v1/events?after_id=&type=",
        ].map((l) => (
          <li key={l}>
            <code className="rounded bg-elevated px-2 py-0.5">{l}</code>
          </li>
        ))}
      </ul>
      <pre dir="ltr" className="overflow-x-auto rounded-xl bg-elevated p-3 text-[12px] leading-relaxed">
        {curl}
      </pre>
      <p className="text-muted">{t("integrations.signatureIntro")}</p>
      <pre dir="ltr" className="overflow-x-auto rounded-xl bg-elevated p-3 text-[12px] leading-relaxed">
        {verify}
      </pre>
    </div>
  );
}
