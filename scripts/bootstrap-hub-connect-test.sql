-- Disposable fixture only. Run against a fresh hub_connect_test database, then
-- run scripts/test-hub-connect.mjs, which applies the real migration on top.
DO $$BEGIN IF current_database()<>'hub_connect_test' THEN RAISE EXCEPTION 'Wrong database'; END IF; END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END$$;

-- What Supabase does to every new table and function in public: all three API
-- roles get everything unless a migration takes it away. Without this the
-- REVOKEs in the migration would be tested against roles that had nothing to
-- lose.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- The two pieces of Supabase auth the migration and its policies lean on.
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;

-- hub_api_keys as production has it before this work: the table of
-- 20260402163226, its owner policy, and the cascade from auth.users that
-- 20260916120000 added.
CREATE TABLE public.hub_api_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  name text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{profile}',
  last_used_at timestamptz,
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_hub_api_keys_user ON public.hub_api_keys(user_id);
CREATE INDEX idx_hub_api_keys_hash ON public.hub_api_keys(key_hash);
ALTER TABLE public.hub_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own API keys" ON public.hub_api_keys
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
