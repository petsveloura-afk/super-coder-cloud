"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Calendar, Camera, CheckCircle2, CircleDashed, Copy, ExternalLink, Mail, MessageCircle, MessagesSquare, Search, ShoppingBag, ShoppingCart, Star, TriangleAlert, Workflow, Zap, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { cn } from "@/lib/utils";
import { waitForSignup } from "@/lib/channels/wa-signup-wait";
import { chooseMetaPageAction, connectMetaPagesAction, disconnectMetaPagesAction, type MetaPageChoice } from "@/app/[locale]/(dashboard)/integrations/connect-actions";
import { connectWhatsAppEmbeddedAction } from "@/app/[locale]/(dashboard)/integrations/actions";

/**
 * Wave 19 — the integrations marketplace: every connection by category, each in as few steps as
 * the provider allows (one popup / one approval), with a plain-words status.
 */
export interface MarketProps {
  appUrl: string;
  canManage: boolean;
  /** wave 20: only platform admins see tiles that still need the one-time platform setup */
  platformAdmin?: boolean;
  metaPages: { appId: string; configId: string; version: string } | null;
  metaWa: { appId: string; configId: string; version: string } | null;
  facebook: { connected: boolean; label: string | null; error: string | null };
  instagram: { connected: boolean; label: string | null };
  whatsappMode: string | null;
  google: { configured: boolean; calendar: boolean; gmail: boolean; business: boolean; email: string | null };
  shopify: { configured: boolean; connected: boolean; shop: string | null; error: string | null; orders30: number; revenue30: number };
  woo: { connected: boolean; origin: string | null; pending: boolean; error: string | null };
  zapier: { hooks: number; apiAccess: boolean };
  others: { key: string; connected: boolean }[];
}

type Cat = "all" | "social" | "google" | "stores" | "automation" | "more";

declare global {
  interface Window {
    FB?: { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void };
    fbAsyncInit?: () => void;
  }
}

function loadFacebookSdk(appId: string, version: string): Promise<void> {
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

/** wave 25: load the Facebook script as soon as the tile appears, so the click opens the popup instantly (Safari/iPhone only allow a popup directly inside the tap). */
function usePreloadFacebook(cfg: { appId: string; version: string } | null) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    loadFacebookSdk(cfg.appId, cfg.version).then(
      () => alive && setReady(true),
      () => alive && setReady(false),
    );
    return () => {
      alive = false;
    };
  }, [cfg?.appId, cfg?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  return ready;
}

function State({ on, error, pending }: { on: boolean; error?: string | null; pending?: boolean }) {
  const { t } = useI18n();
  if (error)
    return (
      <Badge tone="danger">
        <TriangleAlert className="me-1 inline h-3.5 w-3.5" /> {t("integrations.channels.error")}
      </Badge>
    );
  if (pending) return <Badge tone="warning">{t("market.pending")}</Badge>;
  return on ? (
    <Badge tone="success">
      <CheckCircle2 className="me-1 inline h-3.5 w-3.5" /> {t("integrations.connected")}
    </Badge>
  ) : (
    <Badge tone="neutral">
      <CircleDashed className="me-1 inline h-3.5 w-3.5" /> {t("integrations.notConnected")}
    </Badge>
  );
}

function Tile({ icon: Icon, title, body, state, children, id, gradient, steps }: { icon: LucideIcon; title: string; body: string; state: React.ReactNode; children?: React.ReactNode; id: string; gradient: string; steps?: string }) {
  return (
    <li className="group flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" data-market={id}>
      <div className={cn("flex items-start gap-3 bg-gradient-to-br p-4", gradient)}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-surface/85 shadow-sm">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1 text-fg">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="me-auto font-bold">{title}</h3>
            {state}
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{body}</p>
        </div>
      </div>
      <div className="mt-auto space-y-2.5 p-4">
        {steps ? <p className="text-[11.5px] font-medium text-subtle">⚡ {steps}</p> : null}
        {children}
      </div>
    </li>
  );
}

