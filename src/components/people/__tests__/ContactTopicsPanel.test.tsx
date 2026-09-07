import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContactTopic, TopicCommand } from '@/lib/contact-topics';
import { ContactTopicsPanel } from '../ContactTopicsPanel';

const state = vi.hoisted(() => ({ rows: [] as ContactTopic[], commands: [] as TopicCommand[], fail: false, wait: null as Promise<void> | null, user: 'u1', previous: null as ContactTopic | null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: state.user } }) }));
vi.mock('@/hooks/useContactTopics', async () => {
  const { useState } = await import('react');
  return {
    useContactTopics: () => ({ data: state.rows, online: true, isPending: false, isError: false }),
    useContactTopicHistory: () => ({ data: [{ id: 'event', action: 'discuss', happened_at: '2026-09-07T10:00:00Z', after_state: { title: 'Original discussion wording' } }, { id: 'undo-event', action: 'undo', happened_at: '2026-09-07T11:00:00Z', after_state: { title: 'Restored topic' }, reverses_event_id: 'event' }], isPending: false, isError: false }),
    useContactTopicCommand: () => {
      const [isPending, setPending] = useState(false);
      return { isPending, mutateAsync: async (command: TopicCommand) => {
        setPending(true); state.commands.push(command);
        try {
          if (state.wait) await state.wait;
          if (state.fail) throw new Error('Connection lost');
          let topic: ContactTopic;
          if (command.action === 'create') {
            topic = { id: `new-${state.commands.length}`, user_id: 'u1', contact_id: command.contact_id, title: command.title, mode: command.mode ?? 'one_off', priority: command.priority ?? 'normal', status: 'active', version: 1, last_discussed_at: null, completed_at: null, archived_at: null, created_at: '2026-09-07', updated_at: '2026-09-07' };
            state.rows = [...state.rows, topic];
          } else {
            const existing = state.rows.find(row => row.id === command.topic_id)!;
            topic = { ...existing, version: existing.version + 1 };
            if (command.action === 'undo') topic = { ...state.previous!, version: topic.version };
            else {
              state.previous = existing;
              if (command.action === 'discuss') { topic.last_discussed_at = '2026-09-07T10:00:00Z'; if (topic.mode === 'one_off' || command.close_after) topic.status = 'completed'; }
              if (command.action === 'archive') topic.status = 'archived';
              if (command.action === 'reopen') topic.status = 'active';
              if (command.action === 'update') topic = { ...topic, ...command.patch };
            }
            state.rows = state.rows.map(row => row.id === topic.id ? topic : row);
          }
          return { topic, event_id: 'event', replayed: false };
        } finally { setPending(false); }
      } };
    },
  };
});
const makeTopic = (id: string, extras: Partial<ContactTopic> = {}): ContactTopic => ({ id, title: id, user_id: 'u1', contact_id: 'p1', mode: 'one_off', priority: 'normal', status: 'active', version: 1, created_at: '2026-09-07', updated_at: '2026-09-07', last_discussed_at: null, completed_at: null, archived_at: null, ...extras });
const panel = () => render(<ContactTopicsPanel contactId="p1" contactName="Alex" />);
const topicRow = (name: string) => screen.getByRole('listitem', { name });
beforeEach(() => { state.rows = []; state.commands = []; state.fail = false; state.wait = null; state.user = 'u1'; state.previous = null; });
afterEach(cleanup);

