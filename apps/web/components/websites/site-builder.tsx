"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Briefcase, ChevronsDownUp, ChevronsUpDown, ChevronDown, Copy, ExternalLink, Eye, Globe, Maximize2, ShieldAlert, GripVertical, ImageIcon, LayoutTemplate, ListTree, PanelRightClose, Plus, Redo2, Save, Trash2, Undo2, Upload } from "lucide-react";
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
import { SiteLivePreview } from "./site-live-preview";
import { LIVE_DRAFT, LIVE_READY } from "./site-live-frame";
import { stableStringify, type SiteDiff } from "@/lib/site/diff";
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

/**
 * wave 33 — editor state with history. A burst of typing (< 0.7 s apart) is ONE undo step;
 * undo / redo restore whole sections / design / SEO; the agent's edit is one step too.
 */
interface EditorState {
  v: SiteValue;
  past: SiteValue[];
  future: SiteValue[];
  at: number;
}
type EditorAction = { type: "set"; u: SiteValue | ((x: SiteValue) => SiteValue); now: number } | { type: "undo" } | { type: "redo" };
function editorReducer(s: EditorState, a: EditorAction): EditorState {
  if (a.type === "set") {
    const nv = typeof a.u === "function" ? a.u(s.v) : a.u;
    if (nv === s.v) return s;
    const push = a.now - s.at > 700;
    return { v: nv, past: push ? [...s.past, s.v].slice(-60) : s.past, future: [], at: a.now };
  }
  if (a.type === "undo") {
    const p = s.past[s.past.length - 1];
    return p ? { v: p, past: s.past.slice(0, -1), future: [...s.future, s.v], at: 0 } : s;
  }
  const n = s.future[s.future.length - 1];
  return n ? { v: n, past: [...s.past, s.v], future: s.future.slice(0, -1), at: 0 } : s;
}
/** the live preview opens by default on wide screens; the choice is remembered per browser */
const PREVIEW_KEY = "scc-site-preview";
/** unsaved work survives a reload / tab switch / coming back from "view site" (kept in this browser only) */
const DRAFT_PREFIX = "scc-site-unsaved:";
const DRAFT_MAX_AGE = 7 * 24 * 3600 * 1000;
const PREVIEW_EVENT = "scc-site-preview-change";
let memPreview: boolean | null = null; // used when storage is blocked
const previewSubscribe = (cb: () => void) => {
  window.addEventListener(PREVIEW_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(PREVIEW_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
};
const previewSnapshot = (): boolean => {
  if (memPreview !== null) return memPreview;
  try {
    const pref = window.localStorage.getItem(PREVIEW_KEY);
    if (pref) return pref === "1";
  } catch {
    /* storage blocked */
  }
  try {
    return window.matchMedia("(min-width: 1280px)").matches;
  } catch {
    return false;
  }
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
  const [editor, dispatch] = useReducer(editorReducer, { v: initial, past: [], future: [], at: 0 });
  const v = editor.v;
  const setV = useCallback((u: SiteValue | ((x: SiteValue) => SiteValue)) => dispatch({ type: "set", u, now: Date.now() }), []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<SiteBlockType>("hero");
  const [saving, start] = useTransition();
  const [imaging, startImage] = useTransition();
  const [tab, setTab] = useState<"content" | "design" | "business" | "domain">("content");
  const [uploading, setUploading] = useState<string | null>(null);
  // wave 33: live preview, highlight of what changed, collapsed sections, drag & drop, undo / redo
  const showPreview = useSyncExternalStore(previewSubscribe, previewSnapshot, () => false);
  const [scrollTo, setScrollTo] = useState<{ index: number; nonce: number } | null>(null);
  const [highlight, setHighlight] = useState<number[]>([]);
  const [collapsed, setCollapsed] = useState<number[]>([]);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [savedSnap, setSavedSnap] = useState(() => JSON.stringify(initial));
  const hlTimer = useRef<number | null>(null);
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
  // ---- wave 33 -------------------------------------------------------------------------
  const canUndo = editor.past.length > 0;
  const canRedo = editor.future.length > 0;
  const undo = useCallback(() => {
    setCollapsed([]);
    dispatch({ type: "undo" });
  }, []);
  const redo = useCallback(() => {
    setCollapsed([]);
    dispatch({ type: "redo" });
  }, []);
  const dirty = useMemo(() => JSON.stringify(v) !== savedSnap, [v, savedSnap]);
  // wave 34: the newest editor state, readable from async callbacks (a save must never overwrite edits made while it ran)
  const vRef = useRef(v);
  useEffect(() => {
    vRef.current = v;
  });
  // wave 34e: unsaved work (the agent's too) is kept in this browser and restored if the page is reloaded
  const draftKey = `${DRAFT_PREFIX}${id ?? "new"}`;
  const draftOnce = useRef(false);
  useEffect(() => {
    if (draftOnce.current) return;
    draftOnce.current = true;
    try {
      const raw = window.localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { v?: SiteValue; at?: number } | null;
      if (!d?.v || !Array.isArray(d.v.blocks) || typeof d.at !== "number" || Date.now() - d.at > DRAFT_MAX_AGE) return void window.localStorage.removeItem(draftKey);
      if (JSON.stringify(d.v) === JSON.stringify(initial)) return void window.localStorage.removeItem(draftKey);
      setV(() => d.v as SiteValue);
      toast.info(t("websites.editor.draftRestored"), { duration: 12000, action: { label: t("websites.editor.draftUndo"), onClick: () => undo() } });
    } catch {
      /* storage blocked or damaged draft — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const writeDraft = useCallback(() => {
    try {
      if (dirty) window.localStorage.setItem(draftKey, JSON.stringify({ v: vRef.current, at: Date.now() }));
      else window.localStorage.removeItem(draftKey);
    } catch {
      /* storage full or blocked — the leave-page warning still applies */
    }
  }, [dirty, draftKey]);
  useEffect(() => {
    if (!draftOnce.current) return;
    const h = window.setTimeout(writeDraft, 400);
    return () => window.clearTimeout(h);
  }, [v, writeDraft]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") writeDraft();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", writeDraft);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", writeDraft);
    };
  }, [writeDraft]);
  // leaving the page with unsaved work asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const togglePreview = useCallback((on: boolean) => {
    memPreview = on;
    try {
      window.localStorage.setItem(PREVIEW_KEY, on ? "1" : "0");
    } catch {
      /* private mode — fine */
    }
    window.dispatchEvent(new Event(PREVIEW_EVENT));
  }, []);
  /** scroll the editor AND the live preview to a section and flash it */
  const focusBlock = useCallback((index: number, opts?: { keepHighlight?: boolean }) => {
    setTab("content");
    setCollapsed((c) => c.filter((x) => x !== index));
    setScrollTo({ index, nonce: Date.now() });
    if (!opts?.keepHighlight) setHighlight([index]);
    window.setTimeout(() => document.getElementById(`blk-${index}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, []);
  /** after the agent's edit: show it — highlight the touched sections, open the preview, jump to the first */
  const onAgentApplied = useCallback(
    (diff: SiteDiff) => {
      setCollapsed([]);
      setHighlight(diff.touched);
      if (hlTimer.current) window.clearTimeout(hlTimer.current);
      hlTimer.current = window.setTimeout(() => setHighlight([]), 9000);
      togglePreview(true);
      if (diff.touched.length) focusBlock(diff.touched[0]!, { keepHighlight: true });
      // wave 34: the agent edits the EDITOR, not the live site — say so, so "view site" is never a surprise
      if (v.status === "published") toast.info(t("websites.editor.unsavedLiveTitle"), { description: t("websites.editor.unsavedLiveBody") });
    },
    [focusBlock, togglePreview, v.status, t],
  );
  const duplicateBlock = (i: number) => {
    if (v.blocks.length >= 40) return void toast.error(t("websites.kits.full"));
    setCollapsed([]);
    setV((x) => {
      const copy = JSON.parse(JSON.stringify(x.blocks[i])) as BlockValue;
      const b = [...x.blocks];
      b.splice(i + 1, 0, copy);
      return { ...x, blocks: b };
    });
    setHighlight([i + 1]);
    window.setTimeout(() => setHighlight([]), 2500);
  };
  const dropBlock = (to: number) => {
    const from = dragFrom;
    setDragFrom(null);
    setDragOver(null);
    if (from === null || from === to) return;
    setCollapsed([]);
    setV((x) => {
      const b = [...x.blocks];
      const [m] = b.splice(from, 1);
      b.splice(to, 0, m!);
      return { ...x, blocks: b };
    });
    setHighlight([to]);
    window.setTimeout(() => setHighlight([]), 2500);
  };
  /** first readable text of a section — shown when it is collapsed */
  const blockSummary = (b: BlockValue) => {
    const d = b.data as Record<string, unknown>;
    const first = ["title", "subtitle", "body", "text", "quote", "label"].map((k) => d[k]).find((x) => typeof x === "string" && x.trim()) as string | undefined;
    const n = Array.isArray(d.items) ? (d.items as unknown[]).length : 0;
    return [first?.trim().slice(0, 70), n ? `${n} ×` : ""].filter(Boolean).join(" · ");
  };
  const livePreviewDraft = useMemo(() => ({ name: v.name, slug: v.slug, theme: v.theme as Record<string, unknown>, blocks: v.blocks, settings: v.settings ?? {}, pages: v.pages ?? {} }), [v.name, v.slug, v.theme, v.blocks, v.settings, v.pages]);
  // ---- wave 34: full-page preview of the CURRENT (unsaved) state in its own tab ------------
  const liveRef = useRef(livePreviewDraft);
  const fullWin = useRef<Window | null>(null);
  useEffect(() => {
    liveRef.current = livePreviewDraft;
    const w = fullWin.current;
    if (w && !w.closed) w.postMessage({ type: LIVE_DRAFT, site: livePreviewDraft }, window.location.origin);
  }, [livePreviewDraft]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || !fullWin.current || e.source !== fullWin.current) return;
      if ((e.data as { type?: string } | null)?.type === LIVE_READY) fullWin.current.postMessage({ type: LIVE_DRAFT, site: liveRef.current }, window.location.origin);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const openFullPreview = () => {
    const w = window.open(`/${locale}/site-live`, "scc-site-full-preview");
    if (!w) return void toast.error(t("websites.editor.popupBlocked"));
    fullWin.current = w;
    w.focus();
  };
  /** "view site" never shows a stale page: unsaved work is saved (keeping the publish state) first */
  /** a fresh address every time, so a browser or CDN copy of the old page is never shown */
  const fresh = (u: string) => `${u}${u.includes("?") ? "&" : "?"}v=${Date.now()}`;
  const saveAndView = (target: string) => {
    const w = window.open("", "_blank");
    if (!w) return void toast.error(t("websites.editor.popupBlocked"));
    save(v.status, (ok) => {
      if (!ok) return void w.close();
      w.location.href = fresh(target);
    });
  };
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

  /** `after` (wave 34) runs when the save finished — true on success; used by "save and view site" */
  function save(status: SiteValue["status"], after?: (ok: boolean) => void) {
    setErrors({});
    start(async () => {
      const res = await saveSiteAction({ locale, id, data: { ...v, status } });
      if (res.error) {
        setErrors(res.fieldErrors ?? {});
        toast.error(t(res.fieldErrors?.blocks ?? res.error));
        after?.(false);
        return;
      }
      // wave 34: what the server really stored is the truth — if it trimmed / limited anything, the editor and the
      // preview adopt it, so "what I see" is always "what is live" (only when nothing was typed during the save)
      const sent = v;
      let final: SiteValue = { ...sent, status };
      const stored = res.data?.site;
      if (stored) {
        const canon = (o: unknown) => stableStringify(JSON.parse(JSON.stringify(o)));
        const same = canon({ n: stored.name, t: stored.theme, s: stored.seo, b: stored.blocks }) === canon({ n: sent.name, t: sent.theme, s: sent.seo, b: sent.blocks });
        if (!same && vRef.current === sent) {
          final = { ...final, name: stored.name, theme: stored.theme as SiteValue["theme"], seo: stored.seo, blocks: stored.blocks as unknown as BlockValue[] };
          toast.info(t("websites.editor.adjusted"));
        }
      }
      if (vRef.current === sent) setV(() => final);
      else set({ status });
      setSavedSnap(JSON.stringify(final));
      toast.success(t(res.message ?? "common.saved"));
      after?.(true);
      if (!id && res.data?.id) router.push(`/${locale}/websites/${res.data.id}`);
      else router.refresh();
    });
  }

  // wave 33: Ctrl/Cmd+S saves (keeps the current publish state); Ctrl/Cmd+Z / Y outside text fields = undo / redo
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (k === "s") {
        e.preventDefault();
        saveRef.current(v.status);
      } else if (!typing && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!typing && k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, v.status]);

  const url = liveUrl ?? `${publicBase}/${v.slug}`;
  const tabs = [
    { k: "content" as const, icon: ListTree, label: t("websites.tabs.content") },
    { k: "design" as const, icon: LayoutTemplate, label: t("websites.tabs.design") },
    { k: "business" as const, icon: Briefcase, label: t("websites.tabs.business") },
    ...(domainSlot ? [{ k: "domain" as const, icon: Globe, label: t("websites.tabs.domain") }] : []),
  ];
  return (
    <div className={showPreview ? "xl:grid xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] xl:items-start xl:gap-4" : ""} data-preview={showPreview ? "on" : "off"}>
    <div className="min-w-0 space-y-4">
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
      <AiEditPanel value={v} onApply={(nv) => setV(nv)} allowed={aiEditor} proTemplates={proTemplates} onApplied={onAgentApplied} onFocusBlock={(i) => focusBlock(i, { keepHighlight: true })} onUndone={() => setHighlight([])} />
      <SiteAuditPanel value={v} onApply={(nv) => setV(nv)} onGoTab={(k) => setTab(k)} allowed={aiEditor} proTemplates={proTemplates} onApplied={onAgentApplied} />
      {/* wave 33: editor toolbar — unsaved state, undo / redo, collapse all, live preview */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line bg-surface px-2.5 py-1.5" data-testid="editor-toolbar">
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors", dirty ? "bg-gold-soft text-gold" : "bg-success-soft text-success")} role="status" data-testid="editor-dirty">
          <span className={cn("h-1.5 w-1.5 rounded-full", dirty ? "animate-pulse bg-gold" : "bg-success")} />
          {t(dirty ? "websites.editor.unsaved" : "websites.editor.allSaved")}
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" aria-label={t("websites.editor.undo")} title={`${t("websites.editor.undo")} (Ctrl+Z)`} disabled={!canUndo} onClick={undo} data-testid="editor-undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label={t("websites.editor.redo")} title={`${t("websites.editor.redo")} (Ctrl+Y)`} disabled={!canRedo} onClick={redo} data-testid="editor-redo">
          <Redo2 className="h-4 w-4" />
        </Button>
        {tab === "content" && v.blocks.length > 1 ? (
          <Button variant="ghost" size="sm" onClick={() => setCollapsed(collapsed.length ? [] : v.blocks.map((_, i) => i))} data-testid="editor-collapse-all">
            {collapsed.length ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
            <span className="hidden sm:inline">{t(collapsed.length ? "websites.editor.expandAll" : "websites.editor.collapseAll")}</span>
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={openFullPreview} title={t("websites.editor.openFullPreview")} data-testid="editor-full-preview">
          <Maximize2 className="h-4 w-4" />
          <span className="hidden sm:inline">{t("websites.editor.openFullPreview")}</span>
        </Button>
        <Button variant={showPreview ? "primary" : "secondary"} size="sm" aria-pressed={showPreview} onClick={() => togglePreview(!showPreview)} data-testid="editor-preview-toggle">
          {showPreview ? <PanelRightClose className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {t(showPreview ? "websites.editor.hidePreview" : "websites.editor.showPreview")}
        </Button>
      </div>
      {/* wave 34: edits (the agent's too) live in the editor until saved — a published site keeps its last saved version */}
      {id && v.status === "published" && dirty ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold/40 bg-gold-soft/60 px-3.5 py-2.5" data-testid="editor-not-live">
          <ShieldAlert className="h-4 w-4 shrink-0 text-gold" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">{t("websites.editor.unsavedLiveTitle")}</p>
            <p className="text-[12.5px] text-muted">{t("websites.editor.unsavedLiveBody")}</p>
          </div>
          <Button size="sm" loading={saving} onClick={() => save(v.status)} data-testid="editor-save-live">
            <Save className="h-4 w-4" /> {t("websites.editor.saveAndUpdate")}
          </Button>
        </div>
      ) : null}
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
            <li
              key={i}
              id={`blk-${i}`}
              className={cn("scroll-mt-24 rounded-2xl transition-all duration-500", highlight.includes(i) && "ring-2 ring-accent/70 ring-offset-2 ring-offset-bg", dragOver === i && dragFrom !== null && dragFrom !== i && "translate-y-1 ring-2 ring-dashed ring-accent/60", dragFrom === i && "opacity-50")}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                if (dragOver !== i) setDragOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropBlock(i);
              }}
            >
              <Card className="p-4" data-block={b.type}>
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    draggable
                    aria-label={t("websites.editor.drag")}
                    title={t("websites.editor.drag")}
                    className="grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:cursor-grabbing"
                    onDragStart={(e) => {
                      setDragFrom(i);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(i));
                      const li = (e.currentTarget as HTMLElement).closest("li");
                      if (li) e.dataTransfer.setDragImage(li, 24, 24);
                    }}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                  <button type="button" className="flex min-w-0 items-center gap-2 text-start" aria-expanded={!collapsed.includes(i)} onClick={() => setCollapsed((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))}>
                    <ChevronDown className={cn("h-4 w-4 shrink-0 text-subtle transition-transform", collapsed.includes(i) && "-rotate-90 rtl:rotate-90")} />
                    <span className="shrink-0 rounded-lg bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent">{t(`websites.blocks.${b.type}`)}</span>
                    {collapsed.includes(i) ? <span className="truncate text-[12.5px] text-muted">{blockSummary(b)}</span> : null}
                  </button>
                  <span className="flex-1" />
                  {showPreview ? (
                    <Button variant="ghost" size="sm" aria-label={t("websites.editor.showInPreview")} title={t("websites.editor.showInPreview")} onClick={() => setScrollTo({ index: i, nonce: Date.now() })}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" aria-label={t("websites.editor.duplicate")} title={t("websites.editor.duplicate")} onClick={() => duplicateBlock(i)}>
                    <Copy className="h-4 w-4" />
                  </Button>
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
                {collapsed.includes(i) ? null : (
                <>
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
                </>
                )}
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
      <div className="flex flex-wrap items-center justify-end gap-2 max-lg:sticky max-lg:bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px)+0.5rem)] max-lg:z-30 max-lg:rounded-2xl max-lg:border max-lg:border-line max-lg:bg-surface/95 max-lg:p-2 max-lg:shadow-lg max-lg:backdrop-blur" data-testid="editor-actions">
        {id && v.status === "published" ? (
          dirty ? (
            <button type="button" disabled={saving} onClick={() => saveAndView(url)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-gold/50 bg-gold-soft/50 px-4 text-sm hover:bg-gold-soft disabled:opacity-60" data-testid="editor-save-and-view">
              <ExternalLink className="h-4 w-4" /> {t("websites.editor.saveAndView")}
            </button>
          ) : (
            <a href={url} target="_blank" rel="noreferrer" onClick={(e) => (e.currentTarget.href = fresh(url))} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-hover">
              <ExternalLink className="h-4 w-4" /> {t("websites.view")}
            </a>
          )
        ) : null}
        <Button variant="secondary" loading={saving} onClick={() => save("draft")}>
          <Save className="h-4 w-4" /> {t(v.status === "published" ? "websites.unpublish" : "websites.saveDraft")}
        </Button>
        <Button loading={saving} onClick={() => save("published")}>
          {t(v.status === "published" ? "websites.update" : "websites.publish")}
        </Button>
      </div>
    </div>
    {showPreview ? (
      <div className="order-first mb-4 h-[62dvh] xl:sticky xl:top-2 xl:order-none xl:mb-0 xl:h-[calc(100dvh-1.5rem)]">
        <SiteLivePreview draft={livePreviewDraft} scrollTo={scrollTo} onClose={() => togglePreview(false)} className="h-full" />
      </div>
    ) : null}
    </div>
  );
}
