"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, Briefcase, Camera, CheckCircle2, Circle, Inbox, KanbanSquare, ListTodo, Loader2, Phone, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { cn, initials } from "@/lib/utils";
import { avatarCheck, profileCompleteness } from "@/lib/profile/profile-core";
import { createAvatarUploadAction, setAvatarAction, updateProfileProAction } from "@/app/[locale]/(dashboard)/settings/actions";

export interface MyStats {
  openTasks: number;
  overdueTasks: number;
  openDeals: number;
  openDealsValue: string;
  myConversations: number;
}

function put(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anon) {
      xhr.setRequestHeader("apikey", anon);
      xhr.setRequestHeader("authorization", `Bearer ${anon}`);
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network"));
    xhr.send(file);
  });
}

/**
 * Wave 52 — personal profile card (next to the existing name / language form): profile picture,
 * job title, phone, short bio, a completeness meter and "my week" (my tasks, deals and conversations).
 */
export function ProfileProCard(props: { name: string; email: string; role: string; avatarUrl: string | null; jobTitle: string; phone: string; bio: string; stats: MyStats | null }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avatar, setAvatar] = useState(props.avatarUrl ?? "");
  const [jobTitle, setJobTitle] = useState(props.jobTitle);
  const [phone, setPhone] = useState(props.phone);
  const [bio, setBio] = useState(props.bio);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const comp = profileCompleteness({ full_name: props.name, avatar_url: avatar, job_title: jobTitle, phone, bio });

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const chk = avatarCheck({ type: file.type, size: file.size });
    if (!chk.ok) return void toast.error(t(chk.error === "type" ? "settings.pro.avatarType" : "settings.pro.avatarSize"));
    setUploading(true);
    try {
      const r = await createAvatarUploadAction({ locale, type: file.type, size: file.size });
      if (r.error || !r.data) throw new Error(r.error ?? "settings.pro.avatarFailed");
      await put(r.data.signedUrl, file);
      const s = await setAvatarAction({ locale, url: r.data.publicUrl });
      if (s.error) throw new Error(s.error);
      setAvatar(r.data.publicUrl);
      toast.success(t("settings.pro.avatarSaved"));
      router.refresh();
    } catch (e) {
      const k = (e as Error).message;
      toast.error(t(k.startsWith("settings.") || k.startsWith("validation.") || k.startsWith("errors.") ? k : "settings.pro.avatarFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAvatar = () =>
    start(async () => {
      const r = await setAvatarAction({ locale, url: "" });
      if (r.error) return void toast.error(t(r.error));
      setAvatar("");
      toast.success(t("settings.pro.avatarRemoved"));
      router.refresh();
    });

  const save = () =>
    start(async () => {
      const r = await updateProfileProAction({ locale, job_title: jobTitle, phone, bio });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "settings.saved"));
      router.refresh();
    });

  const s = props.stats;
  const tiles = s
    ? [
        { key: "tasks", icon: ListTodo, value: String(s.openTasks), href: "/tasks", tone: "bg-accent-soft text-accent" },
        { key: "overdue", icon: AlarmClock, value: String(s.overdueTasks), href: "/tasks?f=overdue", tone: s.overdueTasks ? "bg-danger-soft text-danger" : "bg-elevated text-muted" },
        { key: "deals", icon: KanbanSquare, value: s.openDealsValue, sub: String(s.openDeals), href: "/pipelines", tone: "bg-success-soft text-success" },
        { key: "inbox", icon: Inbox, value: String(s.myConversations), href: "/inbox", tone: "bg-teal-soft text-teal" },
      ]
    : [];

  return (
    <div className="space-y-5 p-5" data-testid="profile-pro">
      {/* identity */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt={props.name || props.email} className="h-20 w-20 rounded-full object-cover ring-2 ring-accent/30" referrerPolicy="no-referrer" />
          ) : (
            <span className="grid h-20 w-20 place-items-center rounded-full bg-accent-soft text-[24px] font-bold text-accent ring-2 ring-accent/30">{initials(props.name || props.email)}</span>
          )}
          <input ref={fileRef} id="avatar-file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          <label htmlFor="avatar-file" className={cn("absolute -bottom-1 end-0 grid h-8 w-8 cursor-pointer place-items-center rounded-full bg-accent-solid text-accent-fg shadow-md ring-2 ring-surface transition hover:bg-accent-solid-hover", uploading && "pointer-events-none")} title={t("settings.pro.avatarChange")}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Camera className="h-4 w-4" aria-hidden />}
            <span className="sr-only">{t("settings.pro.avatarChange")}</span>
          </label>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold">{props.name || "—"}</p>
          <p className="truncate text-[13px] text-muted">{[jobTitle, props.role].filter(Boolean).join(" · ")}</p>
          <p className="truncate text-[12.5px] text-subtle">
            <bdi dir="ltr">{props.email}</bdi>
          </p>
          {avatar ? (
            <button type="button" onClick={removeAvatar} disabled={pending} className="mt-1 inline-flex items-center gap-1 text-[12px] text-danger hover:underline">
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("settings.pro.avatarRemove")}
            </button>
          ) : null}
        </div>
      </div>

      {/* completeness */}
      <div className="rounded-xl border border-line bg-elevated p-3">
        <div className="flex items-center justify-between text-[12.5px]">
          <span className="font-medium">{t("settings.pro.completeness")}</span>
          <span className="font-semibold tabular-nums">{comp.pct}%</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={comp.pct} aria-label={t("settings.pro.completeness")}>
          <div className={cn("h-full rounded-full transition-all duration-700", comp.pct === 100 ? "bg-success" : "bg-accent-solid")} style={{ width: `${comp.pct}%` }} />
        </div>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {(["name", "avatar", "jobTitle", "phone", "bio"] as const).map((k) => {
            const done = !comp.missing.includes(k);
            return (
              <li key={k} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px]", done ? "border-success/40 text-success" : "border-line text-muted")}>
                {done ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <Circle className="h-3 w-3" aria-hidden />} {t(`settings.pro.item.${k}`)}
              </li>
            );
          })}
        </ul>
      </div>

      {/* details */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("settings.pro.jobTitle")} htmlFor="pp-job">
          <div className="relative">
            <Briefcase className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input id="pp-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} className="ps-9" placeholder={t("settings.pro.jobTitlePh")} />
          </div>
        </Field>
        <Field label={t("settings.pro.phone")} htmlFor="pp-phone">
          <div className="relative">
            <Phone className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input id="pp-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className="ps-9" dir="ltr" inputMode="tel" placeholder="050-1234567" />
          </div>
        </Field>
      </div>
      <Field label={t("settings.pro.bio")} htmlFor="pp-bio">
        <Textarea id="pp-bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} placeholder={t("settings.pro.bioPh")} dir="auto" />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11.5px] text-subtle tabular-nums">{bio.length}/500</span>
        <Button onClick={save} loading={pending} data-testid="profile-pro-save">
          <UserRound className="h-4 w-4" aria-hidden /> {t("common.save")}
        </Button>
      </div>

      {/* my week */}
      {tiles.length ? (
        <div>
          <p className="mb-2 text-[13px] font-semibold">{t("settings.pro.myWeek")}</p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map((tile) => (
              <li key={tile.key}>
                <Link href={`/${locale}${tile.href}`} className="flex h-full flex-col gap-1.5 rounded-xl border border-line bg-surface p-3 transition hover:-translate-y-0.5 hover:border-accent hover:shadow-sm">
                  <span className={cn("grid h-8 w-8 place-items-center rounded-lg", tile.tone)}>
                    <tile.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="truncate text-[18px] font-bold tabular-nums">
                    <bdi dir="ltr">{tile.value}</bdi>
                  </span>
                  <span className="text-[12px] text-muted">{t(`settings.pro.stat.${tile.key}`, tile.sub ? { n: tile.sub } : undefined)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
