-- Invented fixture for scripts/test-fact-store.mjs (docs/plans/one-fact-store.md, A5).
-- Nothing here is copied from production. Loaded into a database built from the
-- live schema by scripts/rehearsal/build-local-db.sh, before the migrations run.
--
-- Ids: users 1000…, contacts a000…, entities e000…, categories ca00…,
-- claims c000…, entries b000…, review items d000….

SET search_path = public, extensions;

INSERT INTO auth.users (id, email) VALUES
  ('10000000-0000-0000-0000-000000000001', 'owner@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'other@example.invalid');
INSERT INTO public.profiles (id) VALUES
  ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

INSERT INTO public.contacts (id, user_id, name, ai_visibility, is_sensitive) VALUES
  ('a0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Invented Alex', 'visible', false),
  ('a0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Invented Hidden', 'hidden', false),
  ('a0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Invented Private', 'visible', false),
  ('a0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Invented Selfcopy', 'visible', false),
  ('a0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Invented Merge One', 'visible', false),
  ('a0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Invented Merge Two', 'visible', false),
  ('a0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Invented Deleted', 'visible', false),
  ('a0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', 'Invented Other', 'visible', false);

INSERT INTO public.entities (id, user_id, name, ai_visibility, is_sensitive) VALUES
  ('e0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Invented Org', 'visible', false),
  ('e0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Invented Secret Org', 'hidden', false);

INSERT INTO public.profile_categories (id, user_id, contact_id, name, slug, visibility_scope) VALUES
  ('ca000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', NULL, 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', NULL, 'Location', 'location', 'all'),
  ('ca000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', NULL, 'Relationships', 'relationships', 'all'),
  ('ca000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', NULL, 'Professional', 'professional', 'all'),
  ('ca000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Hobbies', 'hobbies', 'all'),
  ('ca000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Professional', 'professional', 'all'),
  ('ca000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Food', 'food', 'all'),
  ('ca000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Location', 'location', 'all'),
  ('ca000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000031', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'Health', 'health', 'private'),
  ('ca000000-0000-0000-0000-000000000032', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000051', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000052', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'Health', 'health', 'private'),
  ('ca000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000071', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000081', '10000000-0000-0000-0000-000000000002', NULL, 'Identity', 'identity', 'all'),
  ('ca000000-0000-0000-0000-000000000082', '10000000-0000-0000-0000-000000000002', NULL, 'Vault', 'vault', 'private');

-- Claims before the switch. created_at is set so "earliest" is deterministic.
INSERT INTO public.claims (id, user_id, subject_type, subject_id, attribute, value, valid_from, valid_to, origin, evidence_quote, source_type, created_at) VALUES
  -- linked, equal; user_manual → preferred in step 3
  ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'self', NULL, 'language', 'German', '2020-01-01', NULL, 'user_manual', NULL, 'manual', '2026-01-01'),
  -- linked, words differ (typo on the claim)
  ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'self', NULL, 'city', 'Berln', '2021-01-01', NULL, 'ai_note', 'I moved to Berln last spring.', 'ai', '2026-01-02'),
  -- linked from a self entry, but about a contact (merged into self before)
  ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000004', 'employer', 'Acme', NULL, NULL, 'ai_note', 'Selfcopy works at Acme now.', 'ai', '2026-01-03'),
  -- linked to a closed claim (B4)
  ('c0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'job', 'Baker', '2020-01-01', '2023-01-01', 'ai_note', 'Alex used to be a baker.', 'ai', '2026-01-04'),
  -- an existing live value an unlinked entry folds into
  ('c0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'hobby', 'Chess', NULL, NULL, 'ai_note', 'Alex plays chess every Sunday.', 'ai', '2026-01-05'),
  -- a machine value a human entry folds into (becomes preferred)
  ('c0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'pet', 'rex', NULL, NULL, 'ai_note', 'Alex walks the dog rex daily.', 'ai', '2026-01-06'),
  -- duplicate live group (B8): c08 is earlier, c07 is user_manual and wins
  ('c0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'city', 'Paris', NULL, NULL, 'user_manual', NULL, 'manual', '2026-01-08'),
  ('c0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'city', 'paris ', NULL, NULL, 'ai_note', 'Alex lives in Paris now.', 'ai', '2026-01-07'),
  -- unshown, kept
  ('c0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'self', NULL, 'coffee', 'Espresso', NULL, NULL, 'ai_note', 'I only drink espresso.', 'ai', '2026-01-09'),
  -- unshown, dropped (fact_unshown_drop)
  ('c0000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'self', NULL, 'tea', 'Green', NULL, NULL, 'ai_note', 'I sometimes drink green tea.', 'ai', '2026-01-10'),
  -- unshown user_manual → preferred
  ('c0000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'email', 'alex@example.invalid', NULL, NULL, 'user_manual', NULL, 'manual', '2026-01-11'),
  -- entities
  ('c0000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'entity', 'e0000000-0000-0000-0000-000000000001', 'founded', '1999', NULL, NULL, 'menerio', NULL, 'ai', '2026-01-12'),
  ('c0000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'entity', 'e0000000-0000-0000-0000-000000000002', 'codename', 'Nightjar', NULL, NULL, 'menerio', NULL, 'ai', '2026-01-13'),
  -- current job, unshown, next to the closed one
  ('c0000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'job', 'Chef', '2023-01-01', NULL, 'ai_note', 'Alex is a chef these days.', 'ai', '2026-01-14'),
  -- the other account
  ('c0000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000002', 'self', NULL, 'language', 'French', NULL, NULL, 'user_manual', NULL, 'manual', '2026-01-15'),
  -- merge pair sharing a value (the human's copy is on Merge Two)
  ('c0000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000005', 'color', 'Blue', NULL, NULL, 'ai_note', 'Merge One loves the colour blue.', 'ai', '2026-01-16'),
  ('c0000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000006', 'color', 'blue', NULL, NULL, 'user_manual', NULL, 'manual', '2026-01-17'),
  -- unshown, deleted by the rules: a placeholder, a value already shown under another label, a machine fact without a source
  ('c0000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'self', NULL, 'mood', 'none', NULL, NULL, 'ai_note', 'I have no mood today.', 'ai', '2026-01-21'),
  ('c0000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'town', 'Paris', NULL, NULL, 'ai_note', 'Alex lives in Paris now.', 'ai', '2026-01-22'),
  ('c0000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000001', 'self', NULL, 'sport', 'Tennis', NULL, NULL, 'unverified', NULL, 'ai', '2026-01-23'),
  -- a preferred unverified legacy entry's claim
  ('c0000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'self', NULL, 'shoe-size', '44', NULL, NULL, 'unverified', NULL, 'ai', '2026-01-20');

-- Entries. Inserted with the entry triggers off, so legacy shapes survive
-- (a "none" value, an unverified row without a quote).
ALTER TABLE public.profile_entries DISABLE TRIGGER USER;
INSERT INTO public.profile_entries (id, user_id, contact_id, category_id, label, value, origin, rank, evidence_quote, derived_from_claim_id, is_pinned, show_to_agent, created_at) VALUES
  ('b0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', NULL, 'ca000000-0000-0000-0000-000000000001', 'Language', 'German', 'user_manual', 'preferred', NULL, 'c0000000-0000-0000-0000-000000000001', true, true, '2026-02-01'),
  ('b0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', NULL, 'ca000000-0000-0000-0000-000000000002', 'Hometown', 'Berlin', 'ai_note', 'normal', 'I moved to Berlin last spring.', 'c0000000-0000-0000-0000-000000000002', false, false, '2026-02-02'),
  ('b0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', NULL, 'ca000000-0000-0000-0000-000000000002', 'City', 'berlin', 'ai_note', 'normal', 'Berlin is home these days.', NULL, false, false, '2026-02-03'),
  ('b0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', NULL, 'ca000000-0000-0000-0000-000000000004', 'Employer', 'Acme', 'user_manual', 'preferred', NULL, 'c0000000-0000-0000-0000-000000000003', false, false, '2026-02-04'),
  ('b0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000013', 'Job', 'Baker', 'ai_note', 'normal', 'Alex used to be a baker.', 'c0000000-0000-0000-0000-000000000004', false, false, '2026-02-05'),
  ('b0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000014', 'Favourite food', 'Pasta', 'ai_note', 'normal', 'Alex cooks pasta for everyone.', NULL, true, false, '2026-02-06'),
  ('b0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000012', 'Hobby', 'chess', 'ai_note', 'normal', 'Chess club on Sundays for Alex.', NULL, false, false, '2026-02-07'),
  ('b0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000011', 'Pet', 'Rex', 'user_manual', 'preferred', NULL, NULL, false, false, '2026-02-08'),
  ('b0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000021', 'Nickname', 'Hidey', 'user_manual', 'preferred', NULL, NULL, false, false, '2026-02-09'),
  ('b0000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', NULL, 'ca000000-0000-0000-0000-000000000003', 'Relationship', 'Married to Kim', 'user_manual', 'preferred', NULL, NULL, false, false, '2026-02-10'),
  ('b0000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000011', 'Languages', 'German, English, French', 'review_queue', 'normal', NULL, NULL, false, false, '2026-02-11'),
  ('b0000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000012', 'Instrument', 'Piano', 'unverified', 'normal', NULL, NULL, false, false, '2026-02-12'),
  ('b0000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000011', 'Allergy', 'none', 'unverified', 'normal', NULL, NULL, false, false, '2026-02-13'),
  ('b0000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000031', 'Diagnosis', 'Asthma', 'user_manual', 'preferred', NULL, NULL, false, false, '2026-02-14'),
  ('b0000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'ca000000-0000-0000-0000-000000000032', 'Diagnosis', 'Hay fever', 'user_manual', 'preferred', NULL, NULL, false, true, '2026-02-15'),
  ('b0000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000015', 'City', 'Paris', 'ai_note', 'normal', 'Alex lives in Paris now.', 'c0000000-0000-0000-0000-000000000008', false, false, '2026-02-16'),
  ('b0000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000002', NULL, 'ca000000-0000-0000-0000-000000000081', 'Language', 'French', 'user_manual', 'preferred', NULL, 'c0000000-0000-0000-0000-000000000015', false, false, '2026-02-17'),
  ('b0000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'ca000000-0000-0000-0000-000000000051', 'Color', 'Blue', 'ai_note', 'normal', 'Merge One loves the colour blue.', 'c0000000-0000-0000-0000-000000000016', true, false, '2026-02-18'),
  ('b0000000-0000-0000-0000-000000000019', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 'ca000000-0000-0000-0000-000000000061', 'Color', 'blue', 'user_manual', 'preferred', NULL, 'c0000000-0000-0000-0000-000000000017', false, false, '2026-02-19'),
  ('b0000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000005', 'ca000000-0000-0000-0000-000000000052', 'Condition', 'Migraine', 'user_manual', 'preferred', NULL, NULL, false, false, '2026-02-20'),
  ('b0000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000007', 'ca000000-0000-0000-0000-000000000071', 'Height', '180 cm', 'user_manual', 'preferred', NULL, NULL, false, false, '2026-02-21'),
  ('b0000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', NULL, 'ca000000-0000-0000-0000-000000000001', 'Shoe size', '44', 'unverified', 'preferred', NULL, 'c0000000-0000-0000-0000-000000000020', false, false, '2026-02-22'),
  ('b0000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000002', NULL, 'ca000000-0000-0000-0000-000000000082', 'Secret', 'Hidden thing', 'user_manual', 'preferred', NULL, NULL, false, false, '2026-02-23');
ALTER TABLE public.profile_entries ENABLE TRIGGER USER;

INSERT INTO public.contact_relationships (user_id, source_type, source_id, target_type, target_id, label, origin, rank)
VALUES ('10000000-0000-0000-0000-000000000001', 'contact', 'a0000000-0000-0000-0000-000000000001', 'contact',
        'a0000000-0000-0000-0000-000000000002', 'friend', 'user_manual', 'preferred');

INSERT INTO public.ai_suggestion_suppressions (user_id, suggestion_type, normalized_value, suppression_key) VALUES
  ('10000000-0000-0000-0000-000000000001', 'add_profile_entry', 'old value', 'legacy:key:1'),
  ('10000000-0000-0000-0000-000000000001', 'claim', 'height', 'contact:a0000000-0000-0000-0000-000000000007:height:170 cm');

INSERT INTO public.review_queue (id, user_id, suggestion_type, title, status, target_entity_type, target_entity_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'add_profile_entry', 'r1', 'auto_applied_unreviewed', 'profile_entry', 'b0000000-0000-0000-0000-000000000006'),
  ('d0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'add_profile_entry', 'r2', 'auto_applied_unreviewed', 'profile_entry', 'b0000000-0000-0000-0000-000000000007'),
  ('d0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'add_profile_entry', 'r3', 'kept', 'profile_entry', 'b0000000-0000-0000-0000-0000000000ff'),
  ('d0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'add_profile_entry', 'r4', 'pending_review', 'profile_entry', NULL),
  ('d0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'normalize_profile_entry', 'r5', 'pending_review', 'profile_entry', NULL),
  ('d0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'add_contact', 'r6', 'pending_review', 'contact', 'a0000000-0000-0000-0000-000000000001');

INSERT INTO public.fact_unshown_drop (claim_id) VALUES ('c0000000-0000-0000-0000-000000000010');
