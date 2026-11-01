"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronDown, Copy, ExternalLink, KeyRound, Link2, RefreshCw, ShieldCheck, Sparkles, UserPlus, Webhook } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { cn } from "@/lib/utils";
import { needsAlternative, ownAppSteps } from "@/lib/channels/meta-own-core";
import { markTesterRequestAction, removeOwnAppAction, requestTesterAction, retryOwnWebhooksAction, revealOwnVerifyTokenAction, saveOwnAppAction } from "@/app/[locale]/(dashboard)/integrations/meta-own-actions";

/**
 * "Facebook / Instagram not connecting?" — two ways that work for every business while the platform's Meta app is
 * still in review: (1) be added as a tester of the platform app — automatic, then the normal button works;
 * (2) connect through your own free Meta app — fully independent, works at once.
 */
export interface MetaAltProps {
  appUrl: string;
  canManage: boolean;
  platformAdmin: boolean;
  testerReady: boolean;
  facebookConnected: boolean;
  connectedMode: string | null;
  ownApp: { appId: string; appName: string | null; configId: string | null; status: "saved" | "connected" | "error"; webhooksOk: boolean; lastError: string | null } | null;
  requests: { id: string; profile_ref: string; status: string; created_at: string }[];
  adminQueue: { id: string; org_name: string; profile_ref: string; fb_user: string | null; last_error: string | null; created_at: string }[];
}

function Copyable({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
      {label ? <span className="shrink-0 text-[11.5px] text-subtle">{label}</span> : null}
      <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-elevated px-2.5 py-1.5 text-[11.5px]">
        {value}
      </code>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("common.copy")}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          toast.success(t("common.copied"));
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function Option({ n, icon: Icon, title, badge, body, open, onToggle, children, tone }: { n: number; icon: typeof UserPlus; title: string; badge: string; body: string; open: boolean; onToggle: () => void; children: React.ReactNode; tone: string }) {
  return (
    <div className={cn("glow-ring overflow-hidden rounded-3xl border bg-surface transition", open ? "border-accent/40 shadow-md" : "border-line")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-start">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-sm", tone)}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{n}</span>
            <span className="font-bold">{title}</span>
            <Badge tone="success">{badge}</Badge>
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">{body}</span>
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-subtle transition", open && "rotate-180")} />
      </button>
      {open ? <div className="space-y-3 border-t border-line p-4">{children}</div> : null}
    </div>
  );
}

