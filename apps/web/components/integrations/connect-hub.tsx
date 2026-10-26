"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Bot, CheckCircle2, CircleDashed, Copy, ExternalLink, Globe, KeyRound, Link2, Mail, MessageCircle, QrCode, Send, ShieldAlert, Sparkles, TriangleAlert, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { useFieldError } from "@/components/ui/form-bits";
import {
  connectChannelAction,
  connectMailboxAction,
  connectWhatsAppEmbeddedAction,
  disconnectChannelAction,
  disconnectChannelV2Action,
  startWhatsAppQrAction,
  whatsAppQrStatusAction,
  startTelegramUserAction,
  telegramUserStatusAction,
  telegramUserPasswordAction,
  type QrState,
  type TgUserState,
} from "@/app/[locale]/(dashboard)/integrations/actions";
import { cn } from "@/lib/utils";

/**
 * Integrations — simple "connect in one click" hub (wave 6).
 * Every card says in plain words what it does, whether it's connected, and
 * whether the AI agent answers there.
 */

export interface HubChannel {
  connected: boolean;
  label?: string | null;
  error?: string | null;
}

export interface HubProps {
  orgSlug: string;
  appUrl: string;
  agent: { exists: boolean; name: string | null; channels: string[] };
  channels: { web: HubChannel; whatsapp: HubChannel & { mode?: string | null }; whatsapp_qr: HubChannel; telegram: HubChannel; email: HubChannel & { address?: string | null; auth?: string | null }; telegram_user?: HubChannel };
  meta: { appId: string; configId: string; version: string } | null;
  bridge: boolean;
  oauth: { google: boolean; microsoft: boolean };
  encryption: boolean;
  canManage: boolean;
}

function Status({ on, error }: { on: boolean; error?: string | null }) {
  const { t } = useI18n();
  if (error)
    return (
      <Badge tone="danger">
        <TriangleAlert className="me-1 inline h-3.5 w-3.5" />
        {t("integrations.channels.error")}
      </Badge>
    );
  return on ? (
    <Badge tone="success">
      <CheckCircle2 className="me-1 inline h-3.5 w-3.5" />
      {t("integrations.connected")}
    </Badge>
  ) : (
    <Badge tone="neutral">
      <CircleDashed className="me-1 inline h-3.5 w-3.5" />
      {t("integrations.notConnected")}
    </Badge>
  );
}

function AiLine({ on }: { on: boolean }) {
  const { t } = useI18n();
  return (
    <p className={cn("inline-flex items-center gap-1.5 text-[12px]", on ? "text-success" : "text-subtle")}>
      <Bot className="h-3.5 w-3.5" /> {t(on ? "integrations.hub.aiOn" : "integrations.hub.aiOff")}
    </p>
  );
}

function CopyBox({ value, label }: { value: string; label: string }) {
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

function HubCard({ icon: Icon, title, body, status, children, testId, tone }: { icon: typeof Globe; title: string; body: string; status: React.ReactNode; children: React.ReactNode; testId: string; tone?: "accent" | "success" | "gold" }) {
  return (
    <li className="flex h-full min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm" data-hub={testId}>
      <div className="flex items-start gap-3">
        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tone === "success" ? "bg-success-soft text-success" : tone === "gold" ? "bg-gold-soft text-gold" : "bg-accent-soft text-accent")}>
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="me-auto font-semibold">{title}</h3>
            {status}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{body}</p>
        </div>
      </div>
      <div className="mt-auto space-y-2.5">{children}</div>
    </li>
  );
}

/* --------------------------------------------------------------- website chat */