function CopyLine({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
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

/** wave 20 — what a platform admin sees on a tile that still needs the one-time setup (customers never see it). */
function AdminSetup({ what }: { what: string }) {
  const { t, locale } = useI18n();
  return (
    <a href={`/${locale}/admin#setup`} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-line-strong p-2.5 text-[12.5px] font-medium text-accent hover:bg-surface-hover" data-testid={`setup-${what}`}>
      <span>{t("market.adminSetup")}</span>
      <span className="text-[11.5px] text-subtle">{t("market.adminOnly")}</span>
    </a>
  );
}

/* ----------------------------------------------------------- Facebook + Instagram */
function MetaTile({ p }: { p: MarketProps }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [choose, setChoose] = useState<{ pages: MetaPageChoice[]; sealed: string } | null>(null);
  const sdkReady = usePreloadFacebook(p.metaPages);
  // wave 25: Pages the business must pick after the full-page flow come back in a short cookie
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const m = document.cookie.match(/(?:^|; )scc_meta_choose=([^;]*)/);
      if (!m) return;
      document.cookie = `scc_meta_choose=; Max-Age=0; path=/${locale}/integrations`;
      const j = JSON.parse(decodeURIComponent(m[1]!)) as { pages?: MetaPageChoice[]; sealed?: string };
      if (j.pages?.length && j.sealed) timer = setTimeout(() => setChoose({ pages: j.pages!, sealed: j.sealed! }), 0);
    } catch {
      /* no pending choice */
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [locale]);
  const fullPageUrl = `/api/channels/meta/pages/oauth?locale=${locale}`;
  async function connect() {
    if (!p.metaPages) return;
    // no popup possible (script still loading / blocked): go through the full-page flow instead of showing a false "popup blocked"
    if (!sdkReady || !window.FB) {
      window.location.assign(new URL(fullPageUrl, window.location.origin).toString());
      return;
    }
    setBusy(true);
    try {
      window.FB.login(
        async (resp) => {
          const code = resp.authResponse?.code;
          if (!code) {
            setBusy(false);
            toast.error(t("integrations.meta.cancelled"));
            return;
          }
          const r = await connectMetaPagesAction({ locale, code });
          setBusy(false);
          if (r.error) toast.error(t(r.error, r.messageParams));
          else if (r.data?.choose && r.data.sealed) setChoose({ pages: r.data.choose, sealed: r.data.sealed });
          else {
            toast.success(t(r.message ?? "integrations.channels.connected", r.messageParams));
            router.refresh();
          }
        },
        { config_id: p.metaPages.configId, response_type: "code", override_default_response_type: true },
      );
    } catch {
      setBusy(false);
      window.location.assign(new URL(fullPageUrl, window.location.origin).toString());
    }
  }
  return (
    <Tile
      id="meta"
      icon={MessagesSquare}
      title={t("market.meta.title")}
      body={t("market.meta.body")}
      gradient="from-blue-500/15 via-fuchsia-500/10 to-transparent"
      state={<State on={p.facebook.connected} error={p.facebook.error} />}
      steps={t("market.oneClick")}
    >
      {p.facebook.connected ? (
        <p className="text-[13px] font-medium">
          {p.facebook.label}
          {p.instagram.connected ? <span className="text-muted"> · {p.instagram.label}</span> : null}
        </p>
      ) : null}
      {choose ? (
        <div className="space-y-2 rounded-2xl bg-elevated p-3" data-testid="meta-choose">
          <p className="text-[13px] font-medium">{t("market.meta.choose")}</p>
          {choose.pages.map((pg) => (
            <Button
              key={pg.id}
              variant="secondary"
              size="sm"
              className="w-full justify-between"
              onClick={async () => {
                const r = await chooseMetaPageAction({ locale, sealed: choose.sealed, pageId: pg.id });
                if (r.error) toast.error(t(r.error));
                else {
                  toast.success(t(r.message ?? "integrations.channels.connected", r.messageParams));
                  setChoose(null);
                  router.refresh();
                }
              }}
            >
              <span>{pg.name}</span>
              {pg.instagram ? <span className="text-[11.5px] text-muted">@{pg.instagram}</span> : null}
            </Button>
          ))}
        </div>
      ) : null}
      {p.canManage ? (
        p.metaPages ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={connect} loading={busy} data-testid="meta-connect">
              <MessagesSquare className="h-4 w-4" /> {t(p.facebook.connected ? "integrations.channels.reconnect" : "market.meta.connect")}
            </Button>
            {p.facebook.connected ? <ConfirmActionButton action={disconnectMetaPagesAction} fields={{ locale }} size="sm" variant="ghost" label={t("integrations.channels.disconnect")} confirm={t("integrations.channels.confirmDisconnect")} /> : null}
          </div>
        ) : (
          <AdminSetup what="meta" />
        )
      ) : null}
    </Tile>
  );
}

