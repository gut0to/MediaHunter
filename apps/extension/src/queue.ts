import { job } from '@mediahunter/contracts';

export type QueueJob = ReturnType<typeof job.parse>;
export type QueueFilter = 'active' | 'completed' | 'attention' | 'all';
export type QueueAction = 'pause' | 'retry' | 'cancel';
export type QueueSort = 'recent' | 'oldest' | 'priority' | 'progress';
export const queueFilters: QueueFilter[] = ['active', 'completed', 'attention', 'all'];
export const queueSorts: QueueSort[] = ['recent', 'oldest', 'priority', 'progress'];

const activeStates = new Set<QueueJob['state']>(['queued', 'leased', 'downloading', 'paused']);

export function isActiveDownload(entry: QueueJob): boolean {
  return entry.purpose !== 'probe' && activeStates.has(entry.state);
}

export function queueStateLabel(entry: QueueJob, now = Date.now()): string {
  if (entry.purpose === 'probe' && entry.state === 'downloading') return 'Inspecting formats';
  if (entry.purpose === 'probe' && entry.state === 'completed') return 'Formats ready';
  if (entry.state === 'queued' && entry.nextAttemptAt !== null && entry.nextAttemptAt > now) return 'Retry scheduled';
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

export function queuePriorityLabel(priority: QueueJob['priority']): string {
  return priority === 'high' ? 'High priority' : priority === 'low' ? 'Low priority' : 'Normal priority';
}

export function retryCountdown(entry: QueueJob, now = Date.now()): string | undefined {
  if (entry.state !== 'queued' || entry.nextAttemptAt === null || entry.nextAttemptAt <= now) return undefined;
  const seconds = Math.max(1, Math.ceil((entry.nextAttemptAt - now) / 1000));
  return seconds < 60 ? `Retrying in ${seconds}s` : `Retrying in ${Math.ceil(seconds / 60)}m`;
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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
  const terms = [entry.id, entry.state, queueStateLabel(entry), entry.priority, queuePriorityLabel(entry.priority), entry.errorCode ?? '',
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

export function estimatedTimeRemaining(entry: QueueJob, bytesPerSecond: number): string | undefined {
  if (entry.state !== 'downloading' || !entry.totalBytes || bytesPerSecond <= 0) return undefined;
  const seconds = Math.ceil(Math.max(0, entry.totalBytes - entry.bytesDownloaded) / bytesPerSecond);
  if (!seconds) return 'Finishing';
  if (seconds < 60) return `About ${seconds}s left`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `About ${minutes}m left`;
  return `About ${Math.ceil(minutes / 60)}h left`;
}

export function sortQueueJobs(jobs: QueueJob[], sort: QueueSort): QueueJob[] {
  const priority = { high: 0, normal: 1, low: 2 } as const;
  return [...jobs].sort((left, right) => {
    if (sort === 'oldest') return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
    if (sort === 'priority') return priority[left.priority] - priority[right.priority] || left.createdAt - right.createdAt;
    if (sort === 'progress') {
      const difference = (progressPercent(right) ?? -1) - (progressPercent(left) ?? -1);
      if (difference) return difference;
    }
    return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
  });
}

export function canApplyQueueAction(entry: QueueJob, action: QueueAction): boolean {
  if (action === 'pause') return ['queued', 'leased', 'downloading'].includes(entry.state);
  if (action === 'retry') return ['paused', 'failed'].includes(entry.state) ||
    (entry.state === 'queued' && entry.nextAttemptAt !== null);
  return ['queued', 'leased', 'downloading', 'paused'].includes(entry.state);
}
