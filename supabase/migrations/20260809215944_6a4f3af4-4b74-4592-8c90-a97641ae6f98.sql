WITH target AS (
  SELECT * FROM public.contact_relationships WHERE id = '41a47ebb-5b92-43ae-96e8-a6d3f5ac2ac1'
), ins AS (
  INSERT INTO public.relationship_rejections (user_id, pair_key, rejected_label, reason)
  SELECT user_id,
         public.relationship_pair_key(user_id, source_type, source_id, target_type, target_id, coalesce(custom_label, label)),
         label,
         'User stated this relationship does not exist in reality'
  FROM target
  ON CONFLICT (user_id, pair_key) DO NOTHING
  RETURNING 1
)
DELETE FROM public.contact_relationships WHERE id = '41a47ebb-5b92-43ae-96e8-a6d3f5ac2ac1';