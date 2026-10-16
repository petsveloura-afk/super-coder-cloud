"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SITE_BLOCK_TYPES, type SiteBlockType } from "@scc/shared/engagement";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { saveSiteAction } from "@/app/[locale]/(dashboard)/websites/actions";
import { cn } from "@/lib/utils";

type Item = Record<string, string>;
export interface BlockValue {
  type: SiteBlockType;
  data: Record<string, string | Item[]>;
}
export interface SiteValue {
  name: string;
  slug: string;
  status: "draft" | "published";
  theme: { accent: string; mode: "dark" | "light" };
  seo: { title: string; description: string };
  blocks: BlockValue[];
}

interface FieldSpec {
  key: string;
  multiline?: boolean;
  ltr?: boolean;
  select?: "form" | "booking";
}
/** Editable fields per block type (labels: websites.fields.<key>). */
const SPEC: Record<SiteBlockType, { fields: FieldSpec[]; items?: { key: "items"; fields: FieldSpec[] } }> = {
  hero: { fields: [{ key: "title" }, { key: "subtitle", multiline: true }, { key: "cta_label" }, { key: "cta_href", ltr: true }, { key: "image_url", ltr: true }] },
  features: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "title" }, { key: "text", multiline: true }] } },
  text: { fields: [{ key: "title" }, { key: "body", multiline: true }] },
  form: { fields: [{ key: "title" }, { key: "form_slug", select: "form" }] },
  booking: { fields: [{ key: "title" }, { key: "text", multiline: true }, { key: "label" }, { key: "booking_slug", select: "booking" }] },
  cta: { fields: [{ key: "title" }, { key: "text", multiline: true }, { key: "label" }, { key: "href", ltr: true }] },
  faq: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "q" }, { key: "a", multiline: true }] } },
  contact: { fields: [{ key: "title" }, { key: "phone", ltr: true }, { key: "whatsapp", ltr: true }, { key: "email", ltr: true }, { key: "address" }] },
};

export function newBlock(type: SiteBlockType): BlockValue {
  const spec = SPEC[type];
  const data: BlockValue["data"] = Object.fromEntries(spec.fields.map((f) => [f.key, ""]));
  if (spec.items) data.items = [Object.fromEntries(spec.items.fields.map((f) => [f.key, ""]))];
  return { type, data };
}

