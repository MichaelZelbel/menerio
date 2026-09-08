-- Run only in a fresh disposable contact_pagination_test database.
DO $$ BEGIN IF current_database() <> 'contact_pagination_test' THEN RAISE EXCEPTION 'Wrong database'; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, name text NOT NULL, aliases text[], merged_into uuid);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_contacts ON public.contacts TO authenticated USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.contacts TO authenticated;
