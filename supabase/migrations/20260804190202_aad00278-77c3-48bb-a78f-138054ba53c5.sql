
REVOKE SELECT ON public.gdrive_connections FROM authenticated;

GRANT SELECT (
  id, user_id, google_email, watch_folder_id, watch_folder_name,
  target_note_folder, sync_enabled, last_sync_at, last_error,
  channel_id, channel_expires_at, start_page_token, last_webhook_at,
  created_at, updated_at
) ON public.gdrive_connections TO authenticated;
