import { job } from '@mediahunter/contracts';

export type QueueJob = ReturnType<typeof job.parse>;
export type QueueFilter = 'active' | 'completed' | 'attention' | 'all';
export type QueueAction = 'pause' | 'retry' | 'cancel';

const activeStates = new Set<QueueJob['state']>(['queued', 'leased', 'downloading', 'paused']);

export function isActiveDownload(entry: QueueJob): boolean {
  return entry.purpose !== 'probe' && activeStates.has(entry.state);
}

export function queueStateLabel(entry: QueueJob): string {
  if (entry.purpose === 'probe' && entry.state === 'downloading') return 'Inspecting formats';
  if (entry.purpose === 'probe' && entry.state === 'completed') return 'Formats ready';
  switch (entry.state) {
    case 'queued': return 'Waiting in queue';
    case 'leased': return 'Agent starting';
    case 'downloading': return 'Downloading';
    case 'completed': return 'Downloaded';
    case 'failed': return 'Failed';
    case 'canceled': return 'Canceled';
    case 'paused': return 'Paused';
    case 'rescan_required': return 'Scan again';
  }
}

export function canApplyQueueAction(entry: QueueJob, action: QueueAction): boolean {
  if (action === 'pause') return ['queued', 'leased', 'downloading'].includes(entry.state);
  if (action === 'retry') return ['paused', 'failed'].includes(entry.state);
  return ['queued', 'leased', 'downloading', 'paused'].includes(entry.state);
}
