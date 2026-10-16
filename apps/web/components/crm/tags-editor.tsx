"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { setContactTagsAction } from "@/app/[locale]/(dashboard)/crm/suite-actions";

/** Tag chips with inline editing; unknown names are created on save. */
export function TagsEditor({ contactId, tags, allTags, canWrite }: { contactId: string; tags: { name: string; color: string }[]; allTags: string[]; canWrite: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<string[]>(tags.map((x) => x.name));
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const color = new Map(tags.map((x) => [x.name, x.color]));

  function add(raw: string) {
    const parts = raw.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setNames((prev) => Array.from(new Set([...prev, ...parts.map((p) => p.slice(0, 40))])).slice(0, 30));
    setDraft("");
  }

  function save() {
    const final = draft.trim() ? Array.from(new Set([...names, ...draft.split(/[,،]/).map((s) => s.trim()).filter(Boolean)])) : names;
    start(async () => {
      const res = await setContactTagsAction({ locale, contactId, names: final });
      if (res.error) toast.error(t(res.error));
      else {
        toast.success(t("tags.saved"));
        setEditing(false);
        setDraft("");
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag className="h-4 w-4 text-subtle" aria-hidden />
        {tags.length === 0 ? <span className="text-[13px] text-subtle">{t("tags.none")}</span> : null}
        {tags.map((x) => (
          <span key={x.name} className="rounded-full border px-2.5 py-0.5 text-[12px] font-medium" style={{ borderColor: `${x.color}66`, color: x.color, background: `${x.color}14` }}>
            {x.name}
          </span>
        ))}
        {canWrite ? (
          <Button variant="ghost" size="sm" onClick={() => { setNames(tags.map((x) => x.name)); setEditing(true); }} aria-label={t("tags.edit")}>
            <Pencil className="h-3.5 w-3.5" /> {t("tags.edit")}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-full border border-line bg-elevated px-2.5 py-0.5 text-[12px]" style={color.get(n) ? { color: color.get(n) } : undefined}>
            {n}
            <button type="button" onClick={() => setNames((p) => p.filter((x) => x !== n))} aria-label={t("tags.remove", { name: n })} className="rounded-full p-0.5 hover:bg-surface-hover">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            }
          }}
          list={`tags-${contactId}`}
          placeholder={t("tags.placeholder")}
          aria-label={t("tags.add")}
          className="flex-1"
        />
        <datalist id={`tags-${contactId}`}>
          {allTags.filter((x) => !names.includes(x)).map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => add(draft)}>
            {t("tags.add")}
          </Button>
          <Button onClick={save} loading={pending}>
            {t("common.save")}
          </Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
