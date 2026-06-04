UPDATE public.llm_call_configs
SET model = 'deepseek/deepseek-v4-flash',
    updated_at = now()
WHERE provider = 'openrouter'
  AND model = 'openai/gpt-4o-mini';