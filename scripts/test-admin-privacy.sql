\set ON_ERROR_STOP on
-- Only a fresh disposable database; never run against an application database.
DO $$ BEGIN
 IF current_database() <> 'admin_privacy_test' THEN RAISE EXCEPTION 'admin_privacy_test only'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TYPE public.app_role AS ENUM ('free','premium','premium_gift','admin');
CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
 $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin')$$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, display_name text, avatar_url text, bio text, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.profiles, public.user_roles TO authenticated;
INSERT INTO public.user_roles(user_id,role) VALUES
 ('a0000000-0000-0000-0000-000000000001','admin'),
 ('b0000000-0000-0000-0000-000000000002','free'),
 ('c0000000-0000-0000-0000-000000000003','premium');
INSERT INTO public.profiles(id,display_name,bio,created_at) VALUES
 ('a0000000-0000-0000-0000-000000000001','Admin','admin bio', now() - interval '30 days'),
 ('b0000000-0000-0000-0000-000000000002','Bea','private bio', now() - interval '2 days'),
 ('c0000000-0000-0000-0000-000000000003','Cem 100%_sure','other bio', now() - interval '20 days');
CREATE TABLE public.note_chunks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, content text);
CREATE TABLE public.media_analysis(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, extracted_text text);
CREATE TABLE public.agent_instructions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, instruction text);
CREATE TABLE public.profile_views(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text);
CREATE TABLE public.activity_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, action text);
CREATE TABLE public.moderation_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, flagged_content text, result text DEFAULT 'cleared');
CREATE TABLE public.moderation_review_queue(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, item_id uuid NOT NULL, content_snapshot text, ai_reason text, status text DEFAULT 'pending');
-- The fact-store go-live (20260929090200) renamed profile_entries to
-- profile_entries_archive and the live admin rule moved with it. profile_entries
-- and profile_categories are deliberately absent here, to prove the missing-table guard.
CREATE TABLE public.profile_entries_archive(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, value text);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['note_chunks','media_analysis','agent_instructions','profile_views','profile_entries_archive'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY own ON public.%I FOR ALL TO authenticated USING (user_id = auth.uid())', t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
 END LOOP; END $$;
CREATE POLICY "Admins can view all note chunks" ON public.note_chunks FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view all media analysis" ON public.media_analysis FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view all agent instructions" ON public.agent_instructions FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view all profile views" ON public.profile_views FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view all profile entries" ON public.profile_entries_archive FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own events" ON public.activity_events FOR SELECT TO authenticated USING (actor_id = auth.uid() OR public.is_admin(auth.uid()));
GRANT SELECT ON public.activity_events TO authenticated;
ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_review_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view moderation events" ON public.moderation_events FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY "Admins can view review queue" ON public.moderation_review_queue FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT ON public.moderation_events, public.moderation_review_queue TO authenticated;
INSERT INTO public.note_chunks(user_id,content) VALUES ('b0000000-0000-0000-0000-000000000002','Bea private text'),('a0000000-0000-0000-0000-000000000001','Admin own text');
INSERT INTO public.media_analysis(user_id,extracted_text) VALUES ('b0000000-0000-0000-0000-000000000002','scan');
INSERT INTO public.agent_instructions(user_id,instruction) VALUES ('b0000000-0000-0000-0000-000000000002','be nice');
INSERT INTO public.profile_views(user_id,name) VALUES ('b0000000-0000-0000-0000-000000000002','view');
INSERT INTO public.activity_events(actor_id,action) VALUES ('b0000000-0000-0000-0000-000000000002','profile_update');
INSERT INTO public.moderation_events(user_id,flagged_content,result) VALUES ('b0000000-0000-0000-0000-000000000002','old copy','blocked');
INSERT INTO public.moderation_review_queue(user_id,item_id,content_snapshot,ai_reason) VALUES ('b0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000004','old copy','quotes the note');
INSERT INTO public.profile_entries_archive(user_id,value) VALUES ('b0000000-0000-0000-0000-000000000002','Bea archived entry');
\ir ../supabase/migrations/20261001100100_admin_directory_rpcs.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',false);
DO $$BEGIN
 IF (SELECT count(*) FROM public.admin_user_directory()) <> 3 THEN RAISE EXCEPTION 'directory incomplete'; END IF;
 IF (SELECT total_count FROM public.admin_user_directory(NULL, NULL, 1, 0)) <> 3 THEN RAISE EXCEPTION 'total_count wrong'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory('bea')) <> 1 THEN RAISE EXCEPTION 'search broken'; END IF;
 -- Only Cem's name contains a literal %; an unescaped pattern would match all three.
 IF (SELECT count(*) FROM public.admin_user_directory('%')) <> 1 THEN RAISE EXCEPTION 'search treats %% as a wildcard'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory('_')) <> 1 THEN RAISE EXCEPTION 'search treats _ as a wildcard'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory(NULL, 'premium')) <> 1 THEN RAISE EXCEPTION 'role filter broken'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory(NULL, NULL, 1000, 0)) <> 3 THEN RAISE EXCEPTION 'limit not clamped sanely'; END IF;
 IF (SELECT new_users_7d FROM public.admin_account_counts()) <> 1 THEN RAISE EXCEPTION 'week count wrong'; END IF;
 IF (SELECT paid_users FROM public.admin_account_counts()) <> 2 THEN RAISE EXCEPTION 'paid count wrong'; END IF;
 IF (SELECT display_name FROM public.admin_user_names(ARRAY['b0000000-0000-0000-0000-000000000002']::uuid[])) <> 'Bea' THEN RAISE EXCEPTION 'names broken'; END IF;
