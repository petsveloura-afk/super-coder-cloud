"use client";

import { useState } from "react";
import { Clock, Copy, Plus, Store, Trash2, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { DAYS, type BusinessSchedule, type Day, type TimeRange } from "@/lib/ai/schedule";
import { INDUSTRIES, type IndustryTemplate } from "@/lib/ai/industries";
import { cn } from "@/lib/utils";

/**
 * Wave 12 — opening hours editor, owner take-over timing and industry templates
 * for the agent conversation setup page.
 */

const TZS = ["Asia/Jerusalem", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow", "Asia/Dubai", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "UTC"];

export const DEFAULT_SCHEDULE: BusinessSchedule = {
  enabled: false,
  tz: "Asia/Jerusalem",
  days: {
    sun: [{ open: "09:00", close: "18:00" }],
    mon: [{ open: "09:00", close: "18:00" }],
    tue: [{ open: "09:00", close: "18:00" }],
    wed: [{ open: "09:00", close: "18:00" }],
    thu: [{ open: "09:00", close: "18:00" }],
    fri: [{ open: "09:00", close: "13:00" }],
  },
  closed_dates: [],
  after_hours: "book_next",
};

function SectionBox({ icon: Icon, title, hint, children, testId }: { icon: typeof Clock; title: string; hint: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5" data-testid={testId}>
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-[12.5px] leading-relaxed text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const timeCls = "h-9 w-[5.6rem] rounded-lg border border-line bg-elevated px-2 text-sm tabular-nums outline-none focus:border-accent";

export function HoursEditor({ value, onChange }: { value: BusinessSchedule; onChange: (v: BusinessSchedule) => void }) {
  const { t } = useI18n();
  const [holiday, setHoliday] = useState("");
  const days = value.days ?? {};
  const setDay = (d: Day, ranges: TimeRange[]) => onChange({ ...value, days: { ...days, [d]: ranges } });
  const copyToAll = (d: Day) => {
    const src = days[d] ?? [];
    const next: Partial<Record<Day, TimeRange[]>> = {};
    for (const k of DAYS) next[k] = (days[k] ?? []).length || k === d ? src.map((r) => ({ ...r })) : [];
    onChange({ ...value, days: next });
  };
  const enabled = value.enabled !== false;

  return (
    <SectionBox icon={Clock} title={t("ai.hours.title")} hint={t("ai.hours.hint")} testId="hours-editor">
      <label className="mb-3 flex cursor-pointer items-center gap-2.5 text-sm font-medium">
        <input type="checkbox" className="h-4.5 w-4.5 accent-[var(--accent)]" checked={enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} data-testid="hours-enabled" />
        {t("ai.hours.enable")}
      </label>
      {enabled ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-[12.5px] text-muted">
              <span>{t("ai.hours.tz")}</span>
              <select value={value.tz ?? "Asia/Jerusalem"} onChange={(e) => onChange({ ...value, tz: e.target.value })} className="h-10 w-full rounded-xl border border-line bg-elevated px-3 text-sm text-fg" data-testid="hours-tz" dir="ltr">
                {(TZS.includes(value.tz ?? "") ? TZS : [value.tz ?? "Asia/Jerusalem", ...TZS]).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-[12.5px] text-muted">
              <span>{t("ai.hours.afterHours")}</span>
              <select value={value.after_hours ?? "book_next"} onChange={(e) => onChange({ ...value, after_hours: e.target.value as BusinessSchedule["after_hours"] })} className="h-10 w-full rounded-xl border border-line bg-elevated px-3 text-sm text-fg" data-testid="hours-after">
                <option value="book_next">{t("ai.hours.after.book_next")}</option>
                <option value="closed_message">{t("ai.hours.after.closed_message")}</option>
                <option value="answer_normally">{t("ai.hours.after.answer_normally")}</option>
              </select>
            </label>
          </div>

          <ul className="space-y-1.5">
            {DAYS.map((d) => {
              const ranges = days[d] ?? [];
              const open = ranges.length > 0;
              return (
                <li key={d} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-elevated px-2.5 py-2" data-testid={`hours-day-${d}`}>
                  <label className="flex w-24 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={open} onChange={(e) => setDay(d, e.target.checked ? [{ open: "09:00", close: "18:00" }] : [])} aria-label={t(`ai.hours.days.${d}`)} />
                    {t(`ai.hours.days.${d}`)}
                  </label>
                  {open ? (
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      {ranges.map((r, i) => (
                        <span key={i} className="flex items-center gap-1" dir="ltr">
                          <input type="time" className={timeCls} value={r.open} aria-label={`${t(`ai.hours.days.${d}`)} ${t("ai.hours.open")}`} onChange={(e) => setDay(d, ranges.map((x, k) => (k === i ? { ...x, open: e.target.value } : x)))} />
                          <span className="text-muted">–</span>
                          <input type="time" className={timeCls} value={r.close} aria-label={`${t(`ai.hours.days.${d}`)} ${t("ai.hours.close")}`} onChange={(e) => setDay(d, ranges.map((x, k) => (k === i ? { ...x, close: e.target.value } : x)))} />
                          {i === 1 ? (
                            <button type="button" className="rounded-md p-1 text-muted hover:text-danger" onClick={() => setDay(d, ranges.slice(0, 1))} aria-label={t("common.delete")}>
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {ranges.length < 2 ? (
                        <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-accent hover:underline" onClick={() => setDay(d, [...ranges, { open: "16:00", close: "20:00" }])}>
                          <Plus className="h-3.5 w-3.5" /> {t("ai.hours.addBreak")}
                        </button>
                      ) : null}
                      <button type="button" className="ms-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted hover:text-fg" onClick={() => copyToAll(d)} title={t("ai.hours.copyAll")} aria-label={t("ai.hours.copyAll")}>
                        <Copy className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("ai.hours.copyAll")}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="text-[13px] text-subtle">{t("ai.hours.closed")}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11.5px] text-subtle">{t("ai.hours.midnightHint")}</p>

          <div className="space-y-2">
            <div className="text-[12.5px] font-medium">{t("ai.hours.holidays")}</div>
            <div className="flex flex-wrap gap-1.5">
              {(value.closed_dates ?? []).map((d) => (
                <span key={d} className="inline-flex items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[12px] tabular-nums ring-1 ring-line" dir="ltr">
                  {d}
                  <button type="button" onClick={() => onChange({ ...value, closed_dates: (value.closed_dates ?? []).filter((x) => x !== d) })} aria-label={t("common.delete")} className="text-muted hover:text-danger">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} aria-label={t("ai.hours.holidays")} data-testid="hours-holiday" dir="ltr" />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) return;
                  onChange({ ...value, closed_dates: [...new Set([...(value.closed_dates ?? []), holiday])].sort().slice(0, 60) });
                  setHoliday("");
                }}
                aria-label={t("ai.setup.add")}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {value.after_hours === "closed_message" ? (
            <label className="block space-y-1 text-[12.5px] text-muted">
              <span>{t("ai.hours.closedNote")}</span>
              <Textarea value={value.closed_note ?? ""} maxLength={300} rows={2} onChange={(e) => onChange({ ...value, closed_note: e.target.value })} placeholder={t("ai.hours.closedNotePh")} dir="auto" data-testid="hours-note" />
            </label>
          ) : null}
        </div>
      ) : null}
    </SectionBox>
  );
}

export function TakeoverEditor({ minutes, onChange }: { minutes: number; onChange: (v: number) => void }) {
  const { t } = useI18n();
  const opts = [0, 15, 30, 60, 120, 240, 720, 1440];
  return (
    <SectionBox icon={UserRound} title={t("ai.takeover.title")} hint={t("ai.takeover.hint")} testId="takeover-editor">
      <select value={opts.includes(minutes) ? minutes : 0} onChange={(e) => onChange(Number(e.target.value))} className="h-10 w-full rounded-xl border border-line bg-elevated px-3 text-sm sm:w-72" data-testid="resume-after">
        {opts.map((m) => (
          <option key={m} value={m}>
            {m === 0 ? t("ai.takeover.never") : m < 60 ? t("ai.takeover.minutes", { n: m }) : t("ai.takeover.hours", { n: m / 60 })}
          </option>
        ))}
      </select>
    </SectionBox>
  );
}

export function IndustryPicker({ value, onPick }: { value: string; onPick: (tpl: IndustryTemplate) => void }) {
  const { t, locale } = useI18n();
  return (
    <SectionBox icon={Store} title={t("ai.industry.title")} hint={t("ai.industry.hint")} testId="industry-picker">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {INDUSTRIES.map((ind) => {
          const L = locale === "he" ? ind.he : ind.en;
          return (
            <button
              key={ind.key}
              type="button"
              data-industry={ind.key}
              onClick={() => {
                if (value && value !== ind.key && !window.confirm(t("ai.industry.confirm"))) return;
                onPick(ind);
              }}
              className={cn("flex min-h-14 min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-start text-[13px] transition hover:border-accent", value === ind.key ? "border-accent bg-accent-soft font-semibold" : "border-line bg-elevated")}
            >
              <span className="text-lg" aria-hidden="true">
                {ind.emoji}
              </span>
              <span className="min-w-0 leading-snug">{L.name}</span>
            </button>
          );
        })}
      </div>
    </SectionBox>
  );
}
