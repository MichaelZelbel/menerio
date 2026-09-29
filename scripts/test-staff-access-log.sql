\set ON_ERROR_STOP on
-- Only a fresh disposable database; never run against an application database.
DO $$ BEGIN
 IF current_database() <> 'staff_access_log_test' THEN RAISE EXCEPTION 'staff_access_log_test only'; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('free','premium','premium_gift','admin');
CREATE TABLE public.user_roles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role public.app_role NOT NULL);
CREATE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
 $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='admin')$$;
CREATE TABLE public.ai_allowance_periods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, tokens int DEFAULT 0);
CREATE TABLE public.user_suspensions(user_id uuid PRIMARY KEY, suspended boolean DEFAULT false);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_allowance_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON public.user_roles FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
CREATE POLICY admin_all ON public.ai_allowance_periods FOR ALL TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.user_roles, public.ai_allowance_periods TO authenticated;
INSERT INTO public.user_roles(user_id,role) VALUES
 ('a0000000-0000-0000-0000-000000000001','admin'),
 ('b0000000-0000-0000-0000-000000000002','free');
\ir ../supabase/migrations/20261001100000_staff_access_log.sql

-- 1. The service role records; ids only.
SET ROLE service_role;
SELECT public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'system', 'moderation_review', 'c0000000-0000-0000-0000-000000000003');
DO $$BEGIN
 BEGIN PERFORM public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'system', 'Read the note: secret text'); RAISE EXCEPTION 'free text accepted as action';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN PERFORM public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'janitor', 'moderation_review'); RAISE EXCEPTION 'unknown actor kind accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;

-- 2. A browser user can neither write the log nor read the table.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','b0000000-0000-0000-0000-000000000002',false);
DO $$BEGIN
 BEGIN PERFORM public.record_staff_access('b0000000-0000-0000-0000-000000000002', NULL, 'system', 'fake_entry'); RAISE EXCEPTION 'browser wrote the log';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM private.staff_access_log; RAISE EXCEPTION 'log table exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.my_staff_access_log()) <> 1 THEN RAISE EXCEPTION 'owner does not see own entry'; END IF;
END $$;
RESET ROLE;

-- 3. An admin writing another user's billing row is logged by the trigger; writing their own is not.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',false);
INSERT INTO public.ai_allowance_periods(user_id,tokens) VALUES ('b0000000-0000-0000-0000-000000000002', 100);
INSERT INTO public.ai_allowance_periods(user_id,tokens) VALUES ('a0000000-0000-0000-0000-000000000001', 100);
UPDATE public.user_roles SET role='premium' WHERE user_id='b0000000-0000-0000-0000-000000000002';
DO $$BEGIN
 IF (SELECT count(*) FROM public.my_staff_access_log()) <> 0 THEN RAISE EXCEPTION 'admin sees entries that are not about them'; END IF;
END $$;
RESET ROLE;
DO $$BEGIN
 IF (SELECT count(*) FROM private.staff_access_log WHERE subject_user_id='b0000000-0000-0000-0000-000000000002' AND actor_kind='admin') <> 2 THEN RAISE EXCEPTION 'admin writes not logged'; END IF;
 IF (SELECT count(*) FROM private.staff_access_log WHERE subject_user_id='a0000000-0000-0000-0000-000000000001') <> 0 THEN RAISE EXCEPTION 'own write logged'; END IF;
END $$;

-- 4. Append-only, even for the table owner's roles.
DO $$BEGIN
 BEGIN UPDATE private.staff_access_log SET action='edited'; RAISE EXCEPTION 'log editable';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'staff_access_log is append-only' THEN RAISE; END IF; END;
 BEGIN DELETE FROM private.staff_access_log; RAISE EXCEPTION 'log deletable';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'staff_access_log is append-only' THEN RAISE; END IF; END;
END $$;
\echo 'staff access log: all assertions passed'
