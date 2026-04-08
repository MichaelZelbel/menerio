
-- Drop trigger if it already exists (idempotent)
DROP TRIGGER IF EXISTS on_profile_created_notify_admin ON public.profiles;

-- Create the trigger function
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
  -- Get the user's email from auth.users
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

  -- Call the notify-admin Edge Function via pg_net
  PERFORM net.http_post(
    url := 'https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1/notify-admin',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := v_payload
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_admin_on_signup failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER on_profile_created_notify_admin
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admin_on_signup();
