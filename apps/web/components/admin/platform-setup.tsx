"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, Copy, ExternalLink, KeyRound, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button } from "@/components/ui/primitives";
import { checkPlatformSetupAction } from "@/app/[locale]/(dashboard)/admin/setup-actions";
import type { SetupStep } from "@/lib/admin/setup-core";
import type { LiveChecks } from "@/lib/admin/setup";
import { cn } from "@/lib/utils";

/**
 * Wave 20 — the platform's one-time setup wizard (admin console, #setup).
 * After each step, every business on the platform connects that service in one click.
 */
function Copyable({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="space-y-1">
      <span className="text-[12px] text-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg border border-line bg-bg px-2.5 py-2 text-[12px]">
          {value}
        </code>
        <Button
          variant="secondary"
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

function TokenMaker() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  return token ? (
    <Copyable label={t("admin.setup.tokenReady")} value={token} />
  ) : (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        const b = new Uint8Array(24);
        crypto.getRandomValues(b);
        setToken(Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));
      }}
    >
      <KeyRound className="h-3.5 w-3.5" /> {t("admin.setup.makeToken")}
    </Button>
  );
}

/**
 * Wave 58 — the voice + phone steps (wave 57) get their own list under the original wizard, so the
 * wizard keeps its six steps exactly as before; the overall progress counts both.
 */
export function PlatformSetup({ steps, extra = [] }: { steps: SetupStep[]; extra?: SetupStep[] }) {
  const { t, locale } = useI18n();
  const [live, setLive] = useState<LiveChecks | null>(null);
  const [checking, setChecking] = useState(false);
  const all = [...steps, ...extra];
  const done = all.filter((s) => s.done).length;
  const firstOpen = all.find((s) => !s.done)?.key;

  async function check() {
    setChecking(true);
    const r = await checkPlatformSetupAction({ locale });
    setChecking(false);
    if (r.error) toast.error(t(r.error));
    else setLive(r.data ?? null);
  }

  const liveLine = (key: SetupStep["key"]) => {
    const c = key === "bridge" ? live?.bridge : key === "meta_app" ? live?.meta : undefined;
    if (!c) return null;
    return c.ok ? (
      <span className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-success" data-testid={`live-${key}`}>
        <CheckCircle2 className="h-3.5 w-3.5" /> {key === "bridge" ? t("admin.setup.bridgeOk", { n: String(live?.bridge?.sessions ?? 0) }) : t("admin.setup.metaOk", { name: live?.meta?.name ?? "" })}
      </span>
    ) : (
      <span className="mt-1 flex items-center gap-1.5 text-[12.5px] font-medium text-danger" data-testid={`live-${key}`}>
        <TriangleAlert className="h-3.5 w-3.5" /> {t("admin.setup.liveFail", { error: c.error ?? "" })}
      </span>
    );
  };

  const row = (s: SetupStep, i: number, attr: "data-step" | "data-voice-step", offset: number) => (
    <li key={s.key}>
      <details className="group" open={s.key === firstOpen} {...{ [attr]: s.key }}>
        <summary className="flex cursor-pointer list-none items-center gap-3 p-4 hover:bg-surface-hover sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold", s.done ? "bg-success-soft text-success" : "bg-accent-soft text-accent")}>
            {s.done ? <CheckCircle2 className="h-4 w-4" /> : i + 1 + offset}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t(`admin.setup.steps.${s.key}.title`)}</span>
            <span className="block text-[12.5px] text-muted">{t(`admin.setup.steps.${s.key}.unlocks`)}</span>
            {/* the live check result stays visible while the step is collapsed */}
            {liveLine(s.key)}
          </span>
          <Badge tone={s.done ? "success" : "neutral"}>{t(s.done ? "admin.setup.done" : "admin.setup.todo")}</Badge>
          <ChevronDown className="h-4 w-4 shrink-0 text-subtle transition group-open:rotate-180" />
        </summary>
        <div className="space-y-4 px-4 pb-5 sm:ps-16 sm:pe-5">
          <p className="whitespace-pre-line text-[13.5px] leading-relaxed">{t(`admin.setup.steps.${s.key}.how`)}</p>
          {s.copies.length ? <div className="grid gap-3 sm:grid-cols-2">{s.copies.map((c) => <Copyable key={c.label} label={c.label} value={c.value} />)}</div> : null}
          {s.vars.some((x) => x.name === "META_WEBHOOK_VERIFY_TOKEN" && !x.set) ? <TokenMaker /> : null}
          <div>
            <p className="mb-1.5 text-[12.5px] font-medium text-muted">{t("admin.setup.vercelVars")}</p>
            <ul className="flex flex-wrap gap-1.5">
              {s.vars.map((x) => (
                <li key={x.name} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]", x.set ? "border-success/30 bg-success-soft text-success" : "border-line text-muted")}>
                  {x.set ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />}
                  <code dir="ltr">{x.name}</code>
                  <span className="sr-only">{t(x.set ? "admin.setup.varSet" : "admin.setup.varMissing")}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap gap-3">
            {s.links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
                <ExternalLink className="h-3.5 w-3.5" /> {l.label}
              </a>
            ))}
          </div>
        </div>
      </details>
    </li>
  );

  return (
    <section id="setup" className="mb-5 overflow-hidden rounded-[1.5rem] border border-line bg-surface" data-testid="platform-setup">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-4 sm:p-5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold">{t("admin.setup.title")}</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{t("admin.setup.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-end">
            <p className="text-[12px] text-muted">{t("admin.setup.progress")}</p>
            <p className="text-[18px] font-bold tabular-nums" dir="ltr">
              {done}/{all.length}
            </p>
          </div>
          <Button variant="secondary" onClick={check} loading={checking} data-testid="setup-check">
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t("admin.setup.check")}
          </Button>
        </div>
      </div>
      <div className="h-1 bg-line" aria-hidden>
        <div className="h-1 bg-success transition-[width]" style={{ width: `${Math.round((done / Math.max(1, all.length)) * 100)}%` }} />
      </div>
      <ol className="divide-y divide-line">
        {steps.map((s, i) => row(s, i, "data-step", 0))}
      </ol>
      {extra.length ? (
        <div className="border-t border-line" data-testid="platform-setup-voice">
          <p className="bg-elevated px-4 py-2.5 text-[12.5px] font-semibold text-muted sm:px-5">{t("admin.setup.voiceSection")}</p>
          <ol className="divide-y divide-line">{extra.map((s, i) => row(s, i, "data-voice-step", steps.length))}</ol>
        </div>
      ) : null}
      <p className="border-t border-line p-4 text-[12.5px] text-subtle sm:px-5">{t("admin.setup.footer")}</p>
    </section>
  );
}