END $$;
-- The directory's columns are exactly these; no bio, no avatar.
DO $$BEGIN
 IF (SELECT string_agg(parameter_name, ',' ORDER BY ordinal_position) FROM information_schema.parameters
     WHERE specific_name LIKE 'admin_user_directory%' AND parameter_mode='OUT') <> 'id,display_name,created_at,role,total_count'
 THEN RAISE EXCEPTION 'directory columns changed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',false);
DO $$BEGIN
 BEGIN PERFORM public.admin_user_directory(); RAISE EXCEPTION 'non-admin read the directory'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_user_names(ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[]); RAISE EXCEPTION 'non-admin read names'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_account_counts(); RAISE EXCEPTION 'non-admin read counts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE anon;
DO $$BEGIN
 BEGIN PERFORM public.admin_account_counts(); RAISE EXCEPTION 'anon read counts'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
\echo 'admin directory: all assertions passed'

\ir ../supabase/migrations/20261001100300_remove_admin_content_reads.sql

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',false);
DO $$BEGIN
 IF (SELECT count(*) FROM public.note_chunks) <> 1 THEN RAISE EXCEPTION 'admin still reads others'' note chunks'; END IF;
 IF (SELECT count(*) FROM public.media_analysis) <> 0 THEN RAISE EXCEPTION 'admin still reads image text'; END IF;
 IF (SELECT count(*) FROM public.agent_instructions) <> 0 THEN RAISE EXCEPTION 'admin still reads agent instructions'; END IF;
 IF (SELECT count(*) FROM public.profile_views) <> 0 THEN RAISE EXCEPTION 'admin still reads profile views'; END IF;
 IF (SELECT count(*) FROM public.activity_events) <> 0 THEN RAISE EXCEPTION 'admin still reads activity'; END IF;
 IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'admin still reads every profile'; END IF;
 IF (SELECT count(*) FROM public.moderation_events) <> 1 THEN RAISE EXCEPTION 'moderation events lost'; END IF;
 IF (SELECT count(*) FROM public.moderation_events WHERE flagged_content IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'moderation copy kept'; END IF;
 IF (SELECT count(*) FROM public.moderation_review_queue WHERE content_snapshot IS NOT NULL OR ai_reason IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'queue copy kept'; END IF;
 IF (SELECT count(*) FROM public.admin_user_directory()) <> 3 THEN RAISE EXCEPTION 'directory broken by the drop'; END IF;
 -- The fact-store go-live renamed profile_entries to profile_entries_archive and
 -- carried the admin rule with it; the guarded drop must reach it by that name.
 IF (SELECT count(*) FROM public.profile_entries_archive) <> 0 THEN RAISE EXCEPTION 'admin still reads archived profile entries'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',false);
DO $$BEGIN
 IF (SELECT count(*) FROM public.note_chunks) <> 1 THEN RAISE EXCEPTION 'owner lost own chunks'; END IF;
 IF (SELECT count(*) FROM public.activity_events) <> 1 THEN RAISE EXCEPTION 'owner lost own activity'; END IF;
 IF (SELECT count(*) FROM public.profiles) <> 1 THEN RAISE EXCEPTION 'owner lost own profile'; END IF;
 IF (SELECT count(*) FROM public.profile_entries_archive) <> 1 THEN RAISE EXCEPTION 'owner lost own archived entries'; END IF;
END $$;
RESET ROLE;
DO $$BEGIN
 BEGIN INSERT INTO public.moderation_review_queue(user_id,item_id,content_snapshot) VALUES ('b0000000-0000-0000-0000-000000000002','d0000000-0000-0000-0000-000000000005','new copy');
  RAISE EXCEPTION 'a new copy was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN INSERT INTO public.moderation_events(user_id,flagged_content) VALUES ('b0000000-0000-0000-0000-000000000002','new copy');
  RAISE EXCEPTION 'a new event copy was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- The apply-time assertion refuses a leftover admin read rule, whatever its name.
CREATE TABLE public.sneaky(id int, user_id uuid);
CREATE POLICY "renamed admin read" ON public.sneaky FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
DO $$BEGIN
 BEGIN
  PERFORM private.assert_no_admin_content_reads();
  RAISE EXCEPTION 'assertion missed a renamed admin rule';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Admin read access left on user content:%' THEN RAISE; END IF; END;
END $$;
\echo 'admin privacy: all assertions passed'
