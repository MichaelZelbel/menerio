BEGIN;
ALTER TABLE public.github_connections
 ADD COLUMN last_sync_attempt_at timestamptz,
 ADD COLUMN last_sync_error text,
 ADD COLUMN sync_lease_id uuid,
 ADD COLUMN sync_lease_until timestamptz;

-- Only server-verified contexts may acquire, renew or finish a connection run.
CREATE FUNCTION public.github_sync_lease(p_connection uuid,p_user uuid,p_lease uuid,p_action text,p_success boolean DEFAULT false,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE affected integer;
BEGIN
 IF p_action='acquire' THEN
  UPDATE public.github_connections SET sync_lease_id=p_lease,sync_lease_until=now()+interval '15 minutes',last_sync_attempt_at=now(),last_sync_error=NULL
  WHERE id=p_connection AND user_id=p_user AND (sync_lease_until IS NULL OR sync_lease_until<now());
 ELSIF p_action='renew' THEN
  UPDATE public.github_connections SET sync_lease_until=now()+interval '15 minutes'
  WHERE id=p_connection AND user_id=p_user AND sync_lease_id=p_lease AND sync_lease_until>now();
 ELSIF p_action='finish' THEN
  UPDATE public.github_connections SET sync_lease_id=NULL,sync_lease_until=NULL,
   last_sync_at=CASE WHEN p_success THEN now() ELSE last_sync_at END,
   last_sync_error=CASE WHEN p_success THEN NULL ELSE left(coalesce(p_error,'sync_failed'),100) END
  WHERE id=p_connection AND user_id=p_user AND sync_lease_id=p_lease AND sync_lease_until>now();
 ELSE RAISE EXCEPTION 'Unknown lease action';
 END IF;
 GET DIAGNOSTICS affected=ROW_COUNT;
 RETURN affected=1;
END $$;
REVOKE ALL ON FUNCTION public.github_sync_lease(uuid,uuid,uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.github_sync_lease(uuid,uuid,uuid,text,boolean,text) TO service_role;
COMMIT;
