"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Bot, CheckCircle2, CircleDashed, Copy, MessageCircle, QrCode, RefreshCw, ShieldCheck, Smartphone, TriangleAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { connectWhatsAppEmbeddedAction, disconnectChannelAction, disconnectChannelV2Action, startWhatsAppQrAction, whatsAppQrStatusAction, type QrState } from "@/app/[locale]/(dashboard)/integrations/actions";
import { pairWhatsAppAction } from "@/app/[locale]/(dashboard)/integrations/whatsapp-actions";
import { cn } from "@/lib/utils";
import { waitForSignup } from "@/lib/channels/wa-signup-wait";

/**
 * Wave 20 — WhatsApp in one button.
 *  - Meta configured by the platform → the official popup (Embedded Signup), recommended.
 *  - The bridge is running → connect from the phone right away: scan a QR (computer) or type an
 *    8-character code (the same phone — it can't scan its own screen). Detected automatically.
 *  - Both → a short choice. Neither → customers never see setup instructions; platform admins get
 *    a link to the setup wizard.
 */
export interface WaConnectProps {
  meta: { appId: string; configId: string; version: string } | null;
  bridge: boolean;
  official: { connected: boolean; label?: string | null; error?: string | null };
  quick: { connected: boolean; label?: string | null; error?: string | null };
  canManage: boolean;
  aiOn: boolean;
  platformAdmin: boolean;
}

