-- ════════════════════════════════════════════════════════════════════
-- LifeOS — Memory: notes that come back, tensions that get decided.
-- Idempotent: safe to run twice. Depends on 007 and 008.
--
-- Until this runs, the app degrades instead of breaking: the daily review
-- falls back to one resurfaced note, and a tension can be decided (the
-- decision is written as a note, connected to both sides) but stays listed
-- as open.
-- ════════════════════════════════════════════════════════════════════

-- ── Spaced review ────────────────────────────────────────────────────
-- When a note is next due for review, how far apart its reviews now are,
-- and when it was last reviewed. A note never reviewed has no row values:
-- its first review is computed from its age, so applying this migration
-- does not make every old note due on the same morning.
alter table public.lifeos_brain_items add column if not exists review_due date;
alter table public.lifeos_brain_items add column if not exists review_interval integer;
alter table public.lifeos_brain_items add column if not exists reviewed_at timestamptz;

do $$
begin
  alter table public.lifeos_brain_items
    add constraint lifeos_brain_items_review_interval_chk
    check (review_interval is null or (review_interval between 1 and 3650));
exception when duplicate_object then null;
end $$;

-- The review queue reads "what is due by today" for one person.
create index if not exists lifeos_brain_items_review_idx
  on public.lifeos_brain_items (user_key, review_due)
  where review_due is not null;

-- ── Decided tensions ─────────────────────────────────────────────────
-- A tension resolved by a decision: the decision is a note of its own,
-- connected to both sides; the tension keeps existing — it is part of the
-- history of the thought — but no longer asks to be decided. Deleting the
-- decision reopens the tension.
alter table public.lifeos_brain_links add column if not exists resolved_by uuid
  references public.lifeos_brain_items(id) on delete set null;

do $$
begin
  alter table public.lifeos_brain_links
    add constraint lifeos_brain_links_resolved_chk
    check (resolved_by is null or kind = 'tension');
exception when duplicate_object then null;
end $$;

create index if not exists lifeos_brain_links_resolved_idx
  on public.lifeos_brain_links (resolved_by)
  where resolved_by is not null;
