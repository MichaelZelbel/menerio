import { useRef, useState } from 'react';
import { Archive, Check, History, MoreHorizontal, Pencil, Repeat, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
  const openingEditor = useRef(false);
  const base = { topic_id: topic.id, expected_version: topic.version };
  const startEditing = () => {
    openingEditor.current = true;
    setTitle(topic.title); setPriority(topic.priority); setMode(topic.mode);
    setEditVersion(topic.version); setEditing(true); onEditingChange?.(true);
  };
  return <li className="min-w-0" aria-label={topic.title}>
    {editing ? <form className="my-1 space-y-2 rounded-lg bg-muted/40 p-3" onSubmit={async e => {
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
    </form> : <div className="flex min-w-0 items-start gap-1">
      <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-start gap-2.5">
        <span className="flex h-11 w-5 shrink-0 items-center justify-center">
          <input type="checkbox" className="h-4 w-4 rounded border-input accent-primary" aria-label={`${topic.mode === 'recurring' ? 'Discussed today' : 'Discussed'}: ${topic.title}`} checked={topic.status === 'completed'} disabled={pending || topic.status === 'archived'} onChange={() => void onCommand({ action: topic.status === 'completed' ? 'reopen' : 'discuss', ...base })} />
        </span>
        <span className="min-w-0 py-3">
          <span className={`block break-words text-sm leading-5 ${topic.status === 'completed' ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'text-foreground'}`}>{topic.title}
            {topic.mode === 'recurring' && <span className="ml-1.5 inline-flex align-middle text-muted-foreground" title="Recurring"><Repeat aria-hidden="true" className="h-3 w-3" /><span className="sr-only">Recurring</span></span>}
            {topic.priority !== 'normal' && <span aria-label={`${topicPriorityLabels[topic.priority]} priority`} className="ml-2 inline-block align-middle text-[10px] font-medium text-muted-foreground no-underline">{topicPriorityLabels[topic.priority]}</span>}
            {topic.last_discussed_at && <span className="ml-2 inline-block align-middle text-[10px] text-muted-foreground" title={`Last discussed ${new Date(topic.last_discussed_at).toLocaleDateString()}`}><span className="sr-only">Last discussed </span><time dateTime={topic.last_discussed_at}>{new Date(topic.last_discussed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></span>}
          </span>
        </span>
      </label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground/70 hover:text-foreground" aria-label={`Topic options: ${topic.title}`} disabled={pending}><MoreHorizontal aria-hidden="true" className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52" onCloseAutoFocus={event => { if (openingEditor.current) { event.preventDefault(); openingEditor.current = false; } }}>
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{topicPriorityLabels[topic.priority]} priority · {topicModeLabels[topic.mode]}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={startEditing}><Pencil aria-hidden="true" className="h-4 w-4" />Edit</DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => setHistory(!history)}><History aria-hidden="true" className="h-4 w-4" />{history ? 'Hide history' : 'History'}</DropdownMenuItem>
          {topic.status === 'active' && topic.mode === 'recurring' && <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => void onCommand({ action: 'discuss', ...base, close_after: true })}><Check aria-hidden="true" className="h-4 w-4" />Discuss and finish</DropdownMenuItem>}
          {topic.status === 'active' ? <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => void onCommand({ action: 'archive', ...base })}><Archive aria-hidden="true" className="h-4 w-4" />Archive</DropdownMenuItem>
            : <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => void onCommand({ action: 'reopen', ...base })}><RotateCcw aria-hidden="true" className="h-4 w-4" />Reopen</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>}
    {history && <div className="pb-3 pl-7"><ContactTopicHistory topicId={topic.id} /></div>}
  </li>;
}
