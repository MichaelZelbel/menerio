-- Connect a mission control without typing a key.
--
-- A mission control is a folder of files on someone's computer that their AI assistants
-- work from. Until now it reached Menerio with an API key the person made under
-- Settings, copied, and pasted into Mission Control. This adds the other way round: the
-- godspeed asks, the person confirms on a page, and Mission Control collects a key nobody
-- ever saw. The flow and its routes are in docs/ARCHITECTURE.md ("Connecting a
-- godspeed"); the edge function is mc-connect; the numbers it passes in here live
-- in _shared/mc-connect-protocol.ts.
--
-- Three new tables and two new columns. Nothing that exists changes:
--
--   godspeed_connections       one row per (account, godspeed). `generation` rises by one
--                         every time the same mission control is connected again.
--   godspeed_devices           which computers of that mission control have been in touch, and
--                         what each assistant on them last reported. Status
--                         only; a device is never a security boundary.
--   godspeed_connect_requests  the ten-minute request between "Mission Control asked" and
--                         "Mission Control collected its key".
--   godspeed_api_keys          gains godspeed_connection_id and generation, both NULL for
--                         every key that exists today and every key made by hand.
--
-- The rule the columns exist for is enforced in _shared/mc-auth.ts, the one
-- function in front of the MCP server and every mc-api-* function: a key WITH
-- a connection is accepted only while that connection is active and the key's
-- generation is the connection's. A key WITHOUT a connection is read exactly as
-- before.
--
-- Every state change that touches more than one row is a function below, so it
-- is one transaction, and the request row is locked while it is decided, so
-- five wrong guesses are five however many arrive at once. The same lesson as
-- 20260909120000_atomic_godspeed_api_rate_limit.sql. A caller-supplied id is never
-- authorization: each function is told who is acting (an account or a key) and
-- checks that the thing belongs to them.

-- 1. TABLES -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.godspeed_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Made once by Mission Control at its first connect. Not a secret.
  godspeed_id uuid NOT NULL,
  godspeed_name text NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  -- Stored because the person was asked; does nothing in step 1.
  documents boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT godspeed_connections_user_godspeed_unique UNIQUE (user_id, godspeed_id),
  -- Only so godspeed_api_keys can point at (id, user_id) together; see below.
  CONSTRAINT godspeed_connections_id_user_unique UNIQUE (id, user_id)
);

COMMENT ON TABLE public.godspeed_connections IS
  'One row per (account, godspeed). Written only by the godspeed_connect_* functions; the owner may read it.';

CREATE TABLE IF NOT EXISTS public.godspeed_devices (
  connection_id uuid NOT NULL REFERENCES public.godspeed_connections(id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  name text NOT NULL,
  -- { "claude-code": { "state": "working", "at": "2026-09-20T18:00:00Z" }, ... }
  clients jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_contact_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, device_id)
);

COMMENT ON TABLE public.godspeed_devices IS
  'Last contact per device of a connected mission control, and the state each assistant on it reported. Status only, never a security boundary.';

CREATE TABLE IF NOT EXISTS public.godspeed_connect_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  godspeed_id uuid NOT NULL,
  godspeed_name text NOT NULL,
  device_id uuid NOT NULL,
  device_name text NOT NULL,
  flow text NOT NULL CHECK (flow IN ('browser', 'device')),
  wants jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- base64url(sha256(verifier)). The verifier itself never reaches the database.
  code_challenge text NOT NULL,
  user_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'collected', 'expired')),
  wrong_codes integer NOT NULL DEFAULT 0,
  wrong_verifiers integer NOT NULL DEFAULT 0,
  last_poll_at timestamptz,
  -- A keyed hash of the caller's address, for the starts-per-hour limit.
  caller_hash text NOT NULL,
  -- The account that opened the request first. Nobody else may see or answer it.
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.godspeed_connections(id) ON DELETE CASCADE,
  generation integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

COMMENT ON TABLE public.godspeed_connect_requests IS
  'Short-lived requests of the connect-your-godspeed flow. Service role only: no policy, on purpose.';

