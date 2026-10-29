"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, Crown, Flame, Heart, Play, Save, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { OPENAI_VOICES, presetSettings, type VoicePreset, type VoiceSettings } from "@/lib/ai/voice-persona-core";
import { previewVoiceAction, saveVoiceAction } from "@/app/[locale]/(dashboard)/ai-agents/voice-actions";

const PRESETS: { key: VoicePreset; icon: typeof Heart }[] = [
  { key: "soft_female", icon: Heart },
  { key: "authoritative_male", icon: Crown },
  { key: "energetic_sales", icon: Flame },
  { key: "custom", icon: SlidersHorizontal },
  { key: "default", icon: AudioLines },
];

/**
 * Wave 55 — the agent's voice: pick a persona (soft & warm female, deep authoritative male, high-energy
 * sales, a custom ElevenLabs voice or the platform default), fine-tune the ElevenLabs settings, choose
 * the OpenAI fallback voice, hear a sample, and teach speech-to-text the business' words.
 */
export function VoicePersonaCard({ agentId, value, ttsReady }: { agentId: string; value: VoiceSettings; ttsReady: boolean }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [v, setV] = useState<VoiceSettings>(value);
  const [glossary, setGlossary] = useState(value.glossary.join(", "));
  const [sample, setSample] = useState(t("voicePersona.sampleText"));
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [playing, startPlay] = useTransition();
  const current = (): VoiceSettings => ({ ...v, glossary: glossary.split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length >= 2) });
  const pick = (preset: VoicePreset) => setV(presetSettings(preset, { glossary: v.glossary }));
  const save = () =>
    startSave(async () => {
      const r = await saveVoiceAction({ locale, agentId, voice: current() });
      if (r.error) return void toast.error(t(r.error));
      toast.success(t(r.message ?? "common.saved"));
      router.refresh();
    });
  const preview = () =>
    startPlay(async () => {
      const r = await previewVoiceAction({ locale, voice: current(), text: sample });
      if (r.error || !r.data) return void toast.error(t(r.error ?? "voicePersona.previewFailed"));
      setAudioUrl(r.data.url);
    });
  const slider = (k: "stability" | "similarity_boost" | "style" | "speed", min: number, max: number, step: number) => {
    const id = `voice-${agentId}-${k}`;
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="flex items-center justify-between text-[12.5px] font-medium">
          <span>{t(`voicePersona.field.${k}`)}</span>
          <span className="tabular-nums text-muted" dir="ltr">
            {v[k].toFixed(2)}
          </span>
        </label>
        <input id={id} type="range" min={min} max={max} step={step} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: Number(e.target.value) }))} className="w-full accent-[var(--accent-solid)]" />
        <p className="text-[11.5px] text-subtle">{t(`voicePersona.hint.${k}`)}</p>
      </div>
    );
  };
  return (
    <div className="space-y-4 p-5" data-testid="voice-persona">
      {!ttsReady ? <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-[12.5px] text-warning">{t("voicePersona.noKey")}</p> : null}
      <div role="radiogroup" aria-label={t("voicePersona.persona")} className="grid gap-2 sm:grid-cols-2">
        {PRESETS.map(({ key, icon: Icon }) => {
          const on = v.preset === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pick(key)}
              className={cn("lift flex items-start gap-3 rounded-xl border p-3 text-start transition", on ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-hover")}
              data-voice-preset={key}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", on ? "bg-accent-solid text-accent-fg" : "bg-elevated text-accent")}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {t(`voicePersona.preset.${key}.name`)}
                  {on ? <Badge tone="success">{t("voicePersona.selected")}</Badge> : null}
                </span>
                <span className="block text-[12px] text-muted">{t(`voicePersona.preset.${key}.body`)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {v.preset !== "default" ? (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <Field label={t("voicePersona.field.voice_id")} htmlFor={`voice-${agentId}-id`} hint={t(v.preset === "custom" ? "voice.hint.voice_id_custom" : "voice.hint.voice_id")}>
            <Input id={`voice-${agentId}-id`} dir="ltr" value={v.voice_id} placeholder="21m00Tcm4TlvDq8ikWAM" onChange={(e) => setV((x) => ({ ...x, voice_id: e.target.value.trim() }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {slider("stability", 0, 1, 0.05)}
            {slider("similarity_boost", 0, 1, 0.05)}
            {slider("style", 0, 1, 0.05)}
            {slider("speed", 0.7, 1.2, 0.01)}
          </div>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={v.speaker_boost} onChange={(e) => setV((x) => ({ ...x, speaker_boost: e.target.checked }))} className="mt-0.5 h-5 w-5 accent-[var(--accent-solid)]" />
            <span>
              <span className="block text-sm font-medium">{t("voicePersona.field.speaker_boost")}</span>
              <span className="block text-[12px] text-muted">{t("voicePersona.hint.speaker_boost")}</span>
            </span>
          </label>
          <Field label={t("voicePersona.field.openai_voice")} htmlFor={`voice-${agentId}-oa`} hint={t("voicePersona.hint.openai_voice")}>
            <Select id={`voice-${agentId}-oa`} value={v.openai_voice} onChange={(e) => setV((x) => ({ ...x, openai_voice: e.target.value as VoiceSettings["openai_voice"] }))}>
              {OPENAI_VOICES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      <Field label={t("voicePersona.field.glossary")} htmlFor={`voice-${agentId}-gl`} hint={t("voicePersona.hint.glossary")}>
        <Textarea id={`voice-${agentId}-gl`} rows={2} value={glossary} onChange={(e) => setGlossary(e.target.value)} placeholder={t("voicePersona.glossaryPlaceholder")} dir="auto" />
      </Field>

      <div className="space-y-2 rounded-xl bg-elevated p-3">
        <label htmlFor={`voice-${agentId}-sample`} className="text-[12.5px] font-medium">
          {t("voicePersona.sample")}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id={`voice-${agentId}-sample`} value={sample} maxLength={220} onChange={(e) => setSample(e.target.value)} dir="auto" className="flex-1" />
          <Button type="button" variant="secondary" onClick={preview} loading={playing} disabled={!ttsReady || sample.trim().length < 2} data-testid="voice-preview">
            <Play className="h-4 w-4 rtl:-scale-x-100" aria-hidden /> {t("voicePersona.play")}
          </Button>
        </div>
        {audioUrl ? <audio src={audioUrl} controls autoPlay className="w-full" aria-label={t("voicePersona.sample")} /> : null}
      </div>

      <Button onClick={save} loading={saving} data-testid="voice-save">
        <Save className="h-4 w-4" aria-hidden /> {t("common.save")}
      </Button>
    </div>
  );
}