export function MetaAlternatives(p: MetaAltProps) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState<0 | 1 | 2>(p.ownApp ? 2 : 0);
  const [highlight, setHighlight] = useState(false);
  const [profile, setProfile] = useState("");
  const [appId, setAppId] = useState(p.ownApp?.appId ?? "");
  const [secret, setSecret] = useState("");
  const [configId, setConfigId] = useState(p.ownApp?.configId ?? "");
  const [advanced, setAdvanced] = useState(Boolean(p.ownApp?.configId));
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<{ token: string; callback: string } | null>(null);
  const root = useRef<HTMLElement>(null);
  const seen = useRef(false);

  // a failed one-click connection ("App not active" / app in review) or the own-app flow coming back → open this section
  useEffect(() => {
    if (seen.current) return;
    const meta = sp.get("meta");
    const own = sp.get("metaown");
    const detail = sp.get("detail") ?? "";
    if (!meta && !own) return;
    seen.current = true;
    const timer = setTimeout(() => {
      if (own) {
        const [key, raw] = detail.includes("|") ? detail.split("|") : [detail, ""];
        if (own === "connected") toast.success(t("metaAlt.own.connected", { page: detail }));
        else if (own === "choose") toast(t("market.meta.choose"));
        else if (own === "cancelled") toast(t("integrations.meta.cancelled"));
        else if (own === "no_app") toast.error(t("metaAlt.err.noApp"));
        else if (own === "forbidden") toast.error(t("errors.forbidden"));
        else toast.error(/^[a-zA-Z]+(\.[A-Za-z_]+)+$/.test(key ?? "") ? `${t(key!)}${raw ? ` — ${raw}` : ""}` : t("metaAlt.err.unknown"));
        setOpen(2);
        setHighlight(true);
        root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        router.replace(`/${locale}/integrations#meta-alt`, { scroll: false });
      } else if (meta && meta !== "connected" && meta !== "choose" && (needsAlternative(detail) || meta === "failed" || meta === "not_configured")) {
        setHighlight(true);
        root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [sp, t, router, locale]);

  if (!p.canManage) return null;
  const steps = ownAppSteps(p.appUrl);
  const viaOwn = p.connectedMode === "own_app";

  async function invite() {
    setBusy("tester");
    const r = await requestTesterAction({ locale, profile });
    setBusy(null);
    if (r.error) return toast.error(t(r.error));
    toast.success(t(r.message ?? "metaAlt.tester.queued"));
    setProfile("");
    router.refresh();
  }

  async function saveApp() {
    setBusy("save");
    const r = await saveOwnAppAction({ locale, appId, appSecret: secret, configId: advanced ? configId : "" });
    setBusy(null);
    if (r.error) return toast.error(`${t(r.error)}${r.messageParams?.detail ? ` — ${r.messageParams.detail}` : ""}`);
    toast.success(t(r.message ?? "metaAlt.savedWithHooks", r.messageParams));
    setSecret("");
    router.refresh();
  }

  return (
    <section ref={root} id="meta-alt" className={cn("shine-border mb-6 scroll-mt-24 space-y-3 rounded-[28px] border p-4 sm:p-5 transition", highlight ? "border-accent/50 bg-accent-soft/40 shadow-lg ring-2 ring-accent/20" : "border-line bg-gradient-to-br from-blue-500/[0.06] via-fuchsia-500/[0.04] to-transparent")} data-testid="meta-alt">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-fuchsia-500 text-white shadow-md">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{t("metaAlt.title")}</h2>
          <p className="text-[13px] leading-relaxed text-muted">{t("metaAlt.subtitle")}</p>
        </div>
        {p.facebookConnected ? (
          <Badge tone="success">
            <CheckCircle2 className="me-1 inline h-3.5 w-3.5" /> {t(viaOwn ? "metaAlt.connectedOwn" : "integrations.connected")}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* 1 — tester of the platform app */}
        <Option n={1} icon={UserPlus} tone="bg-gradient-to-br from-emerald-500 to-teal-500" title={t("metaAlt.tester.title")} badge={t("metaAlt.tester.badge")} body={t("metaAlt.tester.body")} open={open === 1} onToggle={() => setOpen(open === 1 ? 0 : 1)}>
          {p.testerReady ? (
            <>
              <ol className="list-decimal space-y-1.5 ps-5 text-[12.5px] leading-relaxed text-muted">
                <li>{t("metaAlt.tester.s1")}</li>
                <li>{t("metaAlt.tester.s2")}</li>
                <li>
                  {t("metaAlt.tester.s3")}{" "}
                  <a href="https://developers.facebook.com/requests/" target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                    developers.facebook.com/requests <ExternalLink className="inline h-3 w-3" />
                  </a>
                </li>
                <li>{t("metaAlt.tester.s4")}</li>
              </ol>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input dir="ltr" value={profile} onChange={(e) => setProfile(e.target.value)} placeholder="https://facebook.com/your.name" aria-label={t("metaAlt.tester.profile")} className="flex-1" data-testid="tester-profile" />
                <Button onClick={invite} loading={busy === "tester"} disabled={profile.trim().length < 3} data-testid="tester-invite">
                  <UserPlus className="h-4 w-4" /> {t("metaAlt.tester.cta")}
                </Button>
              </div>
              <p className="text-[11.5px] text-subtle">{t("metaAlt.tester.hint")}</p>
              {p.requests.length ? (
                <ul className="space-y-1.5" data-testid="tester-requests">
                  {p.requests.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 rounded-xl bg-elevated px-3 py-2 text-[12.5px]">
                      <span dir="ltr" className="min-w-0 flex-1 truncate">{r.profile_ref}</span>
                      <Badge tone={r.status === "invited" || r.status === "done" ? "success" : r.status === "failed" ? "danger" : "warning"}>{t(`metaAlt.tester.status.${r.status}`)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="rounded-2xl bg-elevated p-3 text-[12.5px] text-muted">{t("metaAlt.tester.unavailable")}</p>
          )}
        </Option>

        {/* 2 — the business's own Meta app */}
        <Option n={2} icon={KeyRound} tone="bg-gradient-to-br from-blue-600 to-indigo-500" title={t("metaAlt.own.title")} badge={t("metaAlt.own.badge")} body={t("metaAlt.own.body")} open={open === 2} onToggle={() => setOpen(open === 2 ? 0 : 2)}>
          {p.ownApp ? (
            <div className="space-y-2 rounded-2xl bg-elevated p-3" data-testid="own-app-status">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <ShieldCheck className="h-4 w-4 text-success" />
                <span className="font-semibold">{p.ownApp.appName ?? t("metaAlt.own.appSaved")}</span>
                <code dir="ltr" className="text-[11.5px] text-subtle">{p.ownApp.appId}</code>
                <Badge tone={p.ownApp.status === "connected" ? "success" : p.ownApp.status === "error" ? "danger" : "warning"}>{t(`metaAlt.own.status.${p.ownApp.status}`)}</Badge>
                <Badge tone={p.ownApp.webhooksOk ? "success" : "warning"}>
                  <Webhook className="me-1 inline h-3 w-3" /> {t(p.ownApp.webhooksOk ? "metaAlt.own.hooksOn" : "metaAlt.own.hooksOff")}
                </Badge>
              </div>
              {p.ownApp.lastError ? (
                <p dir="ltr" className="break-words text-[11.5px] text-danger">
                  {p.ownApp.lastError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a href={`/api/channels/meta/own/oauth?locale=${locale}`} className={cn("btn-brand inline-flex items-center gap-2 rounded-xl bg-accent-solid px-4 py-2 text-[13px] font-semibold text-accent-fg shadow-sm hover:opacity-95", p.ownApp.status !== "connected" && "breathe")} data-testid="own-connect">
                  <Link2 className="h-4 w-4" /> {t(p.ownApp.status === "connected" ? "metaAlt.own.reconnect" : "metaAlt.own.connect")}
                </a>
                {!p.ownApp.webhooksOk ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === "hooks"}
                    onClick={async () => {
                      setBusy("hooks");
                      const r = await retryOwnWebhooksAction({ locale });
                      setBusy(null);
                      if (r.error) toast.error(`${t(r.error)}${r.messageParams?.detail ? ` — ${r.messageParams.detail}` : ""}`);
                      else toast.success(t(r.message ?? "metaAlt.hooksOk"));
                      router.refresh();
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> {t("metaAlt.own.retryHooks")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const r = await revealOwnVerifyTokenAction({ locale });
                    if (r.error || !r.data) return toast.error(t(r.error ?? "common.error"));
                    setManual(r.data);
                  }}
                >
                  <Webhook className="h-3.5 w-3.5" /> {t("metaAlt.own.manualHooks")}
                </Button>
                <ConfirmActionButton action={removeOwnAppAction} fields={{ locale }} size="sm" variant="ghost" label={t("metaAlt.own.remove")} confirm={t("metaAlt.own.removeConfirm")} />
              </div>
              {manual ? (
                <div className="space-y-1.5 rounded-xl border border-dashed border-line-strong p-2.5" data-testid="own-manual-hooks">
                  <p className="text-[12px] text-muted">{t("metaAlt.own.manualBody")}</p>
                  <Copyable label="Callback URL" value={manual.callback} />
                  <Copyable label="Verify token" value={manual.token} />
                </div>
              ) : null}
            </div>
          ) : null}

          <ol className="space-y-2.5">
            {steps.map((s, i) => (
              <li key={s.key} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{i + 1}</span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[12.5px] leading-relaxed">{t(`metaAlt.own.steps.${s.key}`)}</p>
                  {s.link ? (
                    <a href={s.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                      {t(`metaAlt.own.links.${s.key}`)} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  {s.copy ? <Copyable value={s.copy} /> : null}
                  {s.key === "keys" ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input dir="ltr" inputMode="numeric" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="App ID" aria-label="App ID" data-testid="own-app-id" />
                      <Input dir="ltr" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={p.ownApp ? t("metaAlt.own.secretKeep") : "App Secret"} aria-label="App Secret" data-testid="own-app-secret" />
                    </div>
                  ) : null}
                  {s.key === "keys" ? (
                    <>
                      <button type="button" onClick={() => setAdvanced(!advanced)} className="text-[11.5px] text-subtle hover:text-fg">
                        {t("metaAlt.own.advanced")}
                      </button>
                      {advanced ? <Input dir="ltr" inputMode="numeric" value={configId} onChange={(e) => setConfigId(e.target.value)} placeholder="Configuration ID (Facebook Login for Business)" aria-label="Configuration ID" /> : null}
                      <Button onClick={saveApp} loading={busy === "save"} disabled={appId.trim().length < 5 || secret.trim().length < 32} size="sm" data-testid="own-app-save">
                        <ShieldCheck className="h-4 w-4" /> {t("metaAlt.own.save")}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="rounded-2xl bg-elevated p-3 text-[11.5px] leading-relaxed text-subtle">🔒 {t("metaAlt.own.privacy")}</p>
        </Option>
      </div>

      {p.platformAdmin && p.adminQueue.length ? (
        <div className="space-y-2 rounded-2xl border border-dashed border-warning/50 bg-warning/5 p-3" data-testid="tester-admin-queue">
          <p className="text-[13px] font-semibold">{t("metaAlt.admin.title", { n: p.adminQueue.length })}</p>
          <p className="text-[12px] text-muted">{t("metaAlt.admin.body")}</p>
          <ul className="space-y-1.5">
            {p.adminQueue.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2 text-[12.5px]">
                <span className="font-medium">{r.org_name}</span>
                <span dir="ltr" className="min-w-0 flex-1 truncate text-muted">
                  {r.profile_ref}
                </span>
                {r.last_error ? (
                  <span dir="ltr" className="w-full truncate text-[11px] text-subtle">
                    {r.last_error}
                  </span>
                ) : null}
                <ConfirmActionButton action={markTesterRequestAction} fields={{ locale, id: r.id }} size="sm" variant="secondary" label={t("metaAlt.admin.done")} confirm={t("metaAlt.admin.doneConfirm")} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