CREATE INDEX IF NOT EXISTS idx_godspeed_connect_requests_caller
  ON public.godspeed_connect_requests (caller_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_godspeed_connect_requests_created
  ON public.godspeed_connect_requests (created_at);

ALTER TABLE public.godspeed_api_keys
  ADD COLUMN IF NOT EXISTS godspeed_connection_id uuid,
  ADD COLUMN IF NOT EXISTS generation integer;

COMMENT ON COLUMN public.godspeed_api_keys.godspeed_connection_id IS
  'Mission Control connection this key was minted for. NULL for a key made by hand, which is every key older than 2026-09-20.';
COMMENT ON COLUMN public.godspeed_api_keys.generation IS
  'The generation of the connection this key was minted for. The key stops working when the connection moves past it.';

DO $$
BEGIN
  -- (godspeed_connection_id, user_id) together, so a key can only ever point at a
  -- connection of its OWN account. godspeed_api_keys lets a signed-in person write
  -- their own rows; without this, someone who learned another account's
  -- connection id could attach a key of theirs to it and then end that
  -- connection through /disconnect. A NULL godspeed_connection_id is not checked at
  -- all (MATCH SIMPLE), which is what keeps every existing key untouched.
  -- CASCADE, never SET NULL: a key that lost its connection must not turn into
  -- a key that needs none.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'godspeed_api_keys_connection_owner_fk') THEN
    ALTER TABLE public.godspeed_api_keys
      ADD CONSTRAINT godspeed_api_keys_connection_owner_fk
      FOREIGN KEY (godspeed_connection_id, user_id)
      REFERENCES public.godspeed_connections (id, user_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'godspeed_api_keys_connection_has_generation') THEN
    ALTER TABLE public.godspeed_api_keys
      ADD CONSTRAINT godspeed_api_keys_connection_has_generation
      CHECK ((godspeed_connection_id IS NULL) = (generation IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_godspeed_api_keys_connection
  ON public.godspeed_api_keys (godspeed_connection_id) WHERE godspeed_connection_id IS NOT NULL;

-- 2. WHO MAY READ WHAT --------------------------------------------------------

ALTER TABLE public.godspeed_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.godspeed_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.godspeed_connect_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.godspeed_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.godspeed_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.godspeed_connect_requests FROM PUBLIC, anon, authenticated;

-- The Connected mission controls card in Settings reads these two directly. SELECT only:
-- every write goes through a function below.
GRANT SELECT ON TABLE public.godspeed_connections TO authenticated;
GRANT SELECT ON TABLE public.godspeed_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.godspeed_connections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.godspeed_devices TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.godspeed_connect_requests TO service_role;

DROP POLICY IF EXISTS "Owners can read their mission control connections" ON public.godspeed_connections;
CREATE POLICY "Owners can read their mission control connections"
  ON public.godspeed_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners can read their mission control devices" ON public.godspeed_devices;
CREATE POLICY "Owners can read their mission control devices"
  ON public.godspeed_devices FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.godspeed_connections c
    WHERE c.id = godspeed_devices.connection_id AND c.user_id = auth.uid()
  ));

-- godspeed_connect_requests: RLS on and no policy at all. anon and authenticated are
-- denied outright; the service role bypasses RLS.

