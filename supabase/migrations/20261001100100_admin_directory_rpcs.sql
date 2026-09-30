-- What the Admin page may know about accounts: name, sign-up date, role, counts.
-- Nothing a user wrote (bio, notes, facts). Replaces the admin read rule on
-- profiles, which migration 20261001100300 drops.
CREATE OR REPLACE FUNCTION public.admin_user_directory(
  p_search text DEFAULT NULL, p_role public.app_role DEFAULT NULL,
  p_limit int DEFAULT 25, p_offset int DEFAULT 0
) RETURNS TABLE (id uuid, display_name text, created_at timestamptz, role public.app_role, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pattern text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF p_search IS NOT NULL AND btrim(p_search) <> '' THEN
    v_pattern := '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;
  RETURN QUERY
  SELECT p.id, p.display_name, p.created_at, r.role, count(*) OVER ()
  FROM public.profiles p
  LEFT JOIN public.user_roles r ON r.user_id = p.id
  WHERE (v_pattern IS NULL OR p.display_name ILIKE v_pattern)
    AND (p_role IS NULL OR r.role = p_role)
  ORDER BY p.created_at DESC
  LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
  OFFSET greatest(coalesce(p_offset, 0), 0);
END $$;

CREATE OR REPLACE FUNCTION public.admin_user_names(p_ids uuid[])
RETURNS TABLE (id uuid, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p.id, p.display_name FROM public.profiles p WHERE p.id = ANY (p_ids[1:500]);
END $$;

CREATE OR REPLACE FUNCTION public.admin_account_counts()
RETURNS TABLE (total_users bigint, new_users_7d bigint, paid_users bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '7 days'),
    (SELECT count(*) FROM public.user_roles WHERE role IN ('premium','premium_gift','admin'));
END $$;

REVOKE ALL ON FUNCTION public.admin_user_directory(text, public.app_role, int, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_user_names(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_directory(text, public.app_role, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_names(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_counts() TO authenticated;