/* ----------------------------------------------------------- WhatsApp Business app (same number) */
function WhatsAppAppTile({ p }: { p: MarketProps }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signup = useRef<{ phone_number_id?: string; waba_id?: string }>({});
  const waSdkReady = usePreloadFacebook(p.metaWa);
  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      try {
        if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && typeof data.event === "string" && data.event.startsWith("FINISH")) signup.current = { phone_number_id: data.data?.phone_number_id, waba_id: data.data?.waba_id ?? data.data?.waba_ids?.[0] };
      } catch {
        /* other messages */
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  async function connect() {
    if (!p.metaWa) return;
    setBusy(true);
    try {
      if (!waSdkReady || !window.FB) await loadFacebookSdk(p.metaWa.appId, p.metaWa.version);
      window.FB!.login(
        (resp) => {
          const code = resp.authResponse?.code;
          if (!code) {
            setBusy(false);
            toast.error(t("integrations.whatsapp.cancelled"));
            return;
          }
          void (async () => {
            await waitForSignup(signup);
            const r = await connectWhatsAppEmbeddedAction({ locale, code, phoneNumberId: signup.current.phone_number_id ?? "", wabaId: signup.current.waba_id ?? "" });
            setBusy(false);
            if (r.error) toast.error(t(r.error, r.messageParams));
            else {
              toast.success(t("integrations.channels.connected"));
              router.refresh();
            }
          })();
        },
        // coexistence: keep using the WhatsApp Business app on the phone, the same number also works here
        { config_id: p.metaWa.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" } },
      );
    } catch {
      setBusy(false);
      toast.error(t("integrations.whatsapp.sdkFailed"));
    }
  }
  return (
    <Tile id="wa-app" icon={MessageCircle} title={t("market.waApp.title")} body={t("market.waApp.body")} gradient="from-emerald-500/15 to-transparent" state={<State on={p.whatsappMode === "embedded"} />} steps={t("market.oneClick")}>
      {p.canManage ? (
        p.metaWa ? (
          <Button onClick={connect} loading={busy} variant="secondary" data-testid="wa-app-connect">
            <MessageCircle className="h-4 w-4" /> {t("market.waApp.connect")}
          </Button>
        ) : (
          <AdminSetup what="wa-app" />
        )
      ) : null}
    </Tile>
  );
}

/* ----------------------------------------------------------- Google */
function GoogleTile({ p }: { p: MarketProps }) {
  const { t, locale } = useI18n();
  const [areas, setAreas] = useState({ calendar: true, gmail: !p.google.gmail, business: true });
  const any = p.google.calendar || p.google.gmail || p.google.business;
  const href = `/api/google/start?locale=${locale}&areas=${Object.entries(areas).filter(([, v]) => v).map(([k]) => k).join(",")}`;
  return (
    <Tile id="google" icon={Calendar} title={t("market.google.title")} body={t("market.google.body")} gradient="from-amber-400/15 via-red-500/10 to-blue-500/10" state={<State on={any} />} steps={t("market.oneConsent")}>
      <ul className="space-y-1.5 text-[13px]">
        {(["calendar", "gmail", "business"] as const).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={areas[k]} onChange={(e) => setAreas({ ...areas, [k]: e.target.checked })} aria-label={t(`market.google.${k}`)} disabled={!p.canManage} />
            {k === "calendar" ? <Calendar className="h-3.5 w-3.5" /> : k === "gmail" ? <Mail className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
            <span className="flex-1">{t(`market.google.${k}`)}</span>
            {p.google[k] ? <CheckCircle2 className="h-4 w-4 text-success" aria-label={t("integrations.connected")} /> : null}
          </li>
        ))}
      </ul>
      {p.google.email ? <p className="text-[12px] text-muted" dir="ltr">{p.google.email}</p> : null}
      {p.canManage ? (
        p.google.configured ? (
          <a href={href} className={cn("inline-flex h-10 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-semibold text-accent-fg shadow-sm hover:opacity-95", !Object.values(areas).some(Boolean) && "pointer-events-none opacity-50")} data-testid="google-connect">
            {t(any ? "market.google.reconnect" : "market.google.connect")}
          </a>
        ) : (
          <AdminSetup what="google" />
        )
      ) : null}
    </Tile>
  );
}

/* ----------------------------------------------------------- stores */
type ShopCheck = { status: "idle" | "checking" | "found" | "not_found" | "unverified" | "invalid" | "not_shopify"; shop?: string | null; name?: string | null; tried?: string[] };

