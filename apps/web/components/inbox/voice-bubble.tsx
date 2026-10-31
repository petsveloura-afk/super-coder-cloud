import { Mic, Phone } from "lucide-react";

const HEIGHTS = [6, 12, 18, 10, 20, 14, 8, 16, 22, 12, 7, 15, 19, 9, 13, 6, 17, 11];

/**
 * Wave 59 — WhatsApp-style voice bubble: a waveform for voice messages / phone turns, a player when the
 * audio is reachable. The transcript stays right under it (existing).
 */
export function VoiceBubble({ url, phone, label }: { url?: string | null; phone?: boolean; label: string }) {
  const Icon = phone ? Phone : Mic;
  return (
    <div className="mb-1.5 flex items-center gap-2" data-testid="voice-bubble">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface/70">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      {url ? (
        <audio controls preload="none" src={url} className="h-8 max-w-[14rem]" aria-label={label} />
      ) : (
        <span className="wave-bars flex h-6 items-center gap-[3px] opacity-80" role="img" aria-label={label}>
          {HEIGHTS.map((h, i) => (
            <span key={i} style={{ height: `${h}px`, animationPlayState: i % 3 ? "running" : "paused" }} />
          ))}
        </span>
      )}
    </div>
  );
}
