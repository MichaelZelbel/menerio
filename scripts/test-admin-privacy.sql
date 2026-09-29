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
