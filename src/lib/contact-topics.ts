export type TopicPriority = 'high' | 'normal' | 'low';
export type TopicStatus = 'active' | 'completed' | 'archived';
export type TopicMode = 'one_off' | 'recurring';
export interface ContactTopic {
  id: string; user_id: string; contact_id: string; title: string;
  mode: TopicMode; priority: TopicPriority; status: TopicStatus; version: number;
  last_discussed_at: string | null; completed_at: string | null; archived_at: string | null;
  created_at: string; updated_at: string;
}
export type TopicCommand =
  | { action: 'create'; contact_id: string; title: string; mode?: TopicMode; priority?: TopicPriority }
  | { action: 'update'; topic_id: string; expected_version: number; patch: { title?: string; mode?: TopicMode; priority?: TopicPriority } }
  | { action: 'discuss'; topic_id: string; expected_version: number; discussed_at?: string; close_after?: boolean }
  | { action: 'archive' | 'reopen'; topic_id: string; expected_version: number }
  | { action: 'undo'; topic_id: string; expected_version: number; event_id: string };
export interface TopicCommandResult { topic: ContactTopic; event_id: string; replayed: boolean }
export interface ContactTopicEvent {
  id: string; user_id: string; topic_id: string; request_id: string; action: TopicCommand['action'] | 'reassign';
  request_hash: string; before_state: ContactTopic | null; after_state: ContactTopic;
  happened_at: string; created_at: string; reverses_event_id: string | null;
}
export const topicPriorityLabels: Record<TopicPriority, string> = { high: 'High', normal: 'Normal', low: 'Low' };
export const topicModeLabels: Record<TopicMode, string> = { one_off: 'One-off', recurring: 'Recurring' };
export const topicStatusLabels: Record<TopicStatus, string> = { active: 'Topics to talk about', completed: 'Discussed', archived: 'Archived' };
const priorityOrder: Record<TopicPriority, number> = { high: 0, normal: 1, low: 2 };
export function compareContactTopics(a: ContactTopic, b: ContactTopic): number {
  return priorityOrder[a.priority] - priorityOrder[b.priority] || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}
