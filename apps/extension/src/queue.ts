import { job } from '@mediahunter/contracts';

export type QueueJob = ReturnType<typeof job.parse>;
export type QueueFilter = 'active' | 'completed' | 'attention' | 'all';
export type QueueAction = 'pause' | 'retry' | 'cancel';

const activeStates = new Set<QueueJob['state']>(['queued', 'leased', 'downloading', 'paused']);

export function isActiveDownload(entry: QueueJob): boolean {
  return entry.purpose !== 'probe' && activeStates.has(entry.state);
}

export function canApplyQueueAction(entry: QueueJob, action: QueueAction): boolean {
  if (action === 'pause') return ['queued', 'leased', 'downloading'].includes(entry.state);
  if (action === 'retry') return ['paused', 'failed'].includes(entry.state);
  return ['queued', 'leased', 'downloading', 'paused'].includes(entry.state);
}
