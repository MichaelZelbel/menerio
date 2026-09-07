import { createClient } from '@supabase/supabase-js';
export const SUPABASE_URL = import.meta.env.TOPIC_TEST_BACKEND;
export const SUPABASE_PUBLISHABLE_KEY = 'synthetic-browser';
export const owner = localStorage.getItem('topic-test-owner') ?? '74000000-0000-4000-8000-000000000001';
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${owner}` } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
