import { useState } from 'react';
import { Archive, Check, Flag, History, Pencil, Repeat, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ContactTopicHistory } from './ContactTopicHistory';
import { topicModeLabels, topicPriorityLabels, type ContactTopic, type TopicCommand, type TopicPriority, type TopicMode } from '@/lib/contact-topics';

export const topicSelectClass = 'min-h-11 max-w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
export function ContactTopicRow({ topic, pending, onCommand, onEditingChange }: { topic: ContactTopic; pending: boolean; onCommand: (command: TopicCommand) => Promise<boolean>; onEditingChange?: (editing: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [priority, setPriority] = useState(topic.priority);
  const [mode, setMode] = useState(topic.mode);
  const [editVersion, setEditVersion] = useState(topic.version);
  const base = { topic_id: topic.id, expected_version: topic.version };
  return <li className="min-w-0 space-y-3 py-4" aria-label={topic.title}>
    {editing ? <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      if (await onCommand({ action: 'update', topic_id: topic.id, expected_version: editVersion, patch: { title: title.trim(), priority, mode } })) { setEditing(false); onEditingChange?.(false); }
    }}>
      <Input aria-label="Edit topic title" autoFocus maxLength={300} required value={title} onChange={e => setTitle(e.target.value)} className="min-h-11" disabled={pending} />
      <div className="flex flex-wrap gap-2">
        <select aria-label="Edit priority" className={topicSelectClass} value={priority} onChange={e => setPriority(e.target.value as TopicPriority)} disabled={pending}>
          {Object.entries(topicPriorityLabels).map(([value, label]) => <option key={value} value={value}>{label} priority</option>)}
        </select>
        <select aria-label="Edit repetition" className={topicSelectClass} value={mode} onChange={e => setMode(e.target.value as TopicMode)} disabled={pending}>
          {Object.entries(topicModeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Button className="min-h-11" disabled={pending || !title.trim()}>Save</Button>
        <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={() => { setEditing(false); onEditingChange?.(false); }}>Cancel</Button>
      </div>
    </form> : <>
      <div className="flex min-w-0 items-start gap-2">
        {topic.mode === 'one_off' && topic.status !== 'archived' && <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center -my-2">
          <input type="checkbox" className="h-5 w-5 accent-primary" aria-label={`Discussed: ${topic.title}`} checked={topic.status === 'completed'} disabled={pending || topic.status === 'completed'} onChange={() => void onCommand({ action: 'discuss', ...base })} />
        </label>}
        <p className="min-w-0 break-words text-sm font-medium leading-relaxed">{topic.title}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Flag aria-hidden="true" className="h-3.5 w-3.5" />{topicPriorityLabels[topic.priority]} priority</span>
        <span className="inline-flex items-center gap-1"><Repeat aria-hidden="true" className="h-3.5 w-3.5" />{topicModeLabels[topic.mode]}</span>
        {topic.last_discussed_at && <span>Last discussed <time dateTime={topic.last_discussed_at}>{new Date(topic.last_discussed_at).toLocaleDateString()}</time></span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {topic.status === 'active' ? <>
          {topic.mode === 'recurring' && <Button variant="secondary" className="min-h-11 gap-1.5" disabled={pending} onClick={() => void onCommand({ action: 'discuss', ...base })}><Check aria-hidden="true" className="h-4 w-4" />Discussed today</Button>}
          {topic.mode === 'recurring' && <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => void onCommand({ action: 'discuss', ...base, close_after: true })}>Discuss and finish</Button>}
        </> : <Button variant="secondary" className="min-h-11 gap-1.5" disabled={pending} onClick={() => void onCommand({ action: 'reopen', ...base })}><RotateCcw aria-hidden="true" className="h-4 w-4" />Reopen</Button>}
        <Button variant="ghost" className="min-h-11 gap-1.5" disabled={pending} onClick={() => { setTitle(topic.title); setPriority(topic.priority); setMode(topic.mode); setEditVersion(topic.version); setEditing(true); onEditingChange?.(true); }}><Pencil aria-hidden="true" className="h-3.5 w-3.5" />Edit</Button>
        {topic.status === 'active' && <Button variant="ghost" className="min-h-11 gap-1.5" disabled={pending} onClick={() => void onCommand({ action: 'archive', ...base })}><Archive aria-hidden="true" className="h-3.5 w-3.5" />Archive</Button>}
        <Button variant="ghost" className="min-h-11 gap-1.5" aria-expanded={history} onClick={() => setHistory(!history)}><History aria-hidden="true" className="h-3.5 w-3.5" />History</Button>
      </div>
    </>}
    {history && <ContactTopicHistory topicId={topic.id} />}
  </li>;
}
