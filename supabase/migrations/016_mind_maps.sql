-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Mind maps: ideas as trees, each map the person's own.
-- Idempotent: safe to run twice. Depends on nothing but auth.
--
--   · lifeos_mind_maps  — one row per map: the document (the tree, its
--                         style), its title (the central idea), a small
--                         preview for the gallery, and a revision number:
--                         a save says which revision it started from, so
--                         two tabs never silently overwrite each other.
--   · lifeos-map-images — a private Storage bucket for the images placed
--                         on ideas, each person's under their own folder.
--
-- Until this runs, the app degrades instead of breaking: the maps tab says
-- it needs this migration; everything else works as before.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.lifeos_mind_maps (
  id          uuid primary key default gen_random_uuid(),
  user_key    text not null,
  title       text not null,
  doc         jsonb not null,
  preview     text,
  node_count  integer not null default 1,
  revision    integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$
begin
  alter table public.lifeos_mind_maps
    add constraint lifeos_mind_maps_shape_chk check (
      char_length(title) between 1 and 200
      and node_count between 1 and 3000
      and revision >= 1
      and jsonb_typeof(doc) = 'object'
      and octet_length(doc::text) <= 4194304
      and (preview is null or char_length(preview) <= 200000)
    );
exception when duplicate_object then null;
end $$;

create index if not exists lifeos_mind_maps_owner_idx
  on public.lifeos_mind_maps (user_key, updated_at desc);

alter table public.lifeos_mind_maps enable row level security;
drop policy if exists lifeos_mind_maps_owner on public.lifeos_mind_maps;
create policy lifeos_mind_maps_owner on public.lifeos_mind_maps
  for all
  using (user_key = auth.uid()::text)
  with check (user_key = auth.uid()::text);

-- ── Images on ideas ───────────────────────────────────────────────
-- A private bucket; each person reads, writes and deletes only their own
-- folder ("<user_key>/<file>"). Raster images only — an SVG could carry a
-- script — and at most 5 MB (the editor scales an image down first).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lifeos-map-images', 'lifeos-map-images', false, 5242880, array['image/webp', 'image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists lifeos_map_images_read on storage.objects;
create policy lifeos_map_images_read on storage.objects
  for select
  using (bucket_id = 'lifeos-map-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists lifeos_map_images_write on storage.objects;
create policy lifeos_map_images_write on storage.objects
  for insert
  with check (bucket_id = 'lifeos-map-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists lifeos_map_images_delete on storage.objects;
create policy lifeos_map_images_delete on storage.objects
  for delete
  using (bucket_id = 'lifeos-map-images' and (storage.foldername(name))[1] = auth.uid()::text);
