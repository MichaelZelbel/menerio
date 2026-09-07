import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { broadcastInvalidation } from '@/lib/query-sync';
import { compareContactTopics, type ContactTopic, type ContactTopicEvent, type TopicCommand, type TopicCommandResult, type TopicStatus } from '@/lib/contact-topics';

const db = supabase as SupabaseClient;
export function useContactTopics(contactId: string, status: TopicStatus | 'all' = 'all') {
  const { user } = useAuth();
  const userId = user?.id;
  const qc = useQueryClient();
  const [online, setOnline] = useState(() => navigator.onLine);
  const query = useQuery({
    queryKey: ['contact-topics', user?.id, contactId, { status }],
    enabled: !!user && !!contactId,
    persister: undefined,
    staleTime: 0,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: false,
    queryFn: async ({ signal }) => {
      const rows: ContactTopic[] = [];
      const pageSize = 200;
      for (let offset = 0; ; offset += pageSize) {
        let request = db.from('contact_topics').select('*').eq('user_id', user!.id).eq('contact_id', contactId);
        if (status !== 'all') request = request.eq('status', status);
        const { data, error } = await request.order('id').range(offset, offset + pageSize - 1).abortSignal(signal);
        if (error) throw error;
        rows.push(...data as ContactTopic[]);
        if (data.length < pageSize) break;
      }
      return rows.sort(compareContactTopics);
    },
  });
  useEffect(() => {
    if (!userId || !contactId) return;
    const refresh = () => {
      void qc.invalidateQueries({ queryKey: ['contact-topics', userId, contactId] });
      void qc.invalidateQueries({ queryKey: ['contact-topic-history', userId] });
    };
    const visibleRefresh = () => { if (document.visibilityState === 'visible') refresh(); };
    const connectivity = () => { setOnline(navigator.onLine); if (navigator.onLine) refresh(); };
    const channel = db.channel(`contact-topics:${userId}:${contactId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contact_topics', filter: `contact_id=eq.${contactId}` }, refresh)
      .subscribe((state) => { if (state === 'SUBSCRIBED') refresh(); });
    const timer = window.setInterval(visibleRefresh, 30_000);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', connectivity);
    window.addEventListener('offline', connectivity);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', connectivity);
      window.removeEventListener('offline', connectivity);
      document.removeEventListener('visibilitychange', visibleRefresh);
      void db.removeChannel(channel);
    };
  }, [userId, contactId, qc]);
  return { ...query, online };
}

export function useContactTopicHistory(topicId: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['contact-topic-history', user?.id, topicId], enabled: !!user && !!topicId,
    persister: undefined, staleTime: 0, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
    queryFn: async ({ signal }) => {
      const rows: ContactTopicEvent[] = [];
      const pageSize = 200;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await db.from('contact_topic_events').select('*')
          .eq('user_id', user!.id).eq('topic_id', topicId).order('created_at', { ascending: false })
          .order('id', { ascending: false }).range(offset, offset + pageSize - 1).abortSignal(signal);
        if (error) throw error;
        rows.push(...data as ContactTopicEvent[]);
        if (data.length < pageSize) break;
      }
      return rows;
    },
  });
}

export function useContactTopicCommand(contactId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  // A lost acknowledgement must replay the same command, never create a second event.
  const attempts = useRef(new Map<string, string>());
  return useMutation({
    networkMode: 'always', retry: false,
    mutationFn: async (command: TopicCommand) => {
      if (!user) throw new Error('Sign in to save a topic.');
      if (!navigator.onLine) throw new Error('You are offline. Your change has not been saved.');
      const signature = JSON.stringify([user.id, contactId, command]);
      const requestId = attempts.current.get(signature) ?? crypto.randomUUID();
      attempts.current.set(signature, requestId);
      const { data, error } = await db.rpc('apply_contact_topic_command', { p_request_id: requestId, p_command: command });
      if (error) throw error;
      attempts.current.delete(signature);
      return data as TopicCommandResult;
    },
    onSuccess: (result) => {
      const keys = [['contact-topics', result.topic.user_id], ['contact-topic-history', result.topic.user_id, result.topic.id]];
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
      broadcastInvalidation(keys);
    },
    onError: () => { void qc.invalidateQueries({ queryKey: ['contact-topics', user?.id, contactId] }); },
  });
}
