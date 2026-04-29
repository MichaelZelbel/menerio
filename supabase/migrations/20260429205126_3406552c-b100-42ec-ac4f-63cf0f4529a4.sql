CREATE TABLE IF NOT EXISTS public.mcp_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_name text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary text,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own MCP call logs" ON public.mcp_call_logs;
CREATE POLICY "Users can view their own MCP call logs"
ON public.mcp_call_logs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own MCP call logs" ON public.mcp_call_logs;
CREATE POLICY "Users can create their own MCP call logs"
ON public.mcp_call_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_user_tool_created_at
ON public.mcp_call_logs (user_id, tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_user_created_at
ON public.mcp_call_logs (user_id, created_at DESC);