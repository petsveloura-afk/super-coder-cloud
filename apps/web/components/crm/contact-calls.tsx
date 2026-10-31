import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";

/**
 * Wave 59 — the contact's phone calls on the contact card: when, how long, the AI summary, the transcript
 * and the recording (when recording is on). Renders nothing when the contact has no calls.
 */
export async function ContactCalls({ orgId, contactId, locale }: { orgId: string; contactId: string; locale: "he" | "en" | "ar" }) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("voice_calls").select("id, direction, status, duration_sec, summary, turns, created_at").eq("organization_id", orgId).eq("contact_id", contactId).neq("direction", "alert").order("created_at", { ascending: false }).limit(6);
  if (error || !data?.length) return null;
  const ids = data.map((c) => c.id as string);
  const { data: rec } = await supabase.from("voice_calls").select("id, recording_url").in("id", ids);
  const hasRec = new Set(((rec ?? []) as { id: string; recording_url: string | null }[]).filter((r) => r.recording_url).map((r) => r.id));
  const { t } = await getT(locale);
  const when = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-GB" : locale === "ar" ? "ar" : "he-IL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Card id="calls" data-testid="contact-calls">
      <CardHeader title={t("phone.callsTitle")} />
      <ul className="divide-y divide-line">
        {(data as { id: string; direction: string; status: string; duration_sec: number | null; summary: string | null; turns: { role: string; text: string }[] | null; created_at: string }[]).map((c) => (
          <li key={c.id} className="space-y-1.5 px-5 py-3 text-[13px]">
            <p className="flex flex-wrap items-center gap-2">
              {c.direction === "in" ? <PhoneIncoming className="h-4 w-4 text-accent" aria-hidden /> : <PhoneOutgoing className="h-4 w-4 text-accent" aria-hidden />}
              <span className="font-medium">{when(c.created_at)}</span>
              {c.duration_sec ? <span className="text-muted">{`${Math.floor(c.duration_sec / 60)}:${String(c.duration_sec % 60).padStart(2, "0")}`}</span> : null}
            </p>
            {c.summary ? (
              <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-muted" dir="auto">
                {c.summary}
              </p>
            ) : null}
            {hasRec.has(c.id) ? <audio controls preload="none" src={`/api/voice/recording/${c.id}`} className="h-9 w-full" aria-label={t("phone.recording")} /> : null}
            {(c.turns ?? []).length ? (
              <details className="group">
                <summary className="cursor-pointer text-[12.5px] font-semibold text-accent">{t("phone.transcript")}</summary>
                <ol className="mt-1.5 space-y-1">
                  {(c.turns ?? []).slice(0, 40).map((x, i) => (
                    <li key={i} className="text-[12.5px]" dir="auto">
                      <span className="font-semibold">{x.role === "caller" ? t("phone.caller") : t("phone.agent")}: </span>
                      <span className="text-muted">{x.text}</span>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
