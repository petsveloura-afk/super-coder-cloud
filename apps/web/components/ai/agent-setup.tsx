"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowDown, ArrowUp, ImagePlus, Link2, ListOrdered, MessageSquareText, Plus, Save, Sparkles, Tags, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button, Input, Textarea } from "@/components/ui/primitives";
import { saveAgentSetupAction, uploadAgentMediaAction } from "@/app/[locale]/(dashboard)/ai-agents/actions";
import { cn } from "@/lib/utils";

/**
 * Agent conversation setup — everything through the UI:
 *   the conversation script (ordered, re-orderable steps), the details the agent
 *   must find out, the pricing & negotiation policy, links it may send, the
 *   Telegram / chat menu buttons and a gallery of examples it shows customers.
 */

export interface SetupAgent {
  id: string;
  name: string;
  lead_goal: string | null;
  profile: {
    flow?: string[];
    fields?: string[];
    pricing?: string;
    links?: string[];
    menu?: string[];
    media?: { title: string; url: string; caption?: string }[];
  } | null;
}

function ListEditor({ items, onChange, placeholder, max, ordered, testId, maxLen = 300 }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; max: number; ordered?: boolean; testId: string; maxLen?: number }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onChange(next);
  };
  const add = () => {
    const v = draft.trim().slice(0, maxLen);
    if (!v || items.length >= max) return;
    onChange([...items, v]);
    setDraft("");
  };
  return (
    <div className="space-y-2" data-testid={testId}>
      {items.length ? (
        <ol className="space-y-1.5">
          {items.map((it, i) => (
            <li key={`${i}-${it}`} className="flex items-center gap-2 rounded-xl border border-line bg-elevated px-2.5 py-1.5">
              {ordered ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">{i + 1}</span> : null}
              <input
                value={it}
                maxLength={maxLen}
                aria-label={`${placeholder} ${i + 1}`}
                onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                dir="auto"
              />
              {ordered ? (
                <>
                  <button type="button" className="rounded-md p-1 text-muted hover:text-fg disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("ai.setup.up")}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded-md p-1 text-muted hover:text-fg disabled:opacity-30" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={t("ai.setup.down")}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                </>
              ) : null}
              <button type="button" className="rounded-md p-1 text-muted hover:text-danger" onClick={() => onChange(items.filter((_, k) => k !== i))} aria-label={t("common.delete")}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      {items.length < max ? (
        <div className="flex gap-2">
          <Input
            value={draft}
            maxLength={maxLen}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            dir="auto"
          />
          <Button type="button" variant="secondary" onClick={add} aria-label={t("ai.setup.add")}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: typeof Sparkles; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-[12.5px] leading-relaxed text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Downscale big photos in the browser (max 1600px, JPEG) — faster uploads, lighter messages. */
async function shrink(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size < 400_000) return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", 0.85));
}

export function AgentSetup({ agent }: { agent: SetupAgent }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const p = agent.profile ?? {};
  const [flow, setFlow] = useState<string[]>(p.flow ?? []);
  const [fields, setFields] = useState<string[]>(p.fields ?? []);
  const [pricing, setPricing] = useState(p.pricing ?? "");
  const [links, setLinks] = useState<string[]>(p.links ?? []);
  const [menu, setMenu] = useState<string[]>(p.menu ?? []);
  const [media, setMedia] = useState<{ title: string; url: string; caption?: string }[]>(p.media ?? []);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const goal = agent.lead_goal ?? "lead";

  const save = () =>
    start(async () => {
      const r = await saveAgentSetupAction({ locale, id: agent.id, flow: flow.filter((x) => x.trim()), fields: fields.filter((x) => x.trim()), pricing, links: links.filter((x) => x.trim()), menu: menu.filter((x) => x.trim()), media });
      if (r.error) toast.error(t(r.error));
      else {
        toast.success(t("ai.saved"));
        router.refresh();
      }
    });

  return (
    <div className="space-y-4 pb-24" data-testid="agent-setup">
      <Section icon={ListOrdered} title={t("ai.setup.flowTitle")} hint={t("ai.setup.flowHint")}>
        {!flow.length ? (
          <Button type="button" variant="secondary" size="sm" className="mb-2" onClick={() => setFlow(t(`ai.setup.flowTemplates.${goal}`).split("\n").filter(Boolean))} data-testid="flow-template">
            <Sparkles className="h-4 w-4" /> {t("ai.setup.loadTemplate")}
          </Button>
        ) : null}
        <ListEditor items={flow} onChange={setFlow} placeholder={t("ai.setup.flowPlaceholder")} max={15} ordered testId="flow-editor" />
      </Section>

      <Section icon={Tags} title={t("ai.setup.fieldsTitle")} hint={t("ai.setup.fieldsHint")}>
        <ListEditor items={fields} onChange={setFields} placeholder={t("ai.setup.fieldsPlaceholder")} max={15} testId="fields-editor" maxLen={120} />
      </Section>

      <Section icon={Wallet} title={t("ai.setup.pricingTitle")} hint={t("ai.setup.pricingHint")}>
        <Textarea value={pricing} onChange={(e) => setPricing(e.target.value)} rows={4} maxLength={3000} placeholder={t("ai.setup.pricingPlaceholder")} aria-label={t("ai.setup.pricingTitle")} dir="auto" />
      </Section>

      <Section icon={Link2} title={t("ai.setup.linksTitle")} hint={t("ai.setup.linksHint")}>
        <ListEditor items={links} onChange={setLinks} placeholder={t("ai.setup.linksPlaceholder")} max={20} testId="links-editor" maxLen={400} />
      </Section>

      <Section icon={MessageSquareText} title={t("ai.setup.menuTitle")} hint={t("ai.setup.menuHint")}>
        <ListEditor items={menu} onChange={setMenu} placeholder={t("ai.setup.menuPlaceholder")} max={8} ordered testId="menu-editor" maxLen={30} />
        {menu.length ? (
          <div className="mt-3 rounded-2xl bg-[#17212b] p-3" aria-hidden="true">
            <div className="mb-2 text-[11px] text-white/50">{t("ai.setup.menuPreview")}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {menu.map((m, i) => (
                <div key={i} className="truncate rounded-lg bg-[#2b5278] px-2 py-2 text-center text-[13px] text-white">
                  {m}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Section>

      <Section icon={ImagePlus} title={t("ai.setup.mediaTitle")} hint={t("ai.setup.mediaHint")}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          data-testid="media-file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setUploading(true);
            const blob = await shrink(f);
            const fd = new FormData();
            fd.set("locale", locale);
            fd.set("id", agent.id);
            fd.set("file", new File([blob], f.name.replace(/\.\w+$/, blob.type === "image/jpeg" ? ".jpg" : "$&"), { type: blob.type || f.type }));
            const r = await uploadAgentMediaAction(fd);
            setUploading(false);
            if (r.error || !r.data?.url) return toast.error(t(r.error ?? "ai.setup.uploadFailed"));
            setMedia((m) => [...m, { title: f.name.replace(/\.\w+$/, "").slice(0, 80), url: r.data!.url, caption: "" }]);
          }}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {media.map((m, i) => (
            <div key={m.url} className="overflow-hidden rounded-xl border border-line bg-elevated" data-testid="media-item">
              <div className="relative aspect-video bg-black/20">
                <Image src={m.url} alt={m.title} fill className="object-cover" unoptimized />
              </div>
              <div className="space-y-1.5 p-2.5">
                <Input value={m.title} maxLength={80} aria-label={t("ai.setup.mediaName")} placeholder={t("ai.setup.mediaName")} onChange={(e) => setMedia(media.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} dir="auto" />
                <Input value={m.caption ?? ""} maxLength={300} aria-label={t("ai.setup.mediaCaption")} placeholder={t("ai.setup.mediaCaption")} onChange={(e) => setMedia(media.map((x, k) => (k === i ? { ...x, caption: e.target.value } : x)))} dir="auto" />
                <button type="button" className="inline-flex items-center gap-1 text-[12px] text-danger hover:underline" onClick={() => setMedia(media.filter((_, k) => k !== i))}>
                  <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
                </button>
              </div>
            </div>
          ))}
          {media.length < 20 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={cn("grid min-h-40 place-items-center rounded-xl border-2 border-dashed border-line text-sm text-muted transition hover:border-accent hover:text-accent", uploading && "animate-pulse")}
            >
              <span className="flex flex-col items-center gap-1.5">
                <ImagePlus className="h-6 w-6" /> {uploading ? t("common.loading") : t("ai.setup.mediaUpload")}
              </span>
            </button>
          ) : null}
        </div>
      </Section>

      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 px-4 lg:bottom-6 lg:start-auto lg:end-8 lg:w-auto lg:px-0">
        <Button onClick={save} loading={pending} className="h-12 w-full shadow-xl lg:w-auto" data-testid="setup-save">
          <Save className="h-4 w-4" /> {t("ai.setup.save")}
        </Button>
      </div>
    </div>
  );
}
