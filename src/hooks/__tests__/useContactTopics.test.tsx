import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactTopics, useContactTopicCommand } from '../useContactTopics';

const state = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  rows: [] as Record<string, unknown>[], reads: [] as Record<string, unknown>[],
  listener: null as (() => void) | null, removed: vi.fn(), rpc: vi.fn(), broadcast: vi.fn(),
  delay: null as null | Promise<void>,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/lib/query-sync', () => ({ broadcastInvalidation: state.broadcast }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: state.rpc, removeChannel: state.removed,
  channel: () => {
    const channel = { on: (_type: string, _filter: unknown, callback: () => void) => { state.listener = callback; return channel; }, subscribe: () => channel };
    return channel;
  },
  from: () => {
    const filters: Record<string, unknown> = {};
    let start = 0; let end = 199;
    const query = { select: () => query, order: () => query, range: (from: number, to: number) => { start = from; end = to; return query; }, eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      abortSignal: async () => {
        state.reads.push({ ...filters });
        const data = state.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value)).slice(start, end + 1);
        if (state.delay) await state.delay;
        return { data, error: null };
      },
    }; return query;
  },
} }));
function row(id: string, user = 'u1', contact = 'p1') {
  return { id, user_id: user, contact_id: contact, priority: 'normal', status: 'active', created_at: '2026-09-07', title: id };
}
let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={qc}>{children}</QueryClientProvider>; }
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  state.user = { id: 'u1' }; state.rows = [row('first')]; state.reads = []; state.delay = null;
  vi.clearAllMocks(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => { cleanup(); qc.clear(); vi.useRealTimers(); });

describe('contact topic synchronization', () => {
  it('loads stable pages so a high priority topic beyond the first page is included', async () => {
    state.rows = Array.from({ length: 1001 }, (_, i) => ({ ...row(`topic-${i}`), priority: i === 1000 ? 'high' : 'normal' }));
    const hook = renderHook(() => useContactTopics('p1'), { wrapper });
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1001));
    expect(hook.result.current.data?.[0].id).toBe('topic-1000');
    expect(state.reads).toHaveLength(6);
  });
  it('refreshes an open profile on external writes, focus, and reconnect', async () => {
    const hook = renderHook(() => useContactTopics('p1'), { wrapper });
    await waitFor(() => expect(hook.result.current.data).toHaveLength(1));
    state.rows.push(row('external'));
    act(() => state.listener?.());
    await waitFor(() => expect(hook.result.current.data).toHaveLength(2));
    state.rows.push(row('missed'));
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(3));
    state.rows.push(row('focus'));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(hook.result.current.data).toHaveLength(4));
    hook.unmount(); expect(state.removed).toHaveBeenCalledOnce();
  });
  it('polls only visible pages and removes the timer on unmount', async () => {
    const hook = renderHook(() => useContactTopics('p1'), { wrapper });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    vi.useFakeTimers();
    hook.unmount();
    const second = renderHook(() => useContactTopics('p1'), { wrapper });
    await act(async () => { await Promise.resolve(); });
    const initial = state.reads.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(state.reads).toHaveLength(initial);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(state.reads.length).toBeGreaterThan(initial);
    second.unmount(); const end = state.reads.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(state.reads).toHaveLength(end);
  });
  it('separates accounts and people and never shows a late previous-person result', async () => {
    let release!: () => void;
    state.delay = new Promise<void>(resolve => { release = resolve; });
    const hook = renderHook(({ person }) => useContactTopics(person), { wrapper, initialProps: { person: 'p1' } });
    state.rows.push(row('second', 'u1', 'p2'), row('private', 'u2', 'p2'));
    state.delay = null;
    hook.rerender({ person: 'p2' });
    await waitFor(() => expect(hook.result.current.data?.[0].id).toBe('second'));
    await act(async () => release());
    expect(hook.result.current.data?.[0].id).toBe('second');
    state.user = { id: 'u2' }; hook.rerender({ person: 'p2' });
    await waitFor(() => expect(hook.result.current.data?.[0].id).toBe('private'));
    expect(state.reads).toContainEqual({ user_id: 'u2', contact_id: 'p2' });
    state.user = null; hook.rerender({ person: 'p2' });
    expect(hook.result.current.data).toBeUndefined();
  });
  it('reuses the request ID after a lost response and broadcasts only acknowledged saves', async () => {
    state.rpc.mockResolvedValueOnce({ error: new Error('Connection lost') }).mockResolvedValueOnce({ data: { topic: row('created'), event_id: 'event', replayed: true }, error: null });
    const hook = renderHook(() => useContactTopicCommand('p1'), { wrapper });
    const command = { action: 'create' as const, contact_id: 'p1', title: 'Next trip' };
    await act(async () => { await expect(hook.result.current.mutateAsync(command)).rejects.toThrow('Connection lost'); });
    expect(state.broadcast).not.toHaveBeenCalled();
    await act(async () => { await hook.result.current.mutateAsync(command); });
    expect(state.rpc.mock.calls[0][1].p_request_id).toBe(state.rpc.mock.calls[1][1].p_request_id);
    expect(state.broadcast).toHaveBeenCalledOnce();
  });
  it('reports offline writes immediately instead of queueing them', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const hook = renderHook(() => useContactTopicCommand('p1'), { wrapper });
    await act(async () => { await expect(hook.result.current.mutateAsync({ action: 'create', contact_id: 'p1', title: 'Unsaved' })).rejects.toThrow('offline'); });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
