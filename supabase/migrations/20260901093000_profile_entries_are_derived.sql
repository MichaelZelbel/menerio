-- profile_entries stops being a second, undated fact store.
--
-- Menerio has three overlapping stores for facts:
--   claims                 dated, confidence, source link, supersede rule
--   contact_relationships  dated, typed, has a target and inverses
--   profile_entries        flat label/value, NO dates, feeds get_user_profile
--
-- A fact belongs in one of the first two. profile_entries decides only what is
-- SHOWN and in what order. That single move fixes four things at once: the
-- undated mirror, the duplication, the 51-item firehose reaching every prompt,
-- and the two-managers collision.
--
-- The two managers, for the record, were never a duplicate and must never be
-- merged: "Manager: Phil Benton" is a profile entry (line manager,
-- disciplinary authority) and "Gunther Reinhard" is a contact relationship
-- (runs the work in the project, writes the evaluations). One word, two
-- different facts, both true. Michael confirmed the split 2026-08-31 as
-- line-manager and manager-in-project.
--
-- This migration adds columns and moves NO data. Moving a fact is his call.

ALTER TABLE public.profile_entries
  ADD COLUMN IF NOT EXISTS derived_from_claim_id uuid
    REFERENCES public.claims(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS show_to_agent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profile_entries.derived_from_claim_id IS
  'The claim this entry displays. NULL means hand-written and not yet promoted.';
COMMENT ON COLUMN public.profile_entries.show_to_agent IS
  'Whether get_user_profile hands this to an LLM unasked. Default false: the full
   record stays searchable, but only a curated few reach every prompt. Measured
   2026-08-30, the uncurated call returned 51 items at equal weight, so a
   question about a book arrived with a calorie tracking app attached.';

CREATE INDEX IF NOT EXISTS profile_entries_show_to_agent_idx
  ON public.profile_entries (user_id) WHERE show_to_agent;

-- Seed the curated set Michael chose on 2026-08-31: identity (full name,
-- gender, location), work (the book, the product, the business), and contact
-- (primary website, email). Deliberately NOT tooling.
--
-- Matched on label so it survives a reordering. Everything left out stays
-- fully searchable through get_user_profile detail:"full" and through
-- search_brain; it just stops arriving unasked.
--
-- `contact_id IS NULL` is the important half and it is easy to miss.
-- profile_entries holds rows for CONTACTS as well as for the owner, so the
-- same labels ("Full name", "Gender", "Email") exist many times over. Without
-- this clause the first run of it flagged 17 rows instead of 8, six of them
-- other people's names. get_user_profile filters on contact_id itself so
-- nothing leaked, but the flag was wrong on rows another reader would trust.
UPDATE public.profile_entries
SET show_to_agent = true
WHERE contact_id IS NULL
  AND lower(btrim(label)) IN (
    'full name', 'gender', 'location',
    'book', 'product', 'limited partner',
    'website', 'email'
  );
