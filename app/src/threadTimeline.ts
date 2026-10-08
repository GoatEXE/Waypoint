import type { ActivityItem, CeoMessage, MessageDelivery, TaskRunRecord } from './api';

export type TimelineEntry =
  | { kind: 'chat'; at: string; message: CeoMessage }
  | { kind: 'run'; at: string; run: TaskRunRecord; live: ActivityItem[] | null }
  | { kind: 'peer'; at: string; message: MessageDelivery };

export interface TaskThreadExtras {
  seatId: string | null;
  runs: TaskRunRecord[];
  live: { runId: string; items: ActivityItem[] } | null;
  messages: MessageDelivery[];
}

export function buildTimeline(chat: CeoMessage[], extras: TaskThreadExtras | null): TimelineEntry[] {
  const entries: TimelineEntry[] = chat.map(message => ({ kind: 'chat', at: message.at, message }));
  if (!extras) return entries;
  for (const run of extras.runs) {
    if (!run.startedAt || run.state === 'aborted') continue;
    entries.push({ kind: 'run', at: run.startedAt, run, live: extras.live?.runId === run.id ? extras.live.items : null });
  }
  for (const message of extras.messages) entries.push({ kind: 'peer', at: message.createdAt, message });
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.index - b.index)
    .map(({ entry }) => entry);
}

export function generalThreadMessages(messages: MessageDelivery[]): MessageDelivery[] {
  return messages.filter(message => !message.taskId && (message.from === 'ceo' || message.to === 'ceo'));
}

export type DeliveryTone = 'ok' | 'err' | 'wait';

export function deliveryLabel(message: Pick<MessageDelivery, 'wake' | 'readAt'>): { label: string; tone: DeliveryTone } {
  const state = message.wake?.state;
  if (state === 'completed') return { label: 'answered', tone: 'ok' };
  if (state === 'running') return { label: 'running', tone: 'wait' };
  if (state === 'failed' || state === 'outcome_unknown') return { label: 'failed', tone: 'err' };
  if (state === 'suppressed') return { label: message.readAt ? 'read' : 'not delivered', tone: message.readAt ? 'ok' : 'err' };
  return { label: 'queued', tone: 'wait' };
}

export function addressLabel(address: string, ceoName: string): string {
  if (address === 'ceo') return ceoName;
  const seat = address.split('/')[1];
  return seat || address;
}