function WebChatCard({ p }: { p: HubProps }) {
  const { t, locale } = useI18n();
  const on = p.agent.channels.includes("web");
  const code = `<script src="${p.appUrl}/widget.js" data-org="${p.orgSlug}" data-lang="${locale}" async></script>`;
  return (
    <HubCard icon={Globe} title={t("integrations.hub.webTitle")} body={t("integrations.hub.webBody")} status={<Status on={on} />} testId="web" tone="success">
      <AiLine on={on} />
      <CopyBox label={t("integrations.hub.webCode")} value={code} />
      <a href={`/${locale}/chat/${p.orgSlug}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
        <ExternalLink className="h-3.5 w-3.5" /> {t("integrations.hub.webTry")}
      </a>
    </HubCard>
  );
}

/* --------------------------------------------------------------- WhatsApp official */

declare global {
  interface Window {
    FB?: { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}

function loadFacebook(appId: string, version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve();
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("sdk"));
    document.body.appendChild(s);
  });
}

/** wave 20: replaced on the page by the one-button WhatsApp card (components/integrations/whatsapp-connect.tsx) */
export function WhatsAppOfficialCard({ p }: { p: HubProps }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signup = useRef<{ phone_number_id?: string; waba_id?: string }>({});
  const c = p.channels.whatsapp;

  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        // v4 finish events: FINISH (+ variants such as FINISH_ONLY_WABA); waba_ids for multi-account flows
        if (data?.type === "WA_EMBEDDED_SIGNUP" && typeof data.event === "string" && data.event.startsWith("FINISH")) {
          signup.current = { phone_number_id: data.data?.phone_number_id, waba_id: data.data?.waba_id ?? data.data?.waba_ids?.[0] };
        }
      } catch {
        /* other messages */
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);

  async function connect() {
    if (!p.meta) return;
    setBusy(true);
    try {
      await loadFacebook(p.meta.appId, p.meta.version);
      window.FB!.login(
        (resp) => {
          const code = resp.authResponse?.code;
          if (!code) {
            setBusy(false);
            toast.error(t("integrations.whatsapp.cancelled"));
            return;
          }
          // the FINISH message can arrive a moment after the callback
          setTimeout(async () => {
            const r = await connectWhatsAppEmbeddedAction({ locale, code, phoneNumberId: signup.current.phone_number_id ?? "", wabaId: signup.current.waba_id ?? "" });
            setBusy(false);
            if (r.error) toast.error(t(r.error, r.messageParams));
            else {
              toast.success(t("integrations.channels.connected"));
              router.refresh();
            }
          }, 800);
        },
        // Embedded Signup v4: the version comes from the Facebook Login for Business configuration; extras stay minimal
        { config_id: p.meta.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } },
      );
    } catch {
      setBusy(false);
      toast.error(t("integrations.whatsapp.sdkFailed"));
    }
  }

  return (
    <HubCard icon={MessageCircle} title={t("integrations.hub.waTitle")} body={t("integrations.hub.waBody")} status={<Status on={c.connected} error={c.error} />} testId="whatsapp" tone="success">
      <AiLine on={c.connected && p.agent.channels.includes("whatsapp")} />
      {c.connected && c.label ? <p className="text-[13px] font-medium" dir="ltr">{c.label}</p> : null}
      {p.canManage ? (
        p.meta ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={connect} loading={busy} data-testid="wa-official-connect">
              <MessageCircle className="h-4 w-4" /> {t(c.connected ? "integrations.channels.reconnect" : "integrations.hub.waConnect")}
            </Button>
            {c.connected ? <ConfirmActionButton action={disconnectChannelAction} fields={{ kind: "whatsapp" }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} /> : null}
          </div>
        ) : (
          <p className="rounded-xl bg-elevated p-2.5 text-[12px] text-muted">{t("integrations.hub.waSoon")}</p>
        )
      ) : null}
    </HubCard>
  );
}

/* --------------------------------------------------------------- WhatsApp QR */

/** wave 20: replaced on the page by the one-button WhatsApp card (QR or an 8-character code) */
export function WhatsAppQrCard({ p }: { p: HubProps }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<QrState | null>(null);
  const c = p.channels.whatsapp_qr;

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const s = await whatsAppQrStatusAction({ locale });
      if (!alive) return;
      setSt((prev) => (s.status === "unknown" && prev ? prev : s));
      if (s.status === "connected") {
        toast.success(t("integrations.qr.connected"));
        setOpen(false);
        router.refresh();
        return;
      }
      timer = setTimeout(poll, 2500);
    };
    void (async () => {
      setSt({ status: "starting" });
      const s = await startWhatsAppQrAction({ locale });
      if (!alive) return;
      setSt(s);
      if (s.status === "connected") {
        setOpen(false);
        router.refresh();
        return;
      }
      timer = setTimeout(poll, 2500);
    })();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, locale, router, t]);

  if (!p.bridge) return null;
  return (
    <HubCard icon={QrCode} title={t("integrations.hub.qrTitle")} body={t("integrations.hub.qrBody")} status={<Status on={c.connected} error={c.error} />} testId="whatsapp_qr" tone="gold">
      <AiLine on={c.connected && p.agent.channels.includes("whatsapp_qr")} />
      <p className="flex items-start gap-1.5 rounded-xl bg-warning-soft p-2.5 text-[12px] text-warning">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("integrations.qr.warning")}
      </p>
      {c.connected && c.label ? <p className="text-[13px] font-medium" dir="ltr">{c.label}</p> : null}
      {p.canManage ? (
        <div className="flex flex-wrap gap-2">
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title={t("integrations.qr.title")}
            trigger={
              <Button variant={c.connected ? "secondary" : "primary"} data-testid="wa-qr-connect">
                <QrCode className="h-4 w-4" /> {t(c.connected ? "integrations.channels.reconnect" : "integrations.qr.scan")}
              </Button>
            }
          >
            <div className="space-y-3 text-center">
              <ol className="space-y-1 text-start text-[13px] text-muted">
                <li>1. {t("integrations.qr.step1")}</li>
                <li>2. {t("integrations.qr.step2")}</li>
                <li>3. {t("integrations.qr.step3")}</li>
              </ol>
              <div className="mx-auto grid h-72 w-72 place-items-center rounded-2xl border border-line bg-white p-3" data-testid="qr-box">
                {st?.status === "qr" && st.qr ? (
                  <Image src={st.qr} alt="QR" width={264} height={264} unoptimized />
                ) : st?.status === "not_configured" ? (
                  <p className="text-sm text-danger">{t("integrations.qr.notConfigured")}</p>
                ) : st?.status === "error" ? (
                  <p className="text-sm text-danger">{t("integrations.qr.failed")}</p>
                ) : (
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label={t("common.loading")} />
                )}
              </div>
              <p className="text-[12px] text-subtle">{t("integrations.qr.waiting")}</p>
            </div>
          </Dialog>
          {c.connected ? <ConfirmActionButton action={disconnectChannelV2Action} fields={{ kind: "whatsapp_qr" }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} /> : null}
        </div>
      ) : null}
    </HubCard>
  );
}

/* --------------------------------------------------------------- Telegram */

function TelegramCard({ p }: { p: HubProps }) {
  const { t } = useI18n();
  const c = p.channels.telegram;
  return (
    <HubCard icon={Send} title={t("integrations.hub.tgTitle")} body={t("integrations.hub.tgBody")} status={<Status on={c.connected} error={c.error} />} testId="telegram">
      <AiLine on={c.connected && p.agent.channels.includes("telegram")} />
      {c.connected && c.label ? (
        <a href={`https://t.me/${c.label.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline" dir="ltr">
          <ExternalLink className="h-3.5 w-3.5" /> {c.label}
        </a>
      ) : null}
      {p.canManage && p.encryption ? (
        <div className="flex flex-wrap gap-2">
          <FormDialog
            action={connectChannelAction}
            title={t("integrations.hub.tgTitle")}
            hidden={{ kind: "telegram" }}
            submitLabel={t("integrations.channels.connect")}
            trigger={
              <Button variant={c.connected ? "secondary" : "primary"} data-testid="tg-connect">
                <Send className="h-4 w-4 rtl:-scale-x-100" /> {t(c.connected ? "integrations.channels.reconnect" : "integrations.hub.tgConnect")}
              </Button>
            }
          >
            {(state) => <TelegramSteps state={state} />}
          </FormDialog>
          {c.connected ? <ConfirmActionButton action={disconnectChannelAction} fields={{ kind: "telegram" }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} /> : null}
        </div>
      ) : null}
    </HubCard>
  );
}

