"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Briefcase, ExternalLink, Globe, ImageIcon, LayoutTemplate, ListTree, Plus, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { SITE_BLOCK_TYPES, type SiteBlockType } from "@scc/shared/engagement";
import { StarterKits } from "./starter-kits";
import { kitBlocks, type StarterKit } from "@/lib/site/starter-kits";
import { FREE_TEMPLATES } from "@/lib/site/templates";
import { useI18n } from "@/lib/i18n/client";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ImproveCopyButton } from "./growth-tools";
import { heroImageAIAction, saveSiteAction, uploadSiteImageAction } from "@/app/[locale]/(dashboard)/websites/actions";
import { DesignPanel } from "./design-panel";
import { BusinessPanel, type SitePages, type SiteSettings } from "./business-panel";
import { AiEditPanel } from "./ai-edit-panel";
import { SiteAuditPanel } from "./site-audit-panel";
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
  theme: { accent: string; mode: "dark" | "light"; template?: string; accent2?: string; font?: string; radius?: "sharp" | "soft" | "round"; animations?: boolean };
  seo: { title: string; description: string };
  blocks: BlockValue[];
  // wave 13
  settings?: SiteSettings;
  pages?: SitePages;
}

interface FieldSpec {
  key: string;
  multiline?: boolean;
  ltr?: boolean;
  select?: "form" | "booking";
  /** wave 13: upload an image (or paste an https link) */
  image?: boolean;
  /** wave 13: fixed choices */
  options?: string[];
  /** wave 13: a different label than websites.fields.<key> */
  labelKey?: string;
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
  // wave 13 — richer sections
  about: { fields: [{ key: "title" }, { key: "body", multiline: true }, { key: "image_url", ltr: true, image: true }] },
  gallery: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "url", ltr: true, image: true }, { key: "caption" }] } },
  testimonials: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "name" }, { key: "role" }, { key: "quote", multiline: true }, { key: "rating", options: ["5", "4", "3", "2", "1"] }] } },
  stats: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "value" }, { key: "label", labelKey: "websites.fields.statLabel" }] } },
  pricing: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "name" }, { key: "price" }, { key: "period" }, { key: "features", multiline: true }, { key: "highlight", options: ["", "yes"] }, { key: "cta_label" }, { key: "cta_href", ltr: true }] } },
  steps: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "title" }, { key: "text", multiline: true }] } },
  team: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "name" }, { key: "role" }, { key: "image_url", ltr: true, image: true }] } },
  logos: { fields: [{ key: "title" }], items: { key: "items", fields: [{ key: "name" }] } },
  video: { fields: [{ key: "title" }, { key: "url", ltr: true }, { key: "text", multiline: true }] },
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
  aiImages = false,
  proTemplates = false,
  aiEditor = false,
  domainSlot,
  liveUrl,
  aiCopy = false,
}: {
  id?: string;
  initial: SiteValue;
  forms: { slug: string; name: string }[];
  bookings: { slug: string; name: string }[];
  publicBase: string;
  /** paid plans: generate the hero image with AI */
  aiImages?: boolean;
  /** wave 13: premium templates / AI editing (paid plans) */
  proTemplates?: boolean;
  aiEditor?: boolean;
  /** wave 13: the domain panel (server-rendered) */
  domainSlot?: ReactNode;
  /** wave 13: the site's live address (custom domain when active) */
  liveUrl?: string;
  /** wave 17: "improve this text" with AI next to text fields */
  aiCopy?: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<SiteValue>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<SiteBlockType>("hero");
  const [saving, start] = useTransition();
  const [imaging, startImage] = useTransition();
  const [tab, setTab] = useState<"content" | "design" | "business" | "domain">("content");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<((url: string) => void) | null>(null);
  function pickImage(key: string, apply: (url: string) => void) {
    uploadTarget.current = apply;
    setUploading(null);
    fileRef.current?.setAttribute("data-key", key);
    fileRef.current?.click();
  }
  function aiImage(i: number) {
    const b = v.blocks[i];
    if (!b || b.type !== "hero") return;
    const prompt = [b.data.title, b.data.subtitle, v.name].filter(Boolean).join(". ");
    startImage(async () => {
      const r = await heroImageAIAction({ locale, prompt: String(prompt) });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
      setBlock(i, { ...b.data, image_url: r.data.url });
      toast.success(t("websites.aiImageReady"));
    });
  }
  const set = (patch: Partial<SiteValue>) => setV((x) => ({ ...x, ...patch }));
  /** wave 27: add a starter kit's sections after the existing ones (never replaces anything) */
  function addKit(kit: StarterKit) {
    const room = 40 - v.blocks.length;
    if (room <= 0) {
      toast.error(t("websites.kits.full"));
      return;
    }
    const add = kitBlocks(kit.key, locale).slice(0, room) as unknown as BlockValue[];
    const allowedTemplate = proTemplates || FREE_TEMPLATES.includes(kit.template as never);
    setV((x) => ({
      ...x,
      blocks: [...x.blocks, ...add],
      // a brand-new site gets the kit's look; an existing design is never changed
      theme: x.theme.template ? x.theme : allowedTemplate ? { ...x.theme, template: kit.template, accent: kit.accent, accent2: kit.accent2 } : x.theme,
    }));
    toast.success(t("websites.kits.added", { n: add.length }));
  }
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

  const url = liveUrl ?? `${publicBase}/${v.slug}`;
  const tabs = [
    { k: "content" as const, icon: ListTree, label: t("websites.tabs.content") },
    { k: "design" as const, icon: LayoutTemplate, label: t("websites.tabs.design") },
    { k: "business" as const, icon: Briefcase, label: t("websites.tabs.business") },
    ...(domainSlot ? [{ k: "domain" as const, icon: Globe, label: t("websites.tabs.domain") }] : []),
  ];
  return (
    <div className="space-y-4">
      {/* wave 13: image upload for image fields (sections, gallery, team, logo) */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid="site-image-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f || !uploadTarget.current) return;
          const key = fileRef.current?.getAttribute("data-key") ?? "";
          setUploading(key);
          const fd = new FormData();
          fd.set("locale", locale);
          fd.set("file", f);
          const r = await uploadSiteImageAction(fd);
          setUploading(null);
          if (r.error || !r.data) return void toast.error(t(r.error ?? "common.error"));
          uploadTarget.current(r.data.url);
          toast.success(t("websites.imageUploaded"));
        }}
      />
      <AiEditPanel value={v} onApply={(nv) => setV(nv)} allowed={aiEditor} proTemplates={proTemplates} />
      <SiteAuditPanel value={v} onApply={(nv) => setV(nv)} onGoTab={(k) => setTab(k)} allowed={aiEditor} proTemplates={proTemplates} />
      <div role="tablist" aria-label={t("websites.tabs.label")} className="sticky top-14 z-10 -mx-1 flex gap-1 overflow-x-auto rounded-2xl border border-line bg-surface/95 p-1 backdrop-blur lg:top-2" data-testid="site-tabs">
        {tabs.map((x) => (
          <button key={x.k} type="button" role="tab" aria-selected={tab === x.k} data-tab={x.k} onClick={() => setTab(x.k)} className={cn("flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition", tab === x.k ? "bg-accent-solid text-accent-fg" : "text-muted hover:bg-surface-hover hover:text-fg")}>
            <x.icon className="h-4 w-4" /> {x.label}
          </button>
        ))}
      </div>
      {tab === "design" ? <DesignPanel theme={v.theme} onChange={(theme) => set({ theme })} proAllowed={proTemplates} /> : null}
      {tab === "business" ? (
        <BusinessPanel
          siteName={v.name}
          settings={v.settings ?? {}}
          pages={v.pages ?? {}}
          onSettings={(settings) => set({ settings })}
          onPages={(pages) => set({ pages })}
          hasForms={v.blocks.some((b) => b.type === "form")}
          hasBooking={v.blocks.some((b) => b.type === "booking")}
        />
      ) : null}
      {tab === "domain" ? domainSlot : null}
      <div className={tab === "content" ? "space-y-4" : "hidden"}>
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
                      <Field key={f.key} label={t(f.labelKey ?? `websites.fields.${f.key}`)} htmlFor={fid} error={err(`blocks.${i}.data.${f.key}`)} className={cn(f.multiline && "sm:col-span-2")}>
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
                          <>
                            <Textarea id={fid} rows={f.key === "body" ? 6 : 2} value={value} onChange={(e) => onChange(e.target.value)} />
                            {aiCopy && value.trim().length > 1 ? <ImproveCopyButton value={value} field={f.key} onChange={onChange} /> : null}
                          </>
                        ) : f.options ? (
                          <Select id={fid} value={value} onChange={(e) => onChange(e.target.value)}>
                            {f.options.map((o) => (
                              <option key={o} value={o}>
                                {o === "" ? t("common.no") : o === "yes" ? t("common.yes") : o}
                              </option>
                            ))}
                          </Select>
                        ) : f.image && !(b.type === "hero" && aiImages) ? (
                          <div className="flex gap-2">
                            <Input id={fid} dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://" />
                            <Button variant="secondary" size="sm" className="h-10 shrink-0" loading={uploading === fid} onClick={() => pickImage(fid, (u) => setBlock(i, { ...b.data, [f.key]: u }))}>
                              <Upload className="h-4 w-4" /> {t("websites.upload")}
                            </Button>
                          </div>
                        ) : b.type === "hero" && f.key === "image_url" && aiImages ? (
                          <div className="flex gap-2">
                            <Input id={fid} dir="ltr" value={value} onChange={(e) => onChange(e.target.value)} />
                            <Button variant="secondary" size="sm" className="h-10 shrink-0" loading={imaging} onClick={() => aiImage(i)}>
                              <ImageIcon className="h-4 w-4" /> {t("websites.aiImage")}
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Input id={fid} dir={f.ltr ? "ltr" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
                            {aiCopy && !f.ltr && (f.key === "title" || f.key === "cta_label" || f.key === "label") && value.trim().length > 1 ? <ImproveCopyButton value={value} field={f.key} onChange={onChange} /> : null}
                          </>
                        )}
                      </Field>
                    );
                  })}
                </div>
                {spec.items ? (
                  <div className="mt-3 space-y-2">
                    {items.map((it, k) => (
                      <div key={k} className={cn("grid gap-2 rounded-xl border border-line p-3", spec.items!.fields.length > 2 ? "sm:grid-cols-2" : "sm:grid-cols-[1fr_2fr_auto]")}>
                        {spec.items!.fields.map((f) => (
                          <Field key={f.key} label={t(f.labelKey ?? `websites.fields.${f.key}`)} htmlFor={`bl-${i}-it-${k}-${f.key}`} error={err(`blocks.${i}.data.items.${k}.${f.key}`)} className={cn(f.multiline && spec.items!.fields.length > 2 && "sm:col-span-2")}>
                            {f.options ? (
                              <Select id={`bl-${i}-it-${k}-${f.key}`} value={it[f.key] ?? ""} onChange={(e) => setBlock(i, { ...b.data, items: items.map((x, m) => (m === k ? { ...x, [f.key]: e.target.value } : x)) })}>
                                {f.options.map((o) => (
                                  <option key={o} value={o}>
                                    {o === "" ? t("common.no") : o === "yes" ? t("common.yes") : o === "5" ? "★★★★★" : o}
                                  </option>
                                ))}
                              </Select>
                            ) : f.image ? (
                              <div className="flex gap-2">
                                <Input id={`bl-${i}-it-${k}-${f.key}`} dir="ltr" placeholder="https://" value={it[f.key] ?? ""} onChange={(e) => setBlock(i, { ...b.data, items: items.map((x, m) => (m === k ? { ...x, [f.key]: e.target.value } : x)) })} />
                                <Button variant="secondary" size="sm" className="h-10 shrink-0" aria-label={t("websites.upload")} loading={uploading === `bl-${i}-it-${k}-${f.key}`} onClick={() => pickImage(`bl-${i}-it-${k}-${f.key}`, (u) => setV((x) => ({ ...x, blocks: x.blocks.map((bb, j) => (j === i ? { ...bb, data: { ...bb.data, items: ((bb.data.items as Item[]) ?? []).map((y, m) => (m === k ? { ...y, [f.key]: u } : y)) } } : bb)) })))}>
                                  <Upload className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : f.multiline ? (
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

      <StarterKits onPick={addKit} />

      </div>
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
