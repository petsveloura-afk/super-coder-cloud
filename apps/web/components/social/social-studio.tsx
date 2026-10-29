"use client";

import { useState, useTransition } from "react";
import { ImagePlus, Images, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { aiImageAction, aiMoreTextAction, deleteAssetAction, listAssetsAction, saveAssetAction, type AssetRow } from "@/app/[locale]/(dashboard)/social/studio-actions";

/**
 * Wave 45 / stage A — post studio panel, shown inside the existing post editor.
 * One image per click (one credit); "more options" is an explicit click. Nothing is published here.
 */
export function StudioPanel({ body, setBody, setImage, image, fb, ig }: { body: string; setBody: (v: string) => void; setImage: (v: string) => void; image: string; fb: boolean; ig: boolean }) {
  const { t, locale } = useI18n();
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState<"friendly" | "professional" | "playful" | "premium">("friendly");
  const [images, setImages] = useState<string[]>([]);
  const [variants, setVariants] = useState<string[]>([]);
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [assetUrl, setAssetUrl] = useState("");
  const [pending, start] = useTransition();
  const platform = ig && !fb ? "instagram" : "facebook";
  const ready = topic.trim().length >= 2;

  const makeImages = (more: boolean) =>
    start(async () => {
      const r = await aiImageAction({ locale, topic, platform, more, existing: images.length });
      if (r.error) return void toast.error(t(r.error));
      const got = r.data?.images.map((i) => i.url) ?? [];
      setImages((cur) => (more ? [...cur, ...got] : got));
      if (!more && got[0]) setImage(got[0]);
      if (r.data?.partialError) toast.error(t(r.data.partialError));
      setAssets(null);
    });

  const makeText = () =>
    start(async () => {
      const r = await aiMoreTextAction({ locale, topic, tone, platform, current: body });
      if (r.error) return void toast.error(t(r.error));
      setVariants(r.data?.variants ?? []);
    });

  const openLibrary = () =>
    start(async () => {
      const r = await listAssetsAction({ locale });
      if (r.error) return void toast.error(t(r.error));
      setAssets(r.data?.assets ?? []);
    });

  const addUrl = () =>
    start(async () => {
      const r = await saveAssetAction({ locale, url: assetUrl });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      setAssetUrl("");
      const l = await listAssetsAction({ locale });
      if (!l.error) setAssets(l.data?.assets ?? []);
    });

  const remove = (id: string) =>
    start(async () => {
      const r = await deleteAssetAction({ locale, id });
      if (r.error) return void toast.error(t(r.error));
      setAssets((cur) => (cur ?? []).filter((a) => a.id !== id));
    });

  const pick = (url: string) => {
    setImage(url);
    toast.success(t("social.studio.imageChosen"));
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-3" data-testid="studio-panel">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <ImagePlus className="h-3.5 w-3.5" /> {t("social.studio.title")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("social.studio.topic")} className="h-9 min-w-[12rem] flex-1" dir="auto" aria-label={t("social.studio.topic")} />
        <select value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} className="h-9 rounded-xl border border-line bg-surface px-2 text-sm" aria-label={t("social.studio.tone")}>
          {(["friendly", "professional", "playful", "premium"] as const).map((x) => (
            <option key={x} value={x}>
              {t(`social.pro.composer.tone.${x}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" loading={pending} disabled={!ready} onClick={() => makeImages(false)}>
          <ImagePlus className="h-3.5 w-3.5" /> {t("social.studio.makeImage")}
        </Button>
        {images.length > 0 && images.length < 3 ? (
          <Button size="sm" variant="secondary" loading={pending} disabled={!ready} onClick={() => makeImages(true)}>
            {t("social.studio.moreImages")}
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" loading={pending} disabled={!ready} onClick={makeText}>
          <Sparkles className="h-3.5 w-3.5" /> {t("social.studio.moreText")}
        </Button>
        <Button size="sm" variant="ghost" loading={pending} onClick={openLibrary}>
          <Images className="h-3.5 w-3.5" /> {t("social.studio.library")}
        </Button>
      </div>
      <p className="text-[11px] text-subtle">{t("social.studio.costNote")}</p>

      {images.length ? (
        <div className="grid grid-cols-3 gap-2" role="group" aria-label={t("social.studio.results")}>
          {images.map((u) => (
            <button key={u} type="button" onClick={() => pick(u)} aria-pressed={image === u} className={cn("overflow-hidden rounded-xl border", image === u ? "border-accent ring-2 ring-accent/30" : "border-line")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={t("social.studio.imageAlt")} className="aspect-square w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      ) : null}

      {variants.length ? (
        <div className="space-y-2">
          {variants.map((v, i) => (
            <div key={i} className="rounded-xl border border-line p-2">
              <p className="whitespace-pre-wrap text-sm" dir="auto">
                {v}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setBody(v)}>
                {t("social.studio.useText")}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {assets ? (
        <div className="space-y-2" data-testid="asset-library">
          <div className="flex flex-wrap gap-2">
            <Input value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="https://…/image.jpg" dir="ltr" className="h-9 min-w-[12rem] flex-1" aria-label={t("social.studio.assetUrl")} />
            <Button size="sm" variant="secondary" loading={pending} disabled={!assetUrl.trim()} onClick={addUrl}>
              {t("social.studio.saveAsset")}
            </Button>
          </div>
          {assets.length === 0 ? <p className="text-sm text-muted">{t("social.studio.libraryEmpty")}</p> : null}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {assets.map((a) => (
              <div key={a.id} className="group relative overflow-hidden rounded-xl border border-line">
                <button type="button" onClick={() => pick(a.url)} className="block w-full" aria-label={a.title ?? t("social.studio.imageAlt")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.title ?? t("social.studio.imageAlt")} className="aspect-square w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                </button>
                <button type="button" onClick={() => remove(a.id)} className="absolute end-1 top-1 rounded-full bg-surface/90 p-1 text-danger" aria-label={t("social.studio.deleteAsset")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
