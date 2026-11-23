import { expect, test } from 'vitest';
import { job } from '@mediahunter/contracts';
import { canApplyQueueAction, formatBytes, isActiveDownload, matchesQueueFilter, progressPercent, queueErrorDescription, queueStateLabel, relativeTime, searchQueueJob, type QueueJob } from '../src/queue';

function entry(state: QueueJob['state'], purpose: 'download' | 'probe' = 'download', errorCode: QueueJob['errorCode'] = null): QueueJob {
  return job.parse({ id: '00000000-0000-4000-8000-000000000001', state, bytesDownloaded: 0, totalBytes: null, purpose, errorCode,
    createdAt: 1_000, updatedAt: 2_000 });
}

test('active download summary excludes completed work and format probes', () => {
  expect(isActiveDownload(entry('downloading'))).toBe(true);
  expect(isActiveDownload(entry('completed'))).toBe(false);
  expect(isActiveDownload(entry('downloading', 'probe'))).toBe(false);
});

test('queue actions are limited to states that support them', () => {
  expect(canApplyQueueAction(entry('downloading'), 'pause')).toBe(true);
  expect(canApplyQueueAction(entry('failed', 'download', 'HTTP_ERROR'), 'retry')).toBe(true);
  expect(canApplyQueueAction(entry('completed'), 'cancel')).toBe(false);
  const scheduled = job.parse({ id: '00000000-0000-4000-8000-000000000001', state: 'queued',
    bytesDownloaded: 0, errorCode: 'HTTP_ERROR', nextAttemptAt: Date.now() + 5_000, createdAt: 1_000, updatedAt: 2_000 });
  expect(canApplyQueueAction(scheduled, 'retry')).toBe(true);
});

test('queue labels translate internal states into useful recovery guidance', () => {
  expect(queueStateLabel(entry('rescan_required'))).toBe('Scan again');
  expect(queueStateLabel(entry('completed', 'probe'))).toBe('Formats ready');
  expect(queueErrorDescription('EXPIRED_URL')).toContain('Scan the page again');
});

test('queue views and search match state, purpose, and failure code', () => {
  const failed = entry('failed', 'download', 'HTTP_ERROR');
  expect(matchesQueueFilter(failed, 'attention')).toBe(true);
  expect(matchesQueueFilter(failed, 'completed')).toBe(false);
  expect(searchQueueJob(failed, 'http_error')).toBe(true);
  expect(searchQueueJob(failed, 'format probe')).toBe(false);
});

test('progress stays indeterminate when the Hub has no total size', () => {
  expect(progressPercent(entry('downloading'))).toBeUndefined();
  expect(progressPercent(job.parse({ id: '00000000-0000-4000-8000-000000000001', state: 'downloading',
    bytesDownloaded: 512, totalBytes: 1024, errorCode: null, createdAt: 1_000, updatedAt: 2_000 }))).toBe(50);
  expect(formatBytes(1024)).toBe('1 KB');
});

test('relative job times stay concise across useful ranges', () => {
  const now = 10 * 24 * 60 * 60 * 1000;
  expect(relativeTime(now - 20_000, now)).toBe('Just now');
  expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
  expect(relativeTime(now - 3 * 60 * 60_000, now)).toBe('3h ago');
  expect(relativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe('2d ago');
});
