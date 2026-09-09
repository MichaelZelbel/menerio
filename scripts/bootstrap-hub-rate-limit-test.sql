-- Disposable fixture only. Run against a fresh hub_rate_limit_test database.
DO $$BEGIN IF current_database()<>'hub_rate_limit_test' THEN RAISE EXCEPTION 'Wrong database'; END IF; END$$;
DO $$BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END$$;

-- The shape production actually has, confirmed against the live project:
-- window_start timestamptz, request_count integer, UNIQUE (key_id, window_start).
CREATE TABLE hub_api_keys(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
CREATE TABLE hub_api_usage(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES hub_api_keys(id),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT hub_api_usage_key_window_unique UNIQUE (key_id, window_start)
);

-- The check this replaced, kept so the test can show the difference rather than
-- just assert the new behaviour. Read, decide, write an ABSOLUTE value.
CREATE FUNCTION legacy_bump_usage(p_key_id uuid, p_window_start timestamptz, p_limit integer)
RETURNS TABLE (allowed boolean, request_count integer)
LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  SELECT u.request_count INTO v_count FROM hub_api_usage u
    WHERE u.key_id = p_key_id AND u.window_start = p_window_start;
  v_count := coalesce(v_count, 0);
  IF v_count >= p_limit THEN RETURN QUERY SELECT false, v_count; RETURN; END IF;
  INSERT INTO hub_api_usage (key_id, window_start, request_count)
  VALUES (p_key_id, p_window_start, v_count + 1)
  ON CONFLICT (key_id, window_start) DO UPDATE SET request_count = v_count + 1;
  RETURN QUERY SELECT true, v_count + 1;
END; $$;
