-- Every staff or system action on someone else's account, so a user can see it.
-- Ids and a fixed action word only: the log must never become a copy of content.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.staff_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL,
  actor_user_id uuid,
  actor_kind text NOT NULL CHECK (actor_kind IN ('admin','system','shared_key')),
  action text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  note_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_access_log_subject_idx ON private.staff_access_log (subject_user_id, created_at DESC);
REVOKE ALL ON private.staff_access_log FROM PUBLIC, anon, authenticated;

-- Also used FOR EACH STATEMENT below (for TRUNCATE, which has no per-row
-- form): it only ever raises, so the same function works both ways.
CREATE FUNCTION private.staff_access_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff_access_log is append-only';
END $$;
CREATE TRIGGER staff_access_log_append_only
  BEFORE UPDATE OR DELETE ON private.staff_access_log
  FOR EACH ROW EXECUTE FUNCTION private.staff_access_log_append_only();
-- UPDATE and DELETE are blocked per row above; TRUNCATE bypasses row triggers
-- entirely, so it needs its own statement-level trigger with the same function.
CREATE TRIGGER staff_access_log_append_only_truncate
  BEFORE TRUNCATE ON private.staff_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.staff_access_log_append_only();

CREATE FUNCTION public.record_staff_access(
  p_subject uuid, p_actor uuid, p_actor_kind text, p_action text, p_note_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = private, public AS $$
  INSERT INTO private.staff_access_log (subject_user_id, actor_user_id, actor_kind, action, note_id)
  VALUES (p_subject, p_actor, p_actor_kind, p_action, p_note_id)
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.record_staff_access(uuid,uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_staff_access(uuid,uuid,text,text,uuid) TO service_role;

CREATE FUNCTION public.my_staff_access_log()
RETURNS TABLE (action text, actor_kind text, note_id uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, public AS $$
  SELECT l.action, l.actor_kind, l.note_id, l.created_at
  FROM private.staff_access_log l
  WHERE l.subject_user_id = auth.uid()
  ORDER BY l.created_at DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.my_staff_access_log() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_staff_access_log() TO authenticated;

-- Admin writes made straight from the Admin page (roles, credits, suspensions).
CREATE FUNCTION private.log_admin_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = private, public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_subject uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_subject := OLD.user_id; ELSE v_subject := NEW.user_id; END IF;
  IF v_actor IS NOT NULL AND v_subject IS DISTINCT FROM v_actor AND public.is_admin(v_actor) THEN
    INSERT INTO private.staff_access_log (subject_user_id, actor_user_id, actor_kind, action)
    VALUES (v_subject, v_actor, 'admin', lower(TG_TABLE_NAME || '_' || TG_OP));
  END IF;
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_roles','ai_allowance_periods','user_suspensions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS log_admin_write ON public.%I', t);
      EXECUTE format('CREATE TRIGGER log_admin_write AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.log_admin_write()', t);
    END IF;
  END LOOP;
END $$;