describe('topics panel', () => {
  it('shows completed topics newest first regardless of priority', () => {
    state.rows = [makeTopic('Older', { status: 'completed', priority: 'high', completed_at: '2026-09-06' }), makeTopic('Newest', { status: 'completed', priority: 'low', completed_at: '2026-09-07' })];
    panel(); fireEvent.click(screen.getByRole('button', { name: /^Discussed 2/ }));
    expect(screen.getAllByRole('listitem')[0]).toHaveAccessibleName('Newest');
  });
  it('shows five rows ordered by priority and expands the full list', () => {
    state.rows = Array.from({ length: 7 }, (_, i) => makeTopic(`Topic ${i}`, { priority: i === 6 ? 'high' : i === 0 ? 'low' : 'normal' }));
    panel();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(5); expect(rows[0]).toHaveAccessibleName('Topic 6');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 7 topics' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
  it('creates one-off normal-priority topics and keeps failed input visibly unsaved', async () => {
    panel(); const input = screen.getByRole('textbox', { name: 'New topic' });
    fireEvent.change(input, { target: { value: '  Next trip  ' } }); state.fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    await screen.findByRole('alert'); expect(input).toHaveValue('  Next trip  ');
    expect(screen.queryByText('Topic added.')).not.toBeInTheDocument();
    state.fail = false; fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    await screen.findByText('Topic added.');
    expect(state.commands.at(-1)).toEqual({ action: 'create', contact_id: 'p1', title: 'Next trip', mode: 'one_off', priority: 'normal' });
    expect(input).toHaveValue(''); expect(input).toHaveFocus();
  });
  it('completes one-off topics, preserves recurring topics, and shows history', async () => {
    state.rows = [makeTopic('One time'), makeTopic('Check in', { mode: 'recurring' })]; panel();
    fireEvent.click(within(topicRow('One time')).getByRole('checkbox', { name: 'Discussed: One time' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'One time' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Topics to talk about' })).toHaveFocus();
    fireEvent.click(within(topicRow('Check in')).getByRole('button', { name: 'Discussed today' }));
    await screen.findByText(/This recurring topic stays/);
    expect(topicRow('Check in')).toBeInTheDocument(); expect(screen.getByText(/Last discussed/)).toBeInTheDocument();
    fireEvent.click(within(topicRow('Check in')).getByRole('button', { name: 'History' }));
    expect(screen.getByRole('list', { name: 'Topic history' })).toBeInTheDocument();
    expect(screen.getByText('Original discussion wording')).toBeInTheDocument();
    expect(screen.getByText(/Discussed \(undone\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Discussed 1/ }));
    expect(topicRow('One time')).toBeInTheDocument();
    expect(within(topicRow('One time')).getByRole('checkbox')).toBeChecked();
    expect(within(topicRow('One time')).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });
  it('archives, reopens, and undoes the acknowledged latest change', async () => {
    state.rows = [makeTopic('Plan')]; panel();
    fireEvent.click(within(topicRow('Plan')).getByRole('button', { name: 'Archive' }));
    await screen.findByText('Topic archived.');
    fireEvent.click(screen.getByRole('button', { name: /^Archived 1/ }));
    fireEvent.click(within(topicRow('Plan')).getByRole('button', { name: 'Reopen' }));
    await screen.findByText('Topic reopened.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo last change' }));
    await screen.findByText('Change undone.'); expect(topicRow('Plan')).toBeInTheDocument();
    expect(state.commands.at(-1)).toMatchObject({ action: 'undo', topic_id: 'Plan', event_id: 'event', expected_version: 3 });
  });
  it('disables repeated submissions until acknowledgement', async () => {
    let release!: () => void; state.wait = new Promise(resolve => { release = resolve; }); panel();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pending topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.queryByText('Topic added.')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('textbox').closest('form')!); expect(state.commands).toHaveLength(1);
    await act(async () => release()); await screen.findByText('Topic added.');
  });
  it('resets drafts when the person or account changes', () => {
    const view = panel(); fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Private draft' } });
    view.rerender(<ContactTopicsPanel contactId="p2" contactName="Sam" />); expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Other draft' } });
    state.user = 'u2'; view.rerender(<ContactTopicsPanel contactId="p2" contactName="Sam" />); expect(screen.getByRole('textbox')).toHaveValue('');
  });
  it('edits title, priority, and repetition without losing failed edits', async () => {
    state.rows = [makeTopic('Original')]; panel();
    fireEvent.click(within(topicRow('Original')).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit topic title' }), { target: { value: 'Updated' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Edit priority' }), { target: { value: 'high' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Edit repetition' }), { target: { value: 'recurring' } });
    state.fail = true; fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await screen.findByRole('alert'); expect(screen.getByRole('textbox', { name: 'Edit topic title' })).toHaveValue('Updated');
    state.fail = false; fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await screen.findByText('Topic saved.'); expect(topicRow('Updated')).toHaveTextContent('High priority');
    expect(state.commands.at(-1)).toMatchObject({ action: 'update', expected_version: 1, patch: { title: 'Updated', priority: 'high', mode: 'recurring' } });
  });
  it('can finish a recurring topic explicitly', async () => {
    state.rows = [makeTopic('Ongoing', { mode: 'recurring' })]; panel();
    fireEvent.click(screen.getByRole('button', { name: 'Discuss and finish' }));
    await screen.findByText('Discussion saved. Topic moved to Discussed.');
    expect(state.commands.at(-1)).toMatchObject({ action: 'discuss', close_after: true });
  });
});