function TelegramSteps({ state }: { state: Parameters<typeof useFieldError>[0] }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  return (
    <div className="space-y-4">
      <ol className="space-y-2 rounded-xl bg-elevated p-3 text-[13px] leading-relaxed">
        <li>
          1. {t("integrations.tg.step1")}{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline" dir="ltr">
            @BotFather
          </a>
        </li>
        <li>2. {t("integrations.tg.step2")}</li>
        <li>3. {t("integrations.tg.step3")}</li>
        <li>4. {t("integrations.tg.step4")}</li>
      </ol>
      <Field label={t("integrations.channels.fields.bot_token")} htmlFor="hub-tg-token" error={err("bot_token")}>
        <Input id="hub-tg-token" name="bot_token" dir="ltr" type="password" autoComplete="off" placeholder="123456789:AA…" required />
      </Field>
    </div>
  );
}

/* --------------------------------------------------------------- Telegram personal account */

function TelegramUserCard({ p }: { p: HubProps }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<TgUserState | null>(null);
  const [pw, setPw] = useState("");
  const [sending, setSending] = useState(false);
  const c = p.channels.telegram_user ?? { connected: false };
  // wave 25: while the 2FA password form is on screen, polling pauses and the form stays — it must not
  // disappear / re-render under the user's fingers (a QR refresh used to swap it back to the QR code).
  const holdPw = useRef(false);
  holdPw.current = st?.status === "password";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (holdPw.current) {
        timer = setTimeout(poll, 2500);
        return;
      }
      const s = await telegramUserStatusAction({ locale });
      if (!alive) return;
      setSt((prev) => (prev?.status === "password" && s.status !== "connected" && s.status !== "error" ? prev : s.status === "unknown" && prev ? prev : s));
      if (s.status === "connected") {
        toast.success(t("integrations.tgUser.connected"));
        setOpen(false);
        router.refresh();
        return;
      }
      timer = setTimeout(poll, 2500);
    };
    void (async () => {
      setSt({ status: "starting" });
      const s = await startTelegramUserAction({ locale });
      if (!alive) return;
      setSt(s);
      if (s.status === "connected") {
        setOpen(false);
        router.refresh();
        return;
      }
      if (s.status !== "not_configured") timer = setTimeout(poll, 2500);
    })();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [open, locale, router, t]);

  if (!p.bridge) return null;
  return (
    <HubCard icon={UserRound} title={t("integrations.tgUser.title")} body={t("integrations.tgUser.body")} status={<Status on={c.connected} error={c.error} />} testId="telegram_user" tone="gold">
      <AiLine on={c.connected && p.agent.channels.includes("telegram_user")} />
      <p className="flex items-start gap-1.5 rounded-xl bg-warning-soft p-2.5 text-[12px] text-warning">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("integrations.tgUser.warning")}
      </p>
      {c.connected && c.label ? <p className="text-[13px] font-medium" dir="ltr">{c.label}</p> : null}
      {p.canManage ? (
        <div className="flex flex-wrap gap-2">
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title={t("integrations.tgUser.dialogTitle")}
            trigger={
              <Button variant={c.connected ? "secondary" : "primary"} data-testid="tg-user-connect">
                <QrCode className="h-4 w-4" /> {t(c.connected ? "integrations.channels.reconnect" : "integrations.tgUser.scan")}
              </Button>
            }
          >
            <div className="space-y-3 text-center">
              <ol className="space-y-1 text-start text-[13px] text-muted">
                <li>1. {t("integrations.tgUser.step1")}</li>
                <li>2. {t("integrations.tgUser.step2")}</li>
                <li>3. {t("integrations.tgUser.step3")}</li>
              </ol>
              {st?.status === "password" ? (
                <form
                  className="space-y-2 text-start"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setSending(true);
                    const r = await telegramUserPasswordAction({ locale, password: pw });
                    setSending(false);
                    setPw("");
                    if (r.status === "error") toast.error(t("integrations.tgUser.passwordFailed"));
                    else setSt({ status: "starting" });
                  }}
                >
                  <Field label={t("integrations.tgUser.password")} htmlFor="tg-user-pw" hint={st.hint ? t("integrations.tgUser.hint", { hint: st.hint }) : undefined}>
                    <Input id="tg-user-pw" name="tg-user-pw" type="password" dir="ltr" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} required />
                  </Field>
                  <Button type="submit" loading={sending} className="w-full">
                    <KeyRound className="h-4 w-4" /> {t("integrations.tgUser.continue")}
                  </Button>
                </form>
              ) : (
                <div className="mx-auto grid h-72 w-72 place-items-center rounded-2xl border border-line bg-white p-3" data-testid="tg-qr-box">
                  {st?.status === "qr" && st.qr ? (
                    <Image src={st.qr} alt="QR" width={264} height={264} unoptimized />
                  ) : st?.status === "not_configured" ? (
                    <p className="text-sm text-danger">{t("integrations.tgUser.notConfigured")}</p>
                  ) : st?.status === "error" ? (
                    <p className="text-sm text-danger">{t("integrations.qr.failed")}</p>
                  ) : (
                    <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label={t("common.loading")} />
                  )}
                </div>
              )}
              <p className="text-[12px] text-subtle">{t("integrations.qr.waiting")}</p>
            </div>
          </Dialog>
          {c.connected ? <ConfirmActionButton action={disconnectChannelV2Action} fields={{ kind: "telegram_user" }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} /> : null}
        </div>
      ) : null}
    </HubCard>
  );
}