-- 3. START --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.godspeed_connect_start(
  p_godspeed_id uuid,
  p_godspeed_name text,
  p_device_id uuid,
  p_device_name text,
  p_flow text,
  p_wants jsonb,
  p_code_challenge text,
  p_user_code text,
  p_caller_hash text,
  p_ttl_seconds integer,
  p_max_starts_per_hour integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recent integer;
  v_request public.godspeed_connect_requests;
BEGIN
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 1 OR p_max_starts_per_hour IS NULL OR p_max_starts_per_hour < 1 THEN
    RAISE EXCEPTION 'p_ttl_seconds and p_max_starts_per_hour must be positive integers' USING ERRCODE = '22023';
  END IF;
  IF p_caller_hash IS NULL OR length(p_caller_hash) = 0 THEN
    RAISE EXCEPTION 'p_caller_hash is required' USING ERRCODE = '22023';
  END IF;

  -- Count, decide and insert as one step per caller. Without the lock a burst
  -- from one address would all read the same count and all be let in.
  PERFORM pg_advisory_xact_lock(hashtextextended('godspeed_connect_start:' || p_caller_hash, 0));

  SELECT count(*) INTO v_recent
  FROM public.godspeed_connect_requests r
  WHERE r.caller_hash = p_caller_hash
    AND r.created_at > now() - interval '1 hour';

  IF v_recent >= p_max_starts_per_hour THEN
    RETURN jsonb_build_object('allowed', false);
  END IF;

  -- Requests are worth nothing a day later; clearing them here keeps the table
  -- a few rows without a scheduled job.
  DELETE FROM public.godspeed_connect_requests r WHERE r.created_at < now() - interval '1 day';

  INSERT INTO public.godspeed_connect_requests
    (godspeed_id, godspeed_name, device_id, device_name, flow, wants, code_challenge, user_code, caller_hash, expires_at)
  VALUES
    (p_godspeed_id, p_godspeed_name, p_device_id, p_device_name, p_flow, coalesce(p_wants, '{}'::jsonb),
     p_code_challenge, p_user_code, p_caller_hash, now() + make_interval(secs => p_ttl_seconds))
  RETURNING * INTO v_request;

  RETURN jsonb_build_object(
    'allowed', true,
    'request_id', v_request.id,
    'user_code', v_request.user_code,
    'expires_at', v_request.expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.godspeed_connect_start(uuid, text, uuid, text, text, jsonb, text, text, text, integer, integer) IS
  'Open a connect request, unless this caller address already opened its hourly share. Count and insert are one locked step.';

-- 4. THE APPROVAL PAGE --------------------------------------------------------

-- Lock the request and say whether this account may see and answer it. Shared by
-- the two functions below so "open to this account" means one thing.
--
-- The first account to open a request claims it. After that another account
-- gets the same "not found" as for a request that never existed, so a link that
-- leaked cannot be answered by whoever else holds it once its owner has looked.
CREATE OR REPLACE FUNCTION public.godspeed_connect_open_request(p_request_id uuid, p_user_id uuid)
RETURNS public.godspeed_connect_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.godspeed_connect_requests;
BEGIN
  IF p_request_id IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_request FROM public.godspeed_connect_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_request.status IN ('pending', 'approved') AND v_request.expires_at <= clock_timestamp() THEN
    UPDATE public.godspeed_connect_requests r SET status = 'expired' WHERE r.id = v_request.id;
    RETURN NULL;
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN NULL;
  END IF;

  IF v_request.user_id IS NOT NULL AND v_request.user_id <> p_user_id THEN
    RETURN NULL;
  END IF;

  IF v_request.user_id IS NULL THEN
    UPDATE public.godspeed_connect_requests r SET user_id = p_user_id WHERE r.id = v_request.id;
    v_request.user_id := p_user_id;
  END IF;

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.godspeed_connect_view(p_request_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.godspeed_connect_requests;
BEGIN
  v_request := public.godspeed_connect_open_request(p_request_id, p_user_id);
  IF v_request.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Nothing secret: no challenge, no counters, no caller hash.
  RETURN jsonb_build_object(
    'godspeed_name', v_request.godspeed_name,
    'device_name', v_request.device_name,
    'flow', v_request.flow,
    'wants', v_request.wants,
    'user_code', v_request.user_code,
    'status', v_request.status,
    'expires_at', v_request.expires_at,
    'reconnect', EXISTS (
      SELECT 1 FROM public.godspeed_connections c
      WHERE c.user_id = p_user_id AND c.godspeed_id = v_request.godspeed_id
    )
  );
END;
$$;

COMMENT ON FUNCTION public.godspeed_connect_view(uuid, uuid) IS
  'What the approval page shows for an open request, or NULL when it is unknown, expired, answered, or was opened by another account first.';

CREATE OR REPLACE FUNCTION public.godspeed_connect_decide(
  p_request_id uuid,
  p_user_id uuid,
  p_user_code text,
  p_approve boolean,
  p_documents boolean,
  p_max_wrong_codes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.godspeed_connect_requests;
  v_wrong integer;
  v_connection_id uuid;
  v_generation integer;
BEGIN
  IF p_max_wrong_codes IS NULL OR p_max_wrong_codes < 1 THEN
    RAISE EXCEPTION 'p_max_wrong_codes must be a positive integer' USING ERRCODE = '22023';
  END IF;

  v_request := public.godspeed_connect_open_request(p_request_id, p_user_id);
  IF v_request.id IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- The code is checked for a "no" as well as a "yes": whoever answers has to
  -- have seen the page Mission Control pointed at. Compared while the row is locked, so
  -- guesses sent together are still counted one by one.
  IF p_user_code IS NULL OR p_user_code <> v_request.user_code THEN
    v_wrong := v_request.wrong_codes + 1;
    IF v_wrong >= p_max_wrong_codes THEN
      UPDATE public.godspeed_connect_requests r SET wrong_codes = v_wrong, status = 'denied' WHERE r.id = v_request.id;
      RETURN jsonb_build_object('outcome', 'denied', 'reason', 'too_many_wrong_codes');
    END IF;
    UPDATE public.godspeed_connect_requests r SET wrong_codes = v_wrong WHERE r.id = v_request.id;
    RETURN jsonb_build_object('outcome', 'wrong_code', 'attempts_left', p_max_wrong_codes - v_wrong);
  END IF;

  IF p_approve IS NOT TRUE THEN
    UPDATE public.godspeed_connect_requests r SET status = 'denied' WHERE r.id = v_request.id;
    RETURN jsonb_build_object('outcome', 'denied', 'reason', 'declined');
  END IF;

  -- First time: generation 1. Again for the same godspeed: the generation rises, and
  -- a connection that had been ended is active again. Two approvals for one mission control
  -- arriving together queue on the unique index and get different generations.
  INSERT INTO public.godspeed_connections AS c (user_id, godspeed_id, godspeed_name, documents)
  VALUES (p_user_id, v_request.godspeed_id, v_request.godspeed_name, coalesce(p_documents, false))
  ON CONFLICT ON CONSTRAINT godspeed_connections_user_godspeed_unique DO UPDATE
    SET generation = c.generation + 1,
        status = 'active',
        godspeed_name = EXCLUDED.godspeed_name,
        documents = EXCLUDED.documents,
        approved_at = now(),
        revoked_at = NULL
  RETURNING c.id, c.generation INTO v_connection_id, v_generation;

  -- Every key of an older generation is switched off here, in the same
  -- transaction. mc-auth would refuse them on the generation alone; this makes
  -- the key list in Settings tell the same story.
  UPDATE public.godspeed_api_keys k
  SET is_active = false
  WHERE k.godspeed_connection_id = v_connection_id
    AND k.generation < v_generation
    AND k.is_active IS DISTINCT FROM false;

  UPDATE public.godspeed_connect_requests r
  SET status = 'approved', connection_id = v_connection_id, generation = v_generation
  WHERE r.id = v_request.id;

  RETURN jsonb_build_object(
    'outcome', 'approved',
    'connection_id', v_connection_id,
    'generation', v_generation
  );
END;
$$;

COMMENT ON FUNCTION public.godspeed_connect_decide(uuid, uuid, text, boolean, boolean, integer) IS
  'Answer a connect request as one transaction: count a wrong code, deny, or approve (create the connection or raise its generation, and switch off every key of an older generation).';

-- 5. COLLECT ------------------------------------------------------------------

-- The edge function mints the key and hands in only its hash and prefix, and
-- the challenge it computed from the verifier it was sent. The key and the
-- verifier never reach the database. A key minted for a poll that turns out not
-- to be collectable is simply dropped; it was never stored anywhere.
CREATE OR REPLACE FUNCTION public.godspeed_connect_collect(
  p_request_id uuid,
  p_computed_challenge text,
  p_device_id uuid,
  p_key_hash text,
  p_key_prefix text,
  p_scopes text[],
  p_min_poll_gap_ms integer,
  p_max_wrong_verifiers integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.godspeed_connect_requests;
  v_connection public.godspeed_connections;
  v_now timestamptz := clock_timestamp();
  v_wrong integer;
  v_key_id uuid;
BEGIN
  IF p_min_poll_gap_ms IS NULL OR p_min_poll_gap_ms < 0 OR p_max_wrong_verifiers IS NULL OR p_max_wrong_verifiers < 1 THEN
    RAISE EXCEPTION 'p_min_poll_gap_ms and p_max_wrong_verifiers must be set' USING ERRCODE = '22023';
  END IF;
  IF p_key_hash IS NULL OR p_key_prefix IS NULL OR p_scopes IS NULL OR cardinality(p_scopes) = 0 THEN
    RAISE EXCEPTION 'p_key_hash, p_key_prefix and p_scopes are required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request FROM public.godspeed_connect_requests r WHERE r.id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Unknown and long gone look the same to a godspeed: start again.
    RETURN jsonb_build_object('outcome', 'not_collectable', 'status', 'expired');
  END IF;

  -- Re-read the clock: waiting for the row lock can take longer than the gap.
  v_now := clock_timestamp();
  IF v_request.last_poll_at IS NOT NULL
     AND v_now - v_request.last_poll_at < make_interval(secs => p_min_poll_gap_ms / 1000.0) THEN
    RETURN jsonb_build_object('outcome', 'slow_down');
  END IF;
  UPDATE public.godspeed_connect_requests r SET last_poll_at = v_now WHERE r.id = v_request.id;

  IF v_request.status IN ('pending', 'approved') AND v_request.expires_at <= v_now THEN
    UPDATE public.godspeed_connect_requests r SET status = 'expired' WHERE r.id = v_request.id;
    v_request.status := 'expired';
  END IF;

  IF v_request.status IN ('expired', 'collected') THEN
    RETURN jsonb_build_object('outcome', 'not_collectable', 'status', v_request.status);
  END IF;

  -- The verifier is the only proof this caller is Mission Control that asked, so it is
  -- checked before anything about the request is given away, and a wrong one
  -- counts. The fifth ends the request for everybody, right verifier included.
  IF p_computed_challenge IS NULL OR p_computed_challenge <> v_request.code_challenge THEN
    v_wrong := v_request.wrong_verifiers + 1;
    UPDATE public.godspeed_connect_requests r
    SET wrong_verifiers = v_wrong,
        status = CASE WHEN v_wrong >= p_max_wrong_verifiers THEN 'expired' ELSE r.status END
    WHERE r.id = v_request.id;
    RETURN jsonb_build_object('outcome', 'invalid_grant');
  END IF;

  IF v_request.status <> 'approved' THEN
    RETURN jsonb_build_object('outcome', 'not_collectable', 'status', v_request.status);
  END IF;

  -- Approved. The connection may have moved on since: ended, or the same mission control
  -- approved again from another request. Then this approval is history.
  SELECT * INTO v_connection FROM public.godspeed_connections c
  WHERE c.id = v_request.connection_id AND c.user_id = v_request.user_id
  FOR UPDATE;
  IF NOT FOUND OR v_connection.status <> 'active' OR v_connection.generation <> v_request.generation THEN
    UPDATE public.godspeed_connect_requests r SET status = 'expired' WHERE r.id = v_request.id;
    RETURN jsonb_build_object('outcome', 'not_collectable', 'status', 'expired');
  END IF;

  INSERT INTO public.godspeed_api_keys (user_id, key_hash, key_prefix, name, scopes, godspeed_connection_id, generation)
  VALUES (v_connection.user_id, p_key_hash, p_key_prefix, 'Godspeed: ' || v_connection.godspeed_name,
          p_scopes, v_connection.id, v_connection.generation)
  RETURNING id INTO v_key_id;

  UPDATE public.godspeed_connect_requests r SET status = 'collected' WHERE r.id = v_request.id;

  -- The device that collects is the first one known. Its name is the one the
  -- person read on the approval page.
  INSERT INTO public.godspeed_devices AS d (connection_id, device_id, name)
  VALUES (v_connection.id, coalesce(p_device_id, v_request.device_id), v_request.device_name)
  ON CONFLICT ON CONSTRAINT godspeed_devices_pkey DO UPDATE
    SET name = EXCLUDED.name, last_contact_at = now();

  RETURN jsonb_build_object(
    'outcome', 'collected',
    'key_id', v_key_id,
    'user_id', v_connection.user_id,
    'connection_id', v_connection.id,
    'godspeed_id', v_connection.godspeed_id,
    'godspeed_name', v_connection.godspeed_name,
    'generation', v_connection.generation,
    'documents', v_connection.documents,
    'scopes', to_jsonb(p_scopes)
  );
END;
$$;

COMMENT ON FUNCTION public.godspeed_connect_collect(uuid, text, uuid, text, text, text[], integer, integer) IS
  'One poll of /token, decided under the request''s row lock: too soon, expired, wrong verifier (counted), not answered yet, or collected. Collecting stores the key hash and marks the request in the same transaction, so a key is handed over at most once.';

-- 6. STATUS -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.godspeed_connect_touch(
  p_key_id uuid,
  p_device_id uuid,
  p_device_name text,
  p_client text,
  p_client_state text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_connection public.godspeed_connections;
  v_clients jsonb := '{}'::jsonb;
BEGIN
  -- The key decides which connection this is about; the caller never names one.
  SELECT c.* INTO v_connection
  FROM public.godspeed_api_keys k
  JOIN public.godspeed_connections c ON c.id = k.godspeed_connection_id AND c.user_id = k.user_id
  WHERE k.id = p_key_id
    AND k.is_active
    AND c.status = 'active'
    AND c.generation = k.generation;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_device_id IS NOT NULL THEN
    IF p_client IS NOT NULL AND p_client_state IS NOT NULL THEN
      v_clients := jsonb_build_object(p_client, jsonb_build_object('state', p_client_state, 'at', now()));
    END IF;

    INSERT INTO public.godspeed_devices AS d (connection_id, device_id, name, clients)
    VALUES (v_connection.id, p_device_id, coalesce(p_device_name, 'Unnamed device'), v_clients)
    ON CONFLICT ON CONSTRAINT godspeed_devices_pkey DO UPDATE
      SET name = coalesce(p_device_name, d.name),
          clients = d.clients || EXCLUDED.clients,
          last_contact_at = now();
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_connection.user_id,
    'connection_id', v_connection.id,
    'godspeed_id', v_connection.godspeed_id,
    'godspeed_name', v_connection.godspeed_name,
    'generation', v_connection.generation,
    'documents', v_connection.documents,
    'devices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'device_id', d.device_id,
        'name', d.name,
        'last_contact_at', d.last_contact_at,
        'clients', d.clients
      ) ORDER BY d.last_contact_at DESC)
      FROM public.godspeed_devices d WHERE d.connection_id = v_connection.id
    ), '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.godspeed_connect_touch(uuid, uuid, text, text, text) IS
  'Record that a device of a connected mission control was in touch (and what one assistant on it reported), and return the connection with all its devices. NULL for a key that belongs to no live connection.';

-- 7. DISCONNECT ---------------------------------------------------------------

-- Two ways in, and exactly one of them per call: the account (from Settings,
-- naming the connection) or a key of the connection (from Mission Control). Either way
-- ownership is checked here, not assumed from the id.
CREATE OR REPLACE FUNCTION public.godspeed_connect_disconnect(
  p_user_id uuid,
  p_connection_id uuid,
  p_key_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key public.godspeed_api_keys;
  v_connection public.godspeed_connections;
BEGIN
  IF p_key_id IS NOT NULL THEN
    IF p_user_id IS NOT NULL OR p_connection_id IS NOT NULL THEN
      RAISE EXCEPTION 'pass a key, or an account and a connection, not both' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_key FROM public.godspeed_api_keys k WHERE k.id = p_key_id;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    -- A key made by hand belongs to no connection and is never touched here.
    IF v_key.godspeed_connection_id IS NULL THEN
      RETURN 'legacy_key';
    END IF;
    SELECT * INTO v_connection FROM public.godspeed_connections c
    WHERE c.id = v_key.godspeed_connection_id AND c.user_id = v_key.user_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
    -- A key of an older generation cannot end the connection that replaced it.
    IF v_connection.status = 'active'
       AND (v_key.is_active IS NOT TRUE OR v_key.generation <> v_connection.generation) THEN
      RETURN 'revoked';
    END IF;
  ELSE
    IF p_user_id IS NULL OR p_connection_id IS NULL THEN
      RAISE EXCEPTION 'pass a key, or an account and a connection' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_connection FROM public.godspeed_connections c
    WHERE c.id = p_connection_id AND c.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN 'not_found';
    END IF;
  END IF;

  -- Idempotent: ending an ended connection changes nothing, revoked_at included.
  UPDATE public.godspeed_connections c
  SET status = 'revoked', revoked_at = now()
  WHERE c.id = v_connection.id AND c.status <> 'revoked';

  UPDATE public.godspeed_api_keys k
  SET is_active = false
  WHERE k.godspeed_connection_id = v_connection.id
    AND k.is_active IS DISTINCT FROM false;

  RETURN 'disconnected';
END;
$$;

COMMENT ON FUNCTION public.godspeed_connect_disconnect(uuid, uuid, uuid) IS
  'End a mission control connection and switch off its keys, as one transaction. Called with an account and a connection id, or with a key of the connection. Keys that belong to no connection are never touched.';

-- 8. ONLY THE SERVICE ROLE CALLS THESE ----------------------------------------
--
-- mc-connect holds the service key. Left executable by anon or authenticated,
-- godspeed_connect_decide would let any signed-in account approve with a user id of
-- its choosing, and godspeed_connect_collect would store a key hash of the caller's.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.godspeed_connect_start(uuid, text, uuid, text, text, jsonb, text, text, text, integer, integer)',
    'public.godspeed_connect_open_request(uuid, uuid)',
    'public.godspeed_connect_view(uuid, uuid)',
    'public.godspeed_connect_decide(uuid, uuid, text, boolean, boolean, integer)',
    'public.godspeed_connect_collect(uuid, text, uuid, text, text, text[], integer, integer)',
    'public.godspeed_connect_touch(uuid, uuid, text, text, text)',
    'public.godspeed_connect_disconnect(uuid, uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