export function SiteBuilder({
  id,
  initial,
  forms,
  bookings,
  publicBase,
}: {
  id?: string;
  initial: SiteValue;
  forms: { slug: string; name: string }[];
  bookings: { slug: string; name: string }[];
  publicBase: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<SiteValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<SiteBlockType>("hero");
  const [saving, start] = useTransition();
  const set = (patch: Partial<SiteValue>) => setV((x) => ({ ...x, ...patch }));
  const setBlock = (i: number, data: BlockValue["data"]) => setV((x) => ({ ...x, blocks: x.blocks.map((b, j) => (j === i ? { ...b, data } : b)) }));
  const move = (i: number, d: -1 | 1) =>
    setV((x) => {
      const b = [...x.blocks];
      const j = i + d;
      if (j < 0 || j >= b.length) return x;
      [b[i], b[j]] = [b[j]!, b[i]!];
      return { ...x, blocks: b };
    });
  const err = (k: string) => (errors[k] ? t(errors[k]!) : undefined);

  function save(status: SiteValue["status"]) {
    setErrors({});
    start(async () => {
      const res = await saveSiteAction({ locale, id, data: { ...v, status } });
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(t(res.fieldErrors?.blocks ?? res.error));
        return;
      }
      set({ status });
      toast.success(t(res.message ?? "common.saved"));
      if (!id && res.data?.id) router.push(`/${locale}/websites/${res.data.id}`);
      else router.refresh();
    });
  }

  const url = `${publicBase}/${v.slug}`;
  return (
    <div className="space-y-4">
      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t("websites.name")} htmlFor="st-name" error={err("name")}>
          <Input id="st-name" value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label={t("websites.slug")} htmlFor="st-slug" error={err("slug")} hint={url}>
          <Input id="st-slug" dir="ltr" value={v.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} />
        </Field>
        <Field label={t("websites.accent")} htmlFor="st-accent" error={err("theme.accent")}>
          <div className="flex gap-2">
            <input type="color" aria-label={t("websites.accent")} value={v.theme.accent} onChange={(e) => set({ theme: { ...v.theme, accent: e.target.value } })} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-transparent" />
            <Input id="st-accent" dir="ltr" value={v.theme.accent} onChange={(e) => set({ theme: { ...v.theme, accent: e.target.value } })} />
          </div>
        </Field>
        <Field label={t("websites.mode")} htmlFor="st-mode">
          <Select id="st-mode" value={v.theme.mode} onChange={(e) => set({ theme: { ...v.theme, mode: e.target.value as "dark" | "light" } })}>
            <option value="dark">{t("common.dark")}</option>
            <option value="light">{t("common.light")}</option>
          </Select>
        </Field>
        <Field label={t("websites.seoTitle")} htmlFor="st-seo-title" error={err("seo.title")}>
          <Input id="st-seo-title" value={v.seo.title} onChange={(e) => set({ seo: { ...v.seo, title: e.target.value } })} />
        </Field>
        <Field label={t("websites.seoDescription")} htmlFor="st-seo-desc" error={err("seo.description")}>
          <Input id="st-seo-desc" value={v.seo.description} onChange={(e) => set({ seo: { ...v.seo, description: e.target.value } })} />
        </Field>
      </Card>

      <ol className="space-y-3">
        {v.blocks.map((b, i) => {
          const spec = SPEC[b.type];
          const items = (b.data.items as Item[] | undefined) ?? [];
          return (
            <li key={i}>
              <Card className="p-4" data-block={b.type}>
                <div className="mb-3 flex items-center gap-2">
                  <span className="rounded-lg bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent">{t(`websites.blocks.${b.type}`)}</span>
                  <span className="flex-1" />
                  <Button variant="ghost" size="sm" aria-label={t("websites.moveUp")} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={t("websites.moveDown")} disabled={i === v.blocks.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={t("common.delete")} onClick={() => setV((x) => ({ ...x, blocks: x.blocks.filter((_, j) => j !== i) }))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {spec.fields.map((f) => {
                    const fid = `bl-${i}-${f.key}`;
                    const value = String(b.data[f.key] ?? "");
                    const onChange = (val: string) => setBlock(i, { ...b.data, [f.key]: val });
                    const options = f.select === "form" ? forms : f.select === "booking" ? bookings : null;
                    return (
                      <Field key={f.key} label={t(`websites.fields.${f.key}`)} htmlFor={fid} error={err(`blocks.${i}.data.${f.key}`)} className={cn(f.multiline && "sm:col-span-2")}>
                        {options ? (
                          <Select id={fid} value={value} onChange={(e) => onChange(e.target.value)}>
                            <option value="">{t(f.select === "form" ? "websites.pickForm" : "websites.pickBooking")}</option>
                            {options.map((o) => (
                              <option key={o.slug} value={o.slug}>
                                {o.name}
                              </option>
                            ))}
                          </Select>
                        ) : f.multiline ? (
                          <Textarea id={fid} rows={f.key === "body" ? 6 : 2} value={value} onChange={(e) => onChange(e.target.value)} />
                        ) : (
                          <Input id={fid} dir={f.ltr ? "ltr" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
                        )}
                      </Field>
                    );
                  })}
                </div>
                {spec.items ? (
                  <div className="mt-3 space-y-2">
                    {items.map((it, k) => (
                      <div key={k} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_2fr_auto]">
                        {spec.items!.fields.map((f) => (
                          <Field key={f.key} label={t(`websites.fields.${f.key}`)} htmlFor={`bl-${i}-it-${k}-${f.key}`} error={err(`blocks.${i}.data.items.${k}.${f.key}`)}>
                            {f.multiline ? (
                              <Textarea id={`bl-${i}-it-${k}-${f.key}`} rows={2} value={it[f.key] ?? ""} onChange={(e) => setBlock(i, { ...b.data, items: items.map((x, m) => (m === k ? { ...x, [f.key]: e.target.value } : x)) })} />
                            ) : (
                              <Input id={`bl-${i}-it-${k}-${f.key}`} value={it[f.key] ?? ""} onChange={(e) => setBlock(i, { ...b.data, items: items.map((x, m) => (m === k ? { ...x, [f.key]: e.target.value } : x)) })} />
                            )}
                          </Field>
                        ))}
                        <Button variant="ghost" size="sm" className="self-end" aria-label={t("common.delete")} onClick={() => setBlock(i, { ...b.data, items: items.filter((_, m) => m !== k) })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="secondary" size="sm" onClick={() => setBlock(i, { ...b.data, items: [...items, Object.fromEntries(spec.items!.fields.map((f) => [f.key, ""]))] })}>
                      <Plus className="h-4 w-4" /> {t("websites.addItem")}
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <Select aria-label={t("websites.blockType")} value={adding} onChange={(e) => setAdding(e.target.value as SiteBlockType)} className="sm:w-56">
          {SITE_BLOCK_TYPES.map((b) => (
            <option key={b} value={b}>
              {t(`websites.blocks.${b}`)}
            </option>
          ))}
        </Select>
        <Button variant="secondary" onClick={() => setV((x) => ({ ...x, blocks: [...x.blocks, newBlock(adding)] }))}>
          <Plus className="h-4 w-4" /> {t("websites.addBlock")}
        </Button>
        {err("blocks") ? (
          <p role="alert" className="text-[13px] text-danger">
            {err("blocks")}
          </p>
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {id && v.status === "published" ? (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-hover">
            <ExternalLink className="h-4 w-4" /> {t("websites.view")}
          </a>
        ) : null}
        <Button variant="secondary" loading={saving} onClick={() => save("draft")}>
          <Save className="h-4 w-4" /> {t(v.status === "published" ? "websites.unpublish" : "websites.saveDraft")}
        </Button>
        <Button loading={saving} onClick={() => save("published")}>
          {t(v.status === "published" ? "websites.update" : "websites.publish")}
        </Button>
      </div>
    </div>
  );
}