/* --------------------------------------------------------------- e-mail */

function EmailCard({ p }: { p: HubProps }) {
  const { t, locale } = useI18n();
  const c = p.channels.email;
  return (
    <HubCard icon={Mail} title={t("integrations.hub.mailTitle")} body={t("integrations.hub.mailBody")} status={<Status on={c.connected} error={c.error} />} testId="email">
      <AiLine on={c.connected && p.agent.channels.includes("email")} />
      {c.connected && c.address ? <p className="text-[13px] font-medium" dir="ltr">{c.address}</p> : null}
      {c.error ? <p className="text-[12px] text-danger">{c.error}</p> : null}
      {p.canManage && p.encryption ? (
        <div className="flex flex-wrap gap-2">
          {p.oauth.google ? (
            <a href={`/api/oauth/google/start?locale=${locale}`} className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-hover" data-testid="mail-google">
              <span className="font-bold text-[#4285F4]">G</span> {t("integrations.mail.google")}
            </a>
          ) : null}
          {p.oauth.microsoft ? (
            <a href={`/api/oauth/microsoft/start?locale=${locale}`} className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-hover" data-testid="mail-microsoft">
              <span className="font-bold text-[#00A4EF]">⊞</span> {t("integrations.mail.microsoft")}
            </a>
          ) : null}
          <FormDialog
            action={connectMailboxAction}
            title={t("integrations.mail.title")}
            submitLabel={t("integrations.channels.connect")}
            trigger={
              <Button variant={p.oauth.google || p.oauth.microsoft ? "secondary" : "primary"} data-testid="mail-connect">
                <Mail className="h-4 w-4" /> {t(p.oauth.google || p.oauth.microsoft ? "integrations.mail.other" : "integrations.mail.connect")}
              </Button>
            }
          >
            {(state) => <MailFields state={state} />}
          </FormDialog>
          {c.connected ? <ConfirmActionButton action={disconnectChannelV2Action} fields={{ kind: "email" }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} /> : null}
        </div>
      ) : null}
    </HubCard>
  );
}

