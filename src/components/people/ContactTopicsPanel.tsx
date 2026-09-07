import { useRef, useState } from 'react';
import { Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useContactTopics, useContactTopicCommand } from '@/hooks/useContactTopics';
import { compareContactTopics, topicPriorityLabels, topicStatusLabels, type ContactTopic, type TopicCommand, type TopicCommandResult, type TopicPriority, type TopicStatus } from '@/lib/contact-topics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { ContactTopicRow, topicSelectClass } from './ContactTopicRow';
type TopicView = TopicStatus | 'checklist';
const viewLabels: Record<TopicView, string> = { checklist: 'Checklist', active: 'To discuss', completed: topicStatusLabels.completed, archived: topicStatusLabels.archived };

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
  const [status, setStatus] = useState<TopicView>('checklist');
  const [expanded, setExpanded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [failure, setFailure] = useState('');
  const [failedCommand, setFailedCommand] = useState<TopicCommand | null>(null);
  const [undo, setUndo] = useState<TopicCommandResult | null>(null);
  const [editingTopics, setEditingTopics] = useState(new Map<string, ContactTopic>());
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const topics = (query.data ?? []).filter(topic => status === 'checklist' ? topic.status !== 'archived' : topic.status === status).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return a.status === 'completed' ? (b.completed_at ?? '').localeCompare(a.completed_at ?? '') || b.id.localeCompare(a.id) : compareContactTopics(a, b);
  });
  // Keep open editors mounted when refresh changes priority, status or ownership.
  const recentCompleted = status === 'checklist' ? topics.find(topic => topic.status === 'completed') : undefined;
  const activePreview = topics.filter(topic => topic.status === 'active').slice(0, 4);
  const preview = recentCompleted ? [...activePreview, ...topics.filter(topic => topic.status === 'completed').slice(0, 5 - activePreview.length)] : topics.slice(0, 5);
  const visibleTopics = expanded ? [...topics] : preview;
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
      const detail = code === '40001' ? 'This topic changed elsewhere. Cancel your edit, review the latest topic, then edit again.'
        : error instanceof Error ? error.message : (error as { message?: string })?.message ?? 'Please try again.';
      setFailure(rejected ? `Not saved. ${detail}` : 'Save not confirmed. Retry safely. The connection may have failed after the change reached the server.');
      return false;
    } finally { submitting.current = false; }
  };
  return <Card className="mb-5 min-w-0 overflow-hidden border-border/70 shadow-none" aria-label={`Topics to talk about with ${contactName}`}>
    <div className="px-4 py-3 sm:px-5">
      <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
        <h2 ref={heading} tabIndex={-1} className="min-w-0 text-sm font-semibold tracking-tight">Topics to talk about</h2>
        <select aria-label="Topic view" value={status} onChange={e => { setStatus(e.target.value as TopicView); setExpanded(false); }} className="min-h-11 max-w-[45%] shrink-0 rounded-md border-0 bg-transparent pl-2 pr-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {(Object.keys(viewLabels) as TopicView[]).map(value => <option key={value} value={value}>{viewLabels[value]} ({(query.data ?? []).filter(t => value === 'checklist' ? t.status !== 'archived' : t.status === value).length})</option>)}
        </select>
      </div>
      {(!query.online || (query.isError && query.data)) && <p role="status" className="pb-2 text-xs text-muted-foreground">{!query.online ? 'Offline. Showing the last loaded topics. Changes need a connection.' : 'Topics may be out of date. Refresh to try again.'}</p>}
      {query.isPending ? <p role="status" className="py-3 text-sm text-muted-foreground">Loading topics...</p> : query.isError && !query.data ? <p role="alert" className="py-3 text-sm text-destructive">Topics could not be loaded.</p> : visibleTopics.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{status === 'active' || status === 'checklist' ? 'Nothing to bring up yet.' : status === 'completed' ? 'No discussed topics yet.' : 'No archived topics.'}</p> : <ul>{visibleTopics.map(topic => <ContactTopicRow key={topic.id} topic={topic} pending={mutation.isPending} onCommand={run} onEditingChange={editing => setEditingTopics(current => {
        const next = new Map(current);
        if (editing) next.set(topic.id, topic); else next.delete(topic.id);
        return next;
      })} />)}</ul>}
      {topics.length > 5 && <Button variant="ghost" className="min-h-11 px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `Show all ${topics.length} topics`}</Button>}
      <form className="mt-1 border-t border-border/50 pt-1" onSubmit={async e => {
        e.preventDefault();
        if (!title.trim()) return;
        if (await run({ action: 'create', contact_id: contactId, title: title.trim(), priority, mode: recurring ? 'recurring' : 'one_off' })) {
          setTitle(''); setPriority('normal'); setRecurring(false); setStatus('checklist'); setOptionsOpen(false); input.current?.focus();
        }
      }}>
        <div className="flex min-w-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="h-11 w-11 -ml-3 shrink-0 text-muted-foreground" aria-label={mutation.isPending ? 'Saving...' : 'Add topic'} disabled={mutation.isPending || !title.trim()}><Plus aria-hidden="true" className="h-4 w-4" /></Button>
          <label htmlFor={`topic-title-${contactId}`} className="sr-only">New topic</label>
          <Input ref={input} id={`topic-title-${contactId}`} placeholder="Add a topic..." maxLength={300} required className="h-11 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" value={title} disabled={mutation.isPending} onChange={e => setTitle(e.target.value)} />
          <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground/70" aria-label="New topic options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}><SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" /></Button>
        </div>
        {optionsOpen && <div className="flex flex-wrap items-center gap-2 pb-2 pl-7">
          <select aria-label="New topic priority" className={topicSelectClass} value={priority} disabled={mutation.isPending} onChange={e => setPriority(e.target.value as TopicPriority)}>
            {Object.entries(topicPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label} priority</option>)}
          </select>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 px-1 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={recurring} disabled={mutation.isPending} onChange={e => setRecurring(e.target.checked)} />Recurring</label>
        </div>}
      </form>
      {failure && <p role="alert" className="mt-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive">{failure} Your input is still here.</p>}
      {failedCommand?.action === 'update' && <p className="mt-2 text-xs text-muted-foreground">Use Save in the editor to retry the draft shown there.</p>}
      {failedCommand && failedCommand.action !== 'create' && failedCommand.action !== 'update' && <Button variant="ghost" className="min-h-11 text-xs" disabled={mutation.isPending} onClick={() => void run(failedCommand)}>Retry unsaved change</Button>}
      {query.isError && <Button variant="ghost" className="min-h-11 text-xs" onClick={() => void query.refetch()}>Refresh topics</Button>}
      <div role="status" aria-live="polite" className={undo ? 'flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground' : 'sr-only'}><span>{announcement}</span>{undo && <Button variant="ghost" className="min-h-11 gap-1 px-1 text-xs" aria-label="Undo last change" disabled={mutation.isPending} onClick={() => void run({ action: 'undo', topic_id: undo.topic.id, expected_version: undo.topic.version, event_id: undo.event_id })}><RotateCcw aria-hidden="true" className="h-3 w-3" />Undo</Button>}</div>
    </div>
  </Card>;
}
