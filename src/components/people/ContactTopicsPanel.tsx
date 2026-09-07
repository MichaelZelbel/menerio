import { useRef, useState } from 'react';
import { MessageCircle, Plus, RotateCcw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useContactTopics, useContactTopicCommand } from '@/hooks/useContactTopics';
import { compareContactTopics, topicPriorityLabels, topicStatusLabels, type ContactTopic, type TopicCommand, type TopicCommandResult, type TopicPriority, type TopicStatus } from '@/lib/contact-topics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ContactTopicRow, topicSelectClass } from './ContactTopicRow';

export function ContactTopicsPanel({ contactId, contactName }: { contactId: string; contactName: string }) {
  const { user } = useAuth();
  return user ? <TopicsPanel key={`${user.id}:${contactId}`} contactId={contactId} contactName={contactName} /> : null;
}

function TopicsPanel({ contactId, contactName }: { contactId: string; contactName: string }) {
  const query = useContactTopics(contactId);
  const mutation = useContactTopicCommand(contactId);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TopicPriority>('normal');
  const [recurring, setRecurring] = useState(false);
  const [status, setStatus] = useState<TopicStatus>('active');
  const [expanded, setExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [failure, setFailure] = useState('');
  const [failedCommand, setFailedCommand] = useState<TopicCommand | null>(null);
  const [undo, setUndo] = useState<TopicCommandResult | null>(null);
  const [editingTopics, setEditingTopics] = useState(new Map<string, ContactTopic>());
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const topics = (query.data ?? []).filter(topic => topic.status === status).sort(status === 'completed'
    ? (a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '') || b.id.localeCompare(a.id)
    : compareContactTopics);
  // Keep open editors mounted when refresh changes priority, status or ownership.
  const visibleTopics = expanded ? [...topics] : topics.slice(0, 5);
  for (const [id, snapshot] of editingTopics) {
    if (!visibleTopics.some(topic => topic.id === id)) visibleTopics.push(query.data?.find(topic => topic.id === id) ?? snapshot);
  }
  const run = async (command: TopicCommand) => {
    if (submitting.current) return false;
    submitting.current = true;
    setFailure('');
    setAnnouncement('');
    try {
      const result = await mutation.mutateAsync(command);
      setFailedCommand(null);
      setUndo(command.action === 'undo' ? null : result);
      const message = command.action === 'discuss'
        ? result.topic.status === 'active' ? 'Discussion saved. This recurring topic stays on your list.' : 'Discussion saved. Topic moved to Discussed.'
        : command.action === 'undo' ? 'Change undone.' : command.action === 'create' ? 'Topic added.' : command.action === 'archive' ? 'Topic archived.' : command.action === 'reopen' ? 'Topic reopened.' : 'Topic saved.';
      setAnnouncement(message);
      if (command.action !== 'create') heading.current?.focus();
      return true;
    } catch (error) {
      setFailedCommand(command);
      const code = (error as { code?: string })?.code;
      const rejected = !navigator.onLine || (code && /^(22|23|40|42|PGRST)/.test(code));
      const detail = code === '40001' ? 'This topic changed elsewhere. Review it before trying again.'
        : error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'Please try again.';
      setFailure(rejected ? `Not saved. ${detail}` : 'Save not confirmed. Retry safely. The connection may have failed after the change reached the server.');
      return false;
    } finally { submitting.current = false; }
  };
  return <Card className="mb-6 min-w-0 overflow-hidden" aria-label={`Topics to talk about with ${contactName}`}>
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <MessageCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0"><h2 ref={heading} tabIndex={-1} className="text-base font-semibold tracking-tight">Topics to talk about</h2>
          <p className="mt-1 text-sm text-muted-foreground">Keep a few things in mind for your next conversation.</p></div>
      </div>
      <form className="space-y-2" onSubmit={async e => {
        e.preventDefault();
        if (!title.trim()) return;
        if (await run({ action: 'create', contact_id: contactId, title: title.trim(), priority, mode: recurring ? 'recurring' : 'one_off' })) {
          setTitle(''); setPriority('normal'); setRecurring(false); setStatus('active'); input.current?.focus();
        }
      }}>
        <label htmlFor={`topic-title-${contactId}`} className="sr-only">New topic</label>
        <Input ref={input} id={`topic-title-${contactId}`} placeholder="What would you like to talk about?" maxLength={300} required className="min-h-11" value={title} disabled={mutation.isPending} onChange={e => setTitle(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="New topic priority" className={topicSelectClass} value={priority} disabled={mutation.isPending} onChange={e => setPriority(e.target.value as TopicPriority)}>
            {Object.entries(topicPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label} priority</option>)}
          </select>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={recurring} disabled={mutation.isPending} onChange={e => setRecurring(e.target.checked)} />Recurring</label>
          <Button className="min-h-11 gap-1.5 sm:ml-auto" disabled={mutation.isPending || !title.trim()}><Plus aria-hidden="true" className="h-4 w-4" />{mutation.isPending ? 'Saving...' : 'Add topic'}</Button>
        </div>
      </form>
      {failure && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{failure} Your input is still here.</p>}
      {failedCommand?.action === 'update' && <p className="text-sm text-muted-foreground">Use Save in the editor to retry the draft shown there.</p>}
      {failedCommand && failedCommand.action !== 'create' && failedCommand.action !== 'update' && <Button variant="outline" className="min-h-11" disabled={mutation.isPending} onClick={() => void run(failedCommand)}>Retry unsaved change</Button>}
      {(!query.online || (query.isError && query.data)) && <p role="status" className="text-sm text-muted-foreground">{!query.online ? 'Offline. Showing the last loaded topics. Changes need a connection.' : 'Topics may be out of date. Refresh to try again.'}</p>}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2" aria-label="Topic views">
        {(Object.keys(topicStatusLabels) as TopicStatus[]).map(value => <Button key={value} variant={status === value ? 'secondary' : 'ghost'} className="min-h-11" aria-pressed={status === value} onClick={() => { setStatus(value); setExpanded(false); }}>{value === 'active' ? 'To discuss' : topicStatusLabels[value]} <span className="ml-1.5 text-xs text-muted-foreground">{(query.data ?? []).filter(t => t.status === value).length}</span></Button>)}
      </div>
      {query.isPending ? <p role="status" className="py-4 text-sm text-muted-foreground">Loading topics...</p> : query.isError && !query.data ? <p role="alert" className="text-sm text-destructive">Topics could not be loaded.</p> : visibleTopics.length === 0 ? <p className="py-4 text-sm text-muted-foreground">{status === 'active' ? 'No topics yet. Add something you want to bring up.' : status === 'completed' ? 'Discussed topics will appear here.' : 'Archived topics will appear here.'}</p> : <ul className="divide-y divide-border">{visibleTopics.map(topic => <ContactTopicRow key={topic.id} topic={topic} pending={mutation.isPending} onCommand={run} onEditingChange={editing => setEditingTopics(current => {
        const next = new Map(current);
        if (editing) next.set(topic.id, topic); else next.delete(topic.id);
        return next;
      })} />)}</ul>}
      {topics.length > 5 && <Button variant="outline" className="min-h-11 w-full" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `Show all ${topics.length} topics`}</Button>}
      {query.isError && <Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>Refresh topics</Button>}
      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">{announcement}</div>
      {undo && <Button variant="outline" className="min-h-11 gap-1.5" disabled={mutation.isPending} onClick={() => void run({ action: 'undo', topic_id: undo.topic.id, expected_version: undo.topic.version, event_id: undo.event_id })}><RotateCcw aria-hidden="true" className="h-4 w-4" />Undo last change</Button>}
    </div>
  </Card>;
}