function ShopifyTile({ p }: { p: MarketProps }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [shop, setShop] = useState(p.shopify.shop?.replace(/\.myshopify\.com$/, "") ?? "");
  const [result, setResult] = useState<{ forInput: string; data: ShopCheck }>({ forInput: "", data: { status: "idle" } });
  const [busy, setBusy] = useState<"sync" | "disconnect" | null>(null);
  const [going, setGoing] = useState(false);
  const v = shop.trim();
  const active = v.length >= 2 && p.canManage && p.shopify.configured;
  // derived (no setState in the effect body): idle when inactive, "checking" until the answer for THIS text arrives
  const check: ShopCheck = !active ? { status: "idle" } : result.forInput === v ? result.data : { status: "checking" };

  // wave 26: recognise the store while typing (debounced) — name, handle, custom domain or admin address
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stores/shopify/resolve?shop=${encodeURIComponent(v)}`, { cache: "no-store" });
        const j = (await res.json()) as ShopCheck & { ok?: boolean };
        if (alive) setResult({ forInput: v, data: j.ok ? { status: j.status, shop: j.shop, name: j.name, tried: j.tried } : { status: "idle" } });
      } catch {
        if (alive) setResult({ forInput: v, data: { status: "idle" } });
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [v, active]);

  const handle = check.shop?.replace(/\.myshopify\.com$/, "") ?? null;
  // pasting a full address (https://…/admin, admin.shopify.com/store/x) → keep just what matters
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const txt = e.clipboardData.getData("text");
    if (/^\s*(https?:\/\/|admin\.shopify\.com|[a-z0-9-]+\.myshopify\.)/i.test(txt)) {
      e.preventDefault();
      const m = txt.trim().match(/admin\.shopify\.com\/store\/([a-z0-9-]+)/i) ?? txt.trim().match(/([a-z0-9][a-z0-9-]*)\.myshopify\./i);
      setShop(m?.[1]?.toLowerCase() ?? txt.trim());
    }
  };
  const act = async (action: "sync" | "disconnect") => {
    setBusy(action);
    try {
      const res = await fetch("/api/stores/shopify/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, locale }) });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; orders?: number; carts?: number; error?: string };
      if (j.ok) {
        toast.success(action === "sync" ? t("market.shopify.synced", { orders: String(j.orders ?? 0), carts: String(j.carts ?? 0) }) : t("integrations.channels.disconnected"));
        router.refresh();
      } else toast.error(t(`market.shopify.err.${j.error ?? "unreachable"}`));
    } catch {
      toast.error(t("market.shopify.err.unreachable"));
    } finally {
      setBusy(null);
    }
  };
  // wave 27: the page CSP says form-action 'self', and browsers also apply it to the redirect that follows a form submit —
  // so the redirect to Shopify was silently blocked and the button looked dead. A normal navigation is not subject to it.
  const goConnect = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (going || !v) return;
    setGoing(true);
    window.location.assign(`/api/stores/shopify/start?shop=${encodeURIComponent(v)}&locale=${encodeURIComponent(locale)}`);
    // if the browser stays on this page (back button / bfcache), release the button again
    window.setTimeout(() => setGoing(false), 15_000);
  };
  const tone = check.status === "found" ? "text-success" : check.status === "not_found" || check.status === "not_shopify" || check.status === "invalid" ? "text-danger" : "text-muted";
  return (
    <Tile id="shopify" icon={ShoppingBag} title="Shopify" body={t("market.shopify.body")} gradient="from-lime-500/15 to-transparent" state={<State on={p.shopify.connected} error={p.shopify.error} />} steps={t("market.oneApproval")}>
      {p.shopify.connected ? (
        <div className="space-y-2">
          <p className="text-[12.5px] text-muted">{t("market.store.stats", { orders: String(p.shopify.orders30), revenue: `₪${Math.round(p.shopify.revenue30).toLocaleString("he-IL")}` })}</p>
          {p.shopify.shop ? (
            <p className="text-[12px] text-subtle" dir="ltr">
              {p.shopify.shop}
            </p>
          ) : null}
          {p.canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => act("sync")} data-testid="shopify-sync">
                {busy === "sync" ? t("market.shopify.syncing") : t("market.shopify.syncNow")}
              </Button>
              <Button type="button" variant="danger" disabled={busy !== null} onClick={() => (window.confirm(t("market.shopify.disconnectConfirm")) ? act("disconnect") : undefined)} data-testid="shopify-disconnect">
                {t("market.shopify.disconnect")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {p.canManage ? (
        p.shopify.configured ? (
          <form action="/api/stores/shopify/start" method="get" onSubmit={goConnect} className="space-y-1.5">
            <input type="hidden" name="locale" value={locale} />
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Input name="shop" value={shop} onChange={(e) => setShop(e.target.value)} onPaste={onPaste} placeholder={t("market.shopify.placeholder")} dir="ltr" autoComplete="off" autoCapitalize="none" spellCheck={false} inputMode="url" aria-label={t("market.shopify.shop")} aria-describedby="shopify-check" className="pe-28" required />
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[11.5px] text-subtle" dir="ltr">
                  {/[./]/.test(shop) ? "" : ".myshopify.com"}
                </span>
              </div>
              <Button type="submit" disabled={going || check.status === "not_found" || check.status === "invalid" || check.status === "not_shopify"} data-testid="shopify-connect">
                {going ? t("market.shopify.connecting") : t(p.shopify.connected ? "integrations.channels.reconnect" : "integrations.channels.connect")}
              </Button>
            </div>
            <p id="shopify-check" role="status" aria-live="polite" className={cn("min-h-[1.1rem] text-[12px]", tone)}>
              {check.status === "checking" ? t("market.shopify.checking") : null}
              {check.status === "found" ? `✓ ${t("market.shopify.found", { shop: check.shop ?? "" })}${check.name ? ` — ${check.name}` : ""}` : null}
              {check.status === "unverified" ? t("market.shopify.unverified") : null}
              {check.status === "not_found" ? t("market.shopify.notFound") : null}
              {check.status === "not_shopify" ? t("market.shopify.notShopify") : null}
              {check.status === "invalid" ? t("market.shopify.invalid") : null}
            </p>
            {check.status === "found" && handle && handle !== shop.trim().toLowerCase() ? (
              <button type="button" className="text-[12px] font-semibold text-accent hover:underline" onClick={() => setShop(handle)}>
                {t("market.shopify.useThis", { shop: handle })}
              </button>
            ) : null}
            <p className="text-[11.5px] text-subtle">{t("market.shopify.hint")}</p>
          </form>
        ) : (
          <AdminSetup what="shopify" />
        )
      ) : null}
    </Tile>
  );
}

function WooTile({ p }: { p: MarketProps }) {
  const { t, locale } = useI18n();
  return (
    <Tile id="woocommerce" icon={ShoppingCart} title="WooCommerce" body={t("market.woo.body")} gradient="from-violet-500/15 to-transparent" state={<State on={p.woo.connected} pending={p.woo.pending} error={p.woo.error} />} steps={t("market.oneApproval")}>
      {p.woo.origin ? (
        <p className="text-[12.5px] text-muted" dir="ltr">
          {p.woo.origin}
        </p>
      ) : null}
      {p.canManage ? (
        <form
          action="/api/stores/woocommerce/start"
          method="get"
          className="flex gap-2"
          onSubmit={(e) => {
            // wave 27: same CSP form-action issue as Shopify — navigate instead of submitting so the redirect to the store is not blocked
            e.preventDefault();
            const u = new FormData(e.currentTarget).get("url");
            window.location.assign(`/api/stores/woocommerce/start?url=${encodeURIComponent(String(u ?? ""))}&locale=${encodeURIComponent(locale)}`);
          }}
        >
          <input type="hidden" name="locale" value={locale} />
          <Input name="url" defaultValue={p.woo.origin ?? ""} placeholder="https://my-store.co.il" dir="ltr" aria-label={t("market.woo.url")} required />
          <Button type="submit" data-testid="woo-connect">
            {t(p.woo.connected ? "integrations.channels.reconnect" : "integrations.channels.connect")}
          </Button>
        </form>
      ) : null}
    </Tile>
  );
}

/* ----------------------------------------------------------- Zapier / Make / n8n */
function ZapierTile({ p }: { p: MarketProps }) {
  const { t, locale } = useI18n();
  return (
    <Tile id="zapier" icon={Zap} title={t("market.zapier.title")} body={t("market.zapier.body")} gradient="from-orange-500/15 to-transparent" state={<State on={p.zapier.hooks > 0} />} steps={t("market.zapier.steps")}>
      <CopyLine value={`${p.appUrl}/api/public/v1`} />
      <p className="text-[12px] text-muted">{t("market.zapier.hooks", { count: String(p.zapier.hooks) })}</p>
      {p.zapier.apiAccess ? (
        <a href={`/${locale}/integrations#api-keys`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
          <Workflow className="h-3.5 w-3.5" /> {t("market.zapier.key")}
        </a>
      ) : (
        <p className="text-[12px] text-subtle">{t("plans.locked.api_access.title")}</p>
      )}
    </Tile>
  );
}

