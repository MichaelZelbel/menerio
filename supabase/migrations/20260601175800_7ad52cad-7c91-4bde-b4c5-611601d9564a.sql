ALTER TABLE public.llm_call_configs DROP CONSTRAINT IF EXISTS llm_call_configs_provider_chk;
ALTER TABLE public.llm_call_configs ADD CONSTRAINT llm_call_configs_provider_chk
  CHECK (provider IN ('lovable','openrouter','openai','anthropic','gemini','mistral'));

DELETE FROM public.llm_call_configs
WHERE call_site = 'analyze-media.ocr_extraction';

INSERT INTO public.llm_call_configs (call_site, description, provider, model, system_prompt, enabled)
VALUES
  (
    'analyze-media.ocr',
    'Mistral OCR for PDFs and scanned images. Uses POST /v1/ocr — chat parameters (temperature, max_tokens, system_prompt) are ignored.',
    'mistral',
    'mistral-ocr-latest',
    NULL,
    true
  ),
  (
    'analyze-media.vision',
    'Vision model that describes uploaded images and embedded PDF images (caption, topics, content type).',
    'mistral',
    'pixtral-12b-2409',
    'Analyze this image. Return JSON:
- "description": 2-3 sentence description of what is shown (content, layout, notable visual elements).
- "topics": array of 1-5 short topic tags.
- "content_type": one of "screenshot", "photo", "diagram", "chart", "whiteboard", "document", "handwriting", "ui_mockup", "code", "other".
Only describe what''s actually visible.',
    true
  ),
  (
    'analyze-media.text',
    'Per-page summary of OCR-extracted markdown text plus embedded image descriptions.',
    'mistral',
    'mistral-small-latest',
    'You are summarizing a single page of a document. Given the page''s extracted markdown text (and any image descriptions), return JSON:
- "description": 2-3 sentence summary of what this page is about.
- "topics": array of 1-5 short topic tags.
- "content_type": one of "document", "slide", "form", "invoice", "report", "article", "diagram", "other".
Be specific and concise. Do not invent content.',
    true
  )
ON CONFLICT (call_site) DO UPDATE
SET
  description = EXCLUDED.description,
  provider = EXCLUDED.provider,
  model = EXCLUDED.model,
  system_prompt = EXCLUDED.system_prompt;