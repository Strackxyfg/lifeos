-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Voice: notes that keep the voice they were said in.
-- Idempotent: safe to run twice. Depends on 007.
--
-- Until this runs, the app degrades instead of breaking: a voice note is
-- still transcribed and saved as a note, but its recording is not kept, and
-- the screen says so.
-- ════════════════════════════════════════════════════════════════════

-- ── Recordings ───────────────────────────────────────────────────────
-- One row per recording, with its transcript word by word (start and end
-- in milliseconds) so a note can be played back with each word lit as it
-- is said, and a note split out of a memo can play just its own passage.
-- The audio itself lives in Storage, under the owner's folder.
create table if not exists public.lifeos_brain_audio (
  id           uuid primary key default gen_random_uuid(),
  user_key     text not null,
  path         text not null,
  mime         text not null,
  bytes        integer not null check (bytes > 0 and bytes <= 5242880),
  duration_ms  integer not null check (duration_ms >= 0 and duration_ms <= 3600000),
  language     text,
  transcript   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

do $$
begin
  -- A recording's file is in its owner's folder: "<user_key>/<file>".
  alter table public.lifeos_brain_audio
    add constraint lifeos_brain_audio_path_owner check (split_part(path, '/', 1) = user_key and path not like '%..%');
exception when duplicate_object then null;
end $$;

create index if not exists lifeos_brain_audio_user_idx on public.lifeos_brain_audio (user_key, created_at desc);

alter table public.lifeos_brain_audio enable row level security;
drop policy if exists lifeos_brain_audio_owner on public.lifeos_brain_audio;
create policy lifeos_brain_audio_owner on public.lifeos_brain_audio
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

-- ── Notes that point into a recording ────────────────────────────────
-- A voice note plays its whole recording; a note split out of a memo plays
-- the passage it came from (start and end in milliseconds). Deleting the
-- recording leaves the notes, as text.
alter table public.lifeos_brain_items add column if not exists audio_id uuid
  references public.lifeos_brain_audio(id) on delete set null;
alter table public.lifeos_brain_items add column if not exists audio_start_ms integer;
alter table public.lifeos_brain_items add column if not exists audio_end_ms integer;

do $$
begin
  alter table public.lifeos_brain_items
    add constraint lifeos_brain_items_audio_range_chk
    check (
      (audio_start_ms is null or audio_start_ms >= 0)
      and (audio_end_ms is null or audio_start_ms is null or audio_end_ms > audio_start_ms)
    );
exception when duplicate_object then null;
end $$;

create index if not exists lifeos_brain_items_audio_idx on public.lifeos_brain_items (audio_id) where audio_id is not null;

-- ── Storage ──────────────────────────────────────────────────────────
-- A private bucket; each person reads, writes and deletes only their own
-- folder. Size and formats are enforced by Storage as well as by the app.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lifeos-audio', 'lifeos-audio', false, 5242880,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/x-m4a', 'audio/m4a']
)
on conflict (id) do nothing;

drop policy if exists lifeos_audio_read on storage.objects;
create policy lifeos_audio_read on storage.objects
  for select
  using (bucket_id = 'lifeos-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists lifeos_audio_write on storage.objects;
create policy lifeos_audio_write on storage.objects
  for insert
  with check (bucket_id = 'lifeos-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists lifeos_audio_delete on storage.objects;
create policy lifeos_audio_delete on storage.objects
  for delete
  using (bucket_id = 'lifeos-audio' and (storage.foldername(name))[1] = auth.uid()::text);
