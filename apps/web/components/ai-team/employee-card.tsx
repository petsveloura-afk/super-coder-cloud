"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Card, Textarea } from "@/components/ui/primitives";
import { saveJobProfileAction } from "@/app/[locale]/(dashboard)/ai-team/org-actions";
import { performanceLine, type EmployeeCard as Card8 } from "@/lib/team/job-profile-core";
import { optimistic } from "@/lib/team/speed-core";

const lang = (l: string): "he" | "en" | "ar" => (l === "en" || l === "ar" ? l : "he");

/**
 * Upgrade 8 / stage B5 — the employee card: department, responsibilities, authority, what is forbidden, the procedures that are theirs
 * and their real performance (success rate and average time from their finished tasks). The owner may adapt the wording; the change shows
 * at once and is undone with a message when the server refuses.
 */
export default function EmployeeCard({ card: initial, name, locale, canManage }: { card: Card8; name: string; locale: string; canManage: boolean }) {
  const { t } = useI18n();
  const l = lang(locale);
  const [card, setCard] = useState(initial);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = card.profile;
  const [draft, setDraft] = useState({ resp: p.responsibilities.join("\n"), auth: p.authority.join("\n"), forb: "" });
  const split = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8);

  const save = async () => {
    const next = { responsibilities: split(draft.resp), authority: split(draft.auth), forbiddenExtra: split(draft.forb) };
    if (!next.responsibilities.length || !next.authority.length) return toast.error(t("validation.invalid"));
    setBusy(true);
    const r = await optimistic(() => card, setCard, (c) => ({ ...c, profile: { ...c.profile, responsibilities: next.responsibilities, authority: next.authority, forbidden: [...c.profile.forbidden.filter((x) => !next.forbiddenExtra.includes(x)), ...next.forbiddenExtra.filter((x) => !c.profile.forbidden.includes(x))], customized: true } }), () => saveJobProfileAction({ locale, memberId: p.member_id, ...next }));
    setBusy(false);
    if (!r.ok) return toast.error(t(r.error.includes(".") ? r.error : "aiTeam.org8.card.saveFail"));
    setEdit(false);
    toast.success(t("common.saved"));
  };

  return (
    <Card className="space-y-3 p-5" data-testid="employee-card">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 font-bold">
          {name} <span className="text-[12.5px] font-normal text-muted">· {t("aiTeam.org8.card.title")}</span>
        </h3>
        <Badge tone="accent">{p.deptName}</Badge>
        {p.customized ? <Badge tone="neutral">{t("aiTeam.org8.card.custom")}</Badge> : null}
        {canManage && !edit ? (
          <Button variant="ghost" size="sm" onClick={() => setEdit(true)} data-testid="employee-card-edit">
            <Pencil className="h-4 w-4" /> {t("aiTeam.org8.card.edit")}
          </Button>
        ) : null}
      </div>
      <p className="text-[12.5px] text-muted">
        {t("aiTeam.org8.card.mission")}: {p.mission}
      </p>
      {edit ? (
        <div className="space-y-2">
          <p className="text-[12px] text-muted">{t("aiTeam.org8.card.hint")}</p>
          {(
            [
              ["resp", "aiTeam.org8.card.resp"],
              ["auth", "aiTeam.org8.card.auth"],
              ["forb", "aiTeam.org8.card.addForb"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block text-[12.5px] font-semibold">
              {t(label)}
              <Textarea rows={3} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className="mt-1 font-normal" />
            </label>
          ))}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy} data-testid="employee-card-save">
              {t("aiTeam.org8.card.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)} disabled={busy}>
              {t("aiTeam.org8.card.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 text-[13px] md:grid-cols-3">
          {(
            [
              ["aiTeam.org8.card.resp", p.responsibilities],
              ["aiTeam.org8.card.auth", p.authority],
              ["aiTeam.org8.card.forb", p.forbidden],
            ] as const
          ).map(([label, items]) => (
            <div key={label}>
              <h4 className="mb-1 text-[12.5px] font-semibold">{t(label)}</h4>
              <ul className="list-disc space-y-1 ps-4">
                {items.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-2xl bg-surface-hover p-3 text-[13px]" data-testid="employee-card-perf">
        <span className="font-semibold">{t("aiTeam.org8.card.perf")}:</span> {performanceLine(card, l)}
        <span className="mx-2 text-muted">·</span>
        {t("aiTeam.org8.card.open")}: {card.stats.open} · {t("aiTeam.org8.card.load")}: {card.stats.load}
      </div>
      {p.procedures.length ? (
        <div>
          <h4 className="mb-1 text-[12.5px] font-semibold">{t("aiTeam.org8.card.procs")}</h4>
          <div className="flex flex-wrap gap-1.5">
            {p.procedures.map((x) => (
              <Badge key={x.key} tone={x.owns ? "accent" : "neutral"}>
                {x.title}
                {x.owns ? ` · ${t("aiTeam.org8.card.owns")}` : ""}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
