-- The admin's "new user signup" e-mail has never been sent since 2026-05-14.
--
-- notify_admin_on_signup() (AFTER INSERT on profiles, 20260408044609) posts
-- to notify-admin with
--   'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
-- That setting does not exist on the hosted database (checked read-only on
-- 2026-09-29: current_setting(..., true) IS NULL), so the header carries no
-- key. notify-admin has required the service-role key since 2026-05-14 and
-- answers 401; the signup itself is unaffected because pg_net is fire and
-- forget. Seen live: three 401s from pg_net at 2026-09-28 23:42-23:43 UTC,
-- the go-live walk-through's throwaway sign-ups.
--
-- The database has exactly one authenticated way to reach an edge function:
-- internal.call_edge (20260826094000), which attaches the x-cron-key header
-- whose value lives only in internal.cron_secret. notify-admin now accepts
-- that key (isValidCronRequest) beside the service-role key that
-- delete-my-account sends. No other live function reads a supabase.* or
-- app.* setting (catalogue check, same day).
--
-- Idempotent: CREATE OR REPLACE of one function; the trigger is unchanged.
-- Deploy notify-admin before or with this migration: until then the new
-- header is refused exactly like the old one, so nothing gets worse.

CREATE OR REPLACE FUNCTION public.notify_admin_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email text;
  v_display_name text;
  v_payload jsonb;
BEGIN
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = NEW.id;

  v_display_name := COALESCE(NEW.display_name, 'Unknown');

  v_payload := jsonb_build_object(
    'eventType', 'signup',
    'userEmail', COALESCE(v_user_email, 'unknown@unknown.com'),
    'userId', NEW.id::text,
    'displayName', v_display_name
  );

  PERFORM internal.call_edge('notify-admin', v_payload);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- A notification must never block a sign-up.
  RAISE WARNING 'notify_admin_on_signup failed: %', SQLSTATE;
  RETURN NEW;
END;
$$;
