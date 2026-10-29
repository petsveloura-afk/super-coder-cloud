-- Wave 56 — phone calls at a human level: the agent's own voice on every call (short-lived audio clips
-- for Twilio <Play>) and live calls through the bridge (continuous audio, interruptions).
-- Additive and idempotent: one new table (server only) and one new column with a default.

-- short clips of the agent's voice, served to Twilio for a few minutes (service role only — no policies)
create table if not exists public.voice_clips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  mime text not null default 'audio/mpeg' check (mime in ('audio/mpeg', 'audio/wav', 'audio/basic')),
  audio_b64 text not null check (char_length(audio_b64) <= 3000000),
  created_at timestamptz not null default now()
);
create index if not exists voice_clips_created on public.voice_clips (created_at);
alter table public.voice_clips enable row level security;
revoke all on public.voice_clips from anon, authenticated;

-- how the call ran: turn by turn (Twilio speech recognition) or live (bridge audio stream)
alter table public.voice_calls add column if not exists mode text not null default 'turn';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'voice_calls_mode_check') then
    alter table public.voice_calls add constraint voice_calls_mode_check check (mode in ('turn', 'realtime'));
  end if;
end $$;

notify pgrst, 'reload schema';
