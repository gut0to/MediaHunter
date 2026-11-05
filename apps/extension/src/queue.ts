import { job } from '@mediahunter/contracts';

export type QueueJob = ReturnType<typeof job.parse>;
export type QueueFilter = 'active' | 'completed' | 'attention' | 'all';
export type QueueAction = 'pause' | 'retry' | 'cancel';
export const queueFilters: QueueFilter[] = ['active', 'completed', 'attention', 'all'];

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

const errorDescriptions: Record<NonNullable<QueueJob['errorCode']>, string> = {
  DOWNLOAD_FAILED: 'The source did not finish sending the file.',
  HTTP_ERROR: 'The media server rejected the request.',
  EXPIRED_URL: 'The source link expired. Scan the page again.',
  UNSAFE_SOURCE: 'The source was blocked by the network safety check.',
  INVALID_MEDIA: 'The response was not a supported media file.',
  SIZE_LIMIT: 'The file exceeds the agent’s configured size limit.',
  DESTINATION_ERROR: 'The destination folder could not accept the file.',
  LEASE_LOST: 'The agent lost its download assignment. Retry the task.',
  TOOL_UNAVAILABLE: 'The optional media tool is unavailable.',
  PROTECTED_MEDIA: 'The source appears protected or encrypted.',
  UNSUPPORTED_FORMAT: 'The selected format is not supported.',
};

export function queueErrorDescription(code: QueueJob['errorCode']): string | undefined {
  return code ? errorDescriptions[code] : undefined;
}

export function matchesQueueFilter(entry: QueueJob, filter: QueueFilter): boolean {
  switch (filter) {
    case 'active': return isActiveDownload(entry);
    case 'completed': return entry.state === 'completed';
    case 'attention': return entry.state === 'failed' || entry.state === 'rescan_required';
    case 'all': return true;
  }
}

export function searchQueueJob(entry: QueueJob, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const terms = [entry.id, entry.state, queueStateLabel(entry), entry.errorCode ?? '',
    queueErrorDescription(entry.errorCode) ?? '', entry.purpose ?? 'download'];
  return terms.some(term => term.toLocaleLowerCase().includes(normalized));
}

export function queueFilterCount(jobs: QueueJob[], filter: QueueFilter): number {
  return jobs.filter(entry => matchesQueueFilter(entry, filter)).length;
}

export function eligibleQueueJobs(jobs: QueueJob[], action: QueueAction): QueueJob[] {
  return jobs.filter(entry => canApplyQueueAction(entry, action));
}

export function formatBytes(bytes: number): string {
  const value = Math.max(0, bytes);
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length);
  const scaled = value / 1024 ** exponent;
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(scaled)} ${units[exponent - 1]}`;
}

export function progressPercent(entry: QueueJob): number | undefined {
  if (!entry.totalBytes) return undefined;
  return Math.min(100, Math.round(entry.bytesDownloaded / entry.totalBytes * 100));
}

export function canApplyQueueAction(entry: QueueJob, action: QueueAction): boolean {
  if (action === 'pause') return ['queued', 'leased', 'downloading'].includes(entry.state);
  if (action === 'retry') return ['paused', 'failed'].includes(entry.state);
  return ['queued', 'leased', 'downloading', 'paused'].includes(entry.state);
}
