-- Minimal disposable baseline, not a production migration or a full Supabase stack.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'contact_topics_test' THEN RAISE EXCEPTION 'Disposable contact_topics_test only'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,name text NOT NULL,merged_into uuid REFERENCES public.contacts(id) ON DELETE SET NULL,merged_at timestamptz,ai_visibility text DEFAULT 'visible',is_sensitive boolean DEFAULT false);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_contacts ON public.contacts FOR ALL TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.contacts TO authenticated;
CREATE FUNCTION public.ai_can_see(_user_id uuid,_kind text,_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM public.contacts WHERE id=_id AND user_id=_user_id AND ai_visibility='visible') $$;
CREATE EXTENSION pgtap;