const MORE: Record<string, { icon: LucideIcon; anchor: string }> = {
  conversions: { icon: Zap, anchor: "#conversions" },
  invoicing: { icon: ShoppingBag, anchor: "/finance" },
  payments: { icon: ShoppingCart, anchor: "/finance" },
  calendar: { icon: Calendar, anchor: "/settings#calendar" },
  telegram_business: { icon: MessageCircle, anchor: "#team-updates" },
  voice: { icon: Camera, anchor: "#voice" },
};

export function IntegrationsMarketplace(p: MarketProps) {
  const { t, locale } = useI18n();
  const sp = useSearchParams();
  const router = useRouter();
  const [cat, setCat] = useState<Cat>("all");
  const [q, setQ] = useState("");
  // results of the one-click flows that come back by redirect (?google= / ?store=)
  useEffect(() => {
    const g = sp.get("google");
    const s = sp.get("store");
    const m = sp.get("meta");
    const detail = sp.get("detail") ?? "";
    if (m) (m === "connected" ? toast.success : m === "choose" ? toast : toast.error)(t(m === "choose" ? "market.meta.choose" : `market.result.${m}`, { detail }));
    if (g) (g === "connected" ? toast.success : toast.error)(t(`market.result.${g}`, { detail }));
    if (s) (s === "connected" || s === "woocommerce" ? toast.success : toast.error)(t(`market.result.${s}`, { detail }));
    if (g || s || m) router.replace(`/${locale}/integrations#marketplace`, { scroll: false });
  }, [sp, t, router, locale]);
  const tiles = useMemo(
    () =>
      [
        { cat: "social" as const, key: "meta", words: "facebook instagram messenger פייסבוק אינסטגרם מסנג'ר", el: <MetaTile key="meta" p={p} /> },
        { cat: "social" as const, key: "wa-app", words: "whatsapp business app וואטסאפ", el: <WhatsAppAppTile key="wa" p={p} /> },
        { cat: "google" as const, key: "google", words: "google calendar gmail reviews גוגל יומן ביקורות", el: <GoogleTile key="google" p={p} /> },
        { cat: "stores" as const, key: "shopify", words: "shopify store חנות שופיפיי", el: <ShopifyTile key="shopify" p={p} /> },
        { cat: "stores" as const, key: "woo", words: "woocommerce wordpress וורדפרס ווקומרס", el: <WooTile key="woo" p={p} /> },
        { cat: "automation" as const, key: "zapier", words: "zapier make n8n webhook זאפייר", el: <ZapierTile key="zapier" p={p} /> },
      ]
        // wave 20: a connection that still needs the platform's one-time setup is shown to platform admins only
        .filter((x) => p.platformAdmin !== false || ({ meta: Boolean(p.metaPages), "wa-app": Boolean(p.metaWa), google: p.google.configured, shopify: p.shopify.configured } as Record<string, boolean>)[x.key] !== false)
        .filter((x) => (cat === "all" || x.cat === cat) && (!q.trim() || `${x.key} ${x.words}`.toLowerCase().includes(q.trim().toLowerCase()))),
    [cat, q, p],
  );
  const cats: Cat[] = ["all", "social", "google", "stores", "automation", "more"];
  return (
    <section className="mb-6 space-y-3" id="marketplace" data-testid="marketplace">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold">{t("market.title")}</h2>
          <p className="text-[13px] text-muted">{t("market.subtitle")}</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("market.search")} className="ps-9" aria-label={t("market.search")} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {cats.map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={cn("rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition", cat === c ? "border-transparent bg-accent-solid text-accent-fg" : "border-line text-muted hover:bg-surface-hover")}>
            {t(`market.cats.${c}`)}
          </button>
        ))}
      </div>
      {cat !== "more" ? (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">{tiles.map((x) => x.el)}</ul>
      ) : null}
      {cat === "all" || cat === "more" ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {p.others.map((o) => {
            const m = MORE[o.key] ?? { icon: ExternalLink, anchor: "#" };
            const Icon = m.icon;
            return (
              <li key={o.key}>
                <a href={m.anchor.startsWith("/") ? `/${locale}${m.anchor}` : m.anchor} className="flex h-full items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5 text-[13px] hover:bg-surface-hover">
                  <Icon className="h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{t(`market.more.${o.key}`)}</span>
                  {o.connected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : null}
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
