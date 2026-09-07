import { useContactTopicHistory } from '@/hooks/useContactTopics';

const labels: Record<string, string> = { create: 'Added', update: 'Edited', discuss: 'Discussed', archive: 'Archived', reopen: 'Reopened', undo: 'Change undone', reassign: 'Moved to this person' };
export function ContactTopicHistory({ topicId }: { topicId: string }) {
  const query = useContactTopicHistory(topicId);
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading history...</p>;
  if (query.isError && !query.data) return <p role="alert" className="text-sm text-destructive">History could not be loaded.</p>;
  const reversed = new Set(query.data.map(event => event.reverses_event_id).filter(Boolean));
  return <>
    {query.isError && <p role="status" className="text-sm text-muted-foreground">History may be out of date. Showing the last loaded events.</p>}
    <ol aria-label="Topic history" className="space-y-2 border-l-2 border-border pl-3 text-xs text-muted-foreground">
    {query.data.map(event => <li key={event.id} className="break-words">
      <span>{labels[event.action]}{reversed.has(event.id) ? ' (undone)' : ''} <time dateTime={event.happened_at}>{new Date(event.happened_at).toLocaleString()}</time></span>
      <p className="mt-1 text-foreground">{event.after_state.title}</p>
    </li>)}
    {query.data.length === 0 && <li>No history yet.</li>}
    </ol>
  </>;
}