function MailFields({ state }: { state: Parameters<typeof useFieldError>[0] & { values?: Record<string, string> } }) {
  const { t } = useI18n();
  const err = useFieldError(state);
  const [advanced, setAdvanced] = useState(Boolean(state.values?.imap_host));
  const v = (k: string) => state.values?.[k] ?? "";
  return (
    <div className="space-y-4">
      <ol className="space-y-1.5 rounded-xl bg-elevated p-3 text-[13px] leading-relaxed">
        <li>1. {t("integrations.mail.step1")}</li>
        <li>
          2. {t("integrations.mail.step2")}{" "}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline">
            Gmail
          </a>
          {" · "}
          <a href="https://account.live.com/proofs/AppPassword" target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline">
            Outlook
          </a>
        </li>
        <li>3. {t("integrations.mail.step3")}</li>
      </ol>
      <Field label={t("integrations.mail.address")} htmlFor="mail-address" error={err("address")}>
        <Input id="mail-address" name="address" type="email" dir="ltr" autoComplete="email" defaultValue={v("address")} required />
      </Field>
      <Field label={t("integrations.mail.password")} htmlFor="mail-password" hint={t("integrations.mail.passwordHint")} error={err("password")}>
        <Input id="mail-password" name="password" type="password" dir="ltr" autoComplete="off" required />
      </Field>
      <Field label={t("integrations.mail.displayName")} htmlFor="mail-name">
        <Input id="mail-name" name="display_name" defaultValue={v("display_name")} />
      </Field>
      <button type="button" className="text-[12.5px] font-medium text-accent hover:underline" onClick={() => setAdvanced((a) => !a)}>
        {t("integrations.mail.advanced")}
      </button>
      {advanced ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_96px]">
          <Field label="IMAP" htmlFor="mail-imap">
            <Input id="mail-imap" name="imap_host" dir="ltr" placeholder="imap.example.com" defaultValue={v("imap_host")} />
          </Field>
          <Field label={t("integrations.mail.port")} htmlFor="mail-imap-port">
            <Input id="mail-imap-port" name="imap_port" dir="ltr" inputMode="numeric" placeholder="993" defaultValue={v("imap_port")} />
          </Field>
          <Field label="SMTP" htmlFor="mail-smtp">
            <Input id="mail-smtp" name="smtp_host" dir="ltr" placeholder="smtp.example.com" defaultValue={v("smtp_host")} />
          </Field>
          <Field label={t("integrations.mail.port")} htmlFor="mail-smtp-port">
            <Input id="mail-smtp-port" name="smtp_port" dir="ltr" inputMode="numeric" placeholder="465" defaultValue={v("smtp_port")} />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- wa.me link */

function WhatsAppLinkCard() {
  const { t } = useI18n();
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  const link = digits.length >= 9 ? `https://wa.me/${digits}${msg.trim() ? `?text=${encodeURIComponent(msg.trim())}` : ""}` : "";
  return (
    <HubCard icon={Link2} title={t("integrations.hub.linkTitle")} body={t("integrations.hub.linkBody")} status={<Badge tone="success">{t("integrations.hub.noSetup")}</Badge>} testId="walink" tone="success">
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label={t("integrations.hub.linkPhone")} placeholder={t("integrations.hub.linkPhone")} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input aria-label={t("integrations.hub.linkText")} placeholder={t("integrations.hub.linkText")} value={msg} onChange={(e) => setMsg(e.target.value)} />
      </div>
      {link ? <CopyBox label={t("integrations.hub.linkReady")} value={link} /> : null}
    </HubCard>
  );
}

/* --------------------------------------------------------------- hub */

export function ConnectHub(p: HubProps) {
  const { t, locale } = useI18n();
  return (
    <section className="mb-4 space-y-3" data-testid="connect-hub">
      {!p.agent.exists ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-accent/30 bg-accent-soft/50 p-4 sm:flex-row sm:items-center">
          <Sparkles className="h-5 w-5 shrink-0 text-accent" />
          <p className="flex-1 text-[13.5px]">{t("integrations.hub.noAgent")}</p>
          <a href={`/${locale}/ai-agents`} className="text-sm font-semibold text-accent hover:underline">
            {t("integrations.hub.createAgent")}
          </a>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-success/25 bg-success-soft/60 px-4 py-3 text-[13.5px]">
          <Bot className="h-5 w-5 text-success" />
          <span className="flex-1">{t("integrations.hub.agentReady", { name: p.agent.name ?? "" })}</span>
          <a href={`/${locale}/ai-agents`} className="text-[13px] font-medium text-accent hover:underline">
            {t("integrations.hub.agentSettings")}
          </a>
        </div>
      )}
      <div>
        <h2 className="text-base font-semibold">{t("integrations.hub.title")}</h2>
        <p className="text-[13px] text-muted">{t("integrations.hub.subtitle")}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <WebChatCard p={p} />
        {/* wave 20: WhatsApp (official + QR + code) lives in the one-button card at the top of the page */}
        <TelegramCard p={p} />
        <TelegramUserCard p={p} />
        <EmailCard p={p} />
        <WhatsAppLinkCard />
      </ul>
    </section>
  );
}