declare global {
  interface Window {
    FB?: { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}

const WA_FULL_PAGE = true;

function loadFacebook(appId: string, version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.FB) {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      return resolve();
    }
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

/** A phone (touch screen, narrow) — the code is the default there, the QR on a computer. */
function subscribeCoarse(cb: () => void) {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function useIsPhone() {
  return useSyncExternalStore(
    subscribeCoarse,
    () => window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900,
    () => false,
  );
}

type Step = "choose" | "quick" | "done";
type Mode = "qr" | "code";

export function WhatsAppConnect(p: WaConnectProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [mode, setMode] = useState<Mode | null>(null);
  const [busyOfficial, setBusyOfficial] = useState(false);
  const signup = useRef<{ phone_number_id?: string; waba_id?: string }>({});
  const connected = p.official.connected || p.quick.connected;
  const methods = { official: Boolean(p.meta), quick: p.bridge };
  const activeMode: Mode = mode ?? (isPhone ? "code" : "qr");

  // Embedded Signup sends the chosen number in a window message
  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      try {
        if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
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

  async function connectOfficial() {
    if (!p.meta) return;
    setBusyOfficial(true);
    if (WA_FULL_PAGE) {
      // wave 26: the Embedded Signup popup returns a code Meta refuses to exchange; the full-page flow uses one fixed redirect_uri
      window.location.href = `/api/channels/meta/pages/oauth?locale=${locale}&kind=wa`;
      return;
    }
    try {
      await loadFacebook(p.meta.appId, p.meta.version);
      window.FB!.login(
        (resp) => {
          const code = resp.authResponse?.code;
          if (!code) {
            setBusyOfficial(false);
            toast.error(t("integrations.whatsapp.cancelled"));
            return;
          }
          void (async () => {
            await waitForSignup(signup);
            const r = await connectWhatsAppEmbeddedAction({ locale, code, phoneNumberId: signup.current.phone_number_id ?? "", wabaId: signup.current.waba_id ?? "" });
            setBusyOfficial(false);
            if (r.error) toast.error(t(r.error, r.messageParams));
            else {
              setOpen(false);
              toast.success(t("integrations.wa.connected"));
              router.refresh();
            }
          })();
        },
        { config_id: p.meta.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } },
      );
    } catch {
      setBusyOfficial(false);
      toast.error(t("integrations.whatsapp.sdkFailed"));
    }
  }

  function start() {
    if (methods.official && !methods.quick) return void connectOfficial();
    setStep(methods.official && methods.quick ? "choose" : "quick");
    setMode(null);
    setOpen(true);
  }

  const methodLabel = p.official.connected ? t("integrations.wa.viaOfficial") : t("integrations.wa.viaPhone");
  const label = p.official.connected ? p.official.label : p.quick.label;
  const error = p.official.error ?? p.quick.error;

  return (
    <section className="wa-hero mb-5 overflow-hidden rounded-[1.5rem] border border-line bg-surface" data-testid="wa-hero" data-hub="whatsapp">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <span className="wa-mark grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-white" aria-hidden>
          <MessageCircle className="h-7 w-7" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="me-auto text-[19px] font-bold leading-tight">{t("integrations.wa.title")}</h2>
            {error ? (
              <Badge tone="danger">
                <TriangleAlert className="me-1 inline h-3.5 w-3.5" /> {t("integrations.channels.error")}
              </Badge>
            ) : connected ? (
              <Badge tone="success">
                <CheckCircle2 className="me-1 inline h-3.5 w-3.5" /> {t("integrations.connected")}
              </Badge>
            ) : (
              <Badge tone="neutral">
                <CircleDashed className="me-1 inline h-3.5 w-3.5" /> {t("integrations.notConnected")}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{t("integrations.wa.body")}</p>
          {connected ? (
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              {label ? (
                <bdi dir="ltr" className="font-semibold">
                  {label}
                </bdi>
              ) : null}
              <span className="text-muted">{methodLabel}</span>
              <span className={cn("inline-flex items-center gap-1", p.aiOn ? "text-success" : "text-subtle")}>
                <Bot className="h-3.5 w-3.5" /> {t(p.aiOn ? "integrations.hub.aiOn" : "integrations.hub.aiOff")}
              </span>
            </p>
          ) : null}
        </div>
        {p.canManage ? (
          <div className="flex flex-col gap-2 sm:items-end">
            {methods.official || methods.quick ? (
              <Button onClick={start} loading={busyOfficial} className="h-12 w-full px-6 text-[15px] sm:w-auto" data-testid="wa-connect">
                <MessageCircle className="h-5 w-5" /> {t(connected ? "integrations.wa.reconnect" : "integrations.wa.connect")}
              </Button>
            ) : p.platformAdmin ? (
              <a href={`/${locale}/admin#setup`} className="inline-flex h-11 items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold text-accent hover:bg-surface-hover" data-testid="wa-setup-link">
                {t("integrations.wa.adminSetup")}
              </a>
            ) : (
              <Badge tone="neutral">{t("integrations.wa.soon")}</Badge>
            )}
            {p.official.connected ? (
              <ConfirmActionButton action={disconnectChannelAction} fields={{ kind: "whatsapp" }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} />
            ) : p.quick.connected ? (
              <ConfirmActionButton action={disconnectChannelV2Action} fields={{ kind: "whatsapp_qr" }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} />
            ) : null}
          </div>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen} title={step === "done" ? t("integrations.wa.doneTitle") : t("integrations.wa.dialogTitle")}>
        {step === "choose" ? (
          <div className="space-y-2.5" data-testid="wa-choose">
            <button type="button" onClick={() => void connectOfficial()} disabled={busyOfficial} className="flex w-full items-start gap-3 rounded-2xl border border-success/40 bg-success-soft/40 p-4 text-start transition hover:border-success disabled:opacity-60" data-testid="wa-choose-official">
              <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-success" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-semibold">
                  {t("integrations.wa.officialTitle")} <Badge tone="success">{t("integrations.wa.recommended")}</Badge>
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{t("integrations.wa.officialBody")}</span>
              </span>
            </button>
            <button type="button" onClick={() => setStep("quick")} className="flex w-full items-start gap-3 rounded-2xl border border-line p-4 text-start transition hover:border-accent" data-testid="wa-choose-quick">
              <Zap className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t("integrations.wa.quickTitle")}</span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{t("integrations.wa.quickBody")}</span>
              </span>
            </button>
          </div>
        ) : step === "quick" ? (
          <QuickConnect
            mode={activeMode}
            onMode={setMode}
            onConnected={() => {
              setStep("done");
              router.refresh();
              setTimeout(() => setOpen(false), 1800);
            }}
          />
        ) : (
          <div className="space-y-3 py-6 text-center" data-testid="wa-done">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success-soft text-success">
              <CheckCircle2 className="h-9 w-9" />
            </span>
            <p className="text-[15px] font-semibold">{t("integrations.wa.connected")}</p>
            <p className="text-[13px] text-muted">{t("integrations.wa.doneBody")}</p>
          </div>
        )}
      </Dialog>
    </section>
  );
}

/* ------------------------------------------------------------------ quick: QR or code */

function QuickConnect({ mode, onMode, onConnected }: { mode: Mode; onMode: (m: Mode) => void; onConnected: () => void }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-elevated p-1" role="tablist" aria-label={t("integrations.wa.dialogTitle")}>
        {(["qr", "code"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => onMode(m)}
            className={cn("flex h-11 items-center justify-center gap-2 rounded-xl text-[14px] font-semibold transition", mode === m ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
            data-testid={`wa-tab-${m}`}
          >
            {m === "qr" ? <QrCode className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            {t(m === "qr" ? "integrations.wa.tabQr" : "integrations.wa.tabCode")}
          </button>
        ))}
      </div>
      {mode === "qr" ? <QrPanel onConnected={onConnected} /> : <CodePanel onConnected={onConnected} />}
      <p className="flex items-start gap-1.5 rounded-xl bg-warning-soft/70 p-2.5 text-[12px] leading-relaxed text-warning">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("integrations.wa.unofficial")}
      </p>
    </div>
  );
}

/** Polls the bridge until WhatsApp reports the device as linked. */
function useLinkedPoll(active: boolean, onConnected: () => void, onState?: (s: QrState) => void) {
  const { locale } = useI18n();
  const cb = useRef({ onConnected, onState });
  useEffect(() => {
    cb.current = { onConnected, onState };
  });
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const s = await whatsAppQrStatusAction({ locale });
      if (!alive) return;
      cb.current.onState?.(s);
      if (s.status === "connected") return cb.current.onConnected();
      timer = setTimeout(poll, 2500);
    };
    timer = setTimeout(poll, 2500);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [active, locale]);
}

function QrPanel({ onConnected }: { onConnected: () => void }) {
  const { t, locale } = useI18n();
  const [st, setSt] = useState<QrState>({ status: "starting" });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await startWhatsAppQrAction({ locale });
      if (!alive) return;
      setSt(s);
      if (s.status === "connected") onConnected();
      else setReady(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once per opening
  }, [locale]);
  useLinkedPoll(ready, onConnected, (s) => setSt((prev) => (s.status === "unknown" ? prev : s)));
  return (
    <div className="space-y-3 text-center">
      <ol className="space-y-1.5 text-start text-[13.5px] leading-relaxed">
        <li className="flex gap-2">
          <span className="step-dot">1</span> {t("integrations.qr.step1")}
        </li>
        <li className="flex gap-2">
          <span className="step-dot">2</span> {t("integrations.qr.step2")}
        </li>
        <li className="flex gap-2">
          <span className="step-dot">3</span> {t("integrations.qr.step3")}
        </li>
      </ol>
      <div className="mx-auto grid aspect-square w-full max-w-[280px] place-items-center rounded-2xl border border-line bg-white p-3" data-testid="qr-box">
        {st.status === "qr" && st.qr ? (
          <Image src={st.qr} alt={t("integrations.wa.qrAlt")} width={256} height={256} unoptimized className="h-auto w-full" />
        ) : st.status === "not_configured" ? (
          <p className="text-sm text-danger">{t("integrations.qr.notConfigured")}</p>
        ) : st.status === "error" ? (
          <p className="text-sm text-danger">{t("integrations.qr.failed")}</p>
        ) : (
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label={t("common.loading")} />
        )}
      </div>
      <p className="text-[12px] text-subtle">{t("integrations.qr.waiting")}</p>
    </div>
  );
}

function CodePanel({ onConnected }: { onConnected: () => void }) {
  const { t, locale } = useI18n();
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useLinkedPoll(Boolean(code), onConnected);
  async function getCode() {
    setBusy(true);
    setErr(null);
    const r = await pairWhatsAppAction({ locale, phone });
    setBusy(false);
    if (r.status === "connected") return onConnected();
    if (r.status === "code" && r.code) setCode(r.code);
    else setErr(r.status === "not_configured" ? "integrations.qr.notConfigured" : (r.error ?? "integrations.wa.codeFailed"));
  }
  if (!code)
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void getCode();
        }}
      >
        <p className="text-[13.5px] leading-relaxed text-muted">{t("integrations.wa.codeIntro")}</p>
        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium">{t("integrations.wa.phoneLabel")}</span>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="050-123-4567" className="h-12 text-[17px] tracking-wide" required data-testid="wa-pair-phone" />
        </label>
        {err ? <p className="text-[13px] text-danger">{t(err)}</p> : null}
        <Button type="submit" loading={busy} className="h-12 w-full text-[15px]" data-testid="wa-pair-submit">
          {t("integrations.wa.getCode")}
        </Button>
      </form>
    );
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-accent/30 bg-accent-soft/40 p-4 text-center">
        <p className="text-[12.5px] text-muted">{t("integrations.wa.yourCode")}</p>
        <p className="pair-code mt-1 select-all" dir="ltr" data-testid="wa-pair-code">
          {code}
        </p>
        <div className="mt-2 flex justify-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(code.replace("-", ""));
              toast.success(t("common.copied"));
            }}
          >
            <Copy className="h-3.5 w-3.5" /> {t("common.copy")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCode(null);
              setErr(null);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> {t("integrations.wa.newCode")}
          </Button>
        </div>
      </div>
      <ol className="space-y-1.5 text-[13.5px] leading-relaxed">
        <li className="flex gap-2">
          <span className="step-dot">1</span> {t("integrations.wa.codeStep1")}
        </li>
        <li className="flex gap-2">
          <span className="step-dot">2</span> {t("integrations.wa.codeStep2")}
        </li>
        <li className="flex gap-2">
          <span className="step-dot">3</span> {t("integrations.wa.codeStep3")}
        </li>
        <li className="flex gap-2">
          <span className="step-dot">4</span> {t("integrations.wa.codeStep4")}
        </li>
      </ol>
      <p className="flex items-center justify-center gap-2 text-[12.5px] text-subtle">
        <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden /> {t("integrations.wa.waitingLink")}
      </p>
    </div>
  );
}
