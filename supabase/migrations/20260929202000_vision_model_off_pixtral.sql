-- analyze-media.vision runs on Mistral's pixtral-12b-2409, which Mistral has
-- deprecated; its named replacement is Ministral 3 14B (ministral-14b-2512),
-- which also reads images. The code default in analyze-media and
-- _shared/llm-defaults.ts moved with this migration, but an enabled row in
-- llm_call_configs beats the code default, and the live row names the old
-- model, so the row has to move too.
--
-- Only a row still on the old model is touched: a model an admin picked
-- deliberately is left alone. Idempotent: a second run matches nothing.
-- The row's updated_at is kept current by trg_llm_call_configs_updated_at.

UPDATE public.llm_call_configs
   SET model = 'ministral-14b-2512'
 WHERE call_site = 'analyze-media.vision'
   AND provider = 'mistral'
   AND model = 'pixtral-12b-2409';
