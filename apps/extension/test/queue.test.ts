import { expect, test } from 'vitest';
import { job } from '@mediahunter/contracts';
import { canApplyQueueAction, isActiveDownload, queueErrorDescription, queueStateLabel, type QueueJob } from '../src/queue';

function entry(state: QueueJob['state'], purpose: 'download' | 'probe' = 'download', errorCode: QueueJob['errorCode'] = null): QueueJob {
  return job.parse({ id: '00000000-0000-4000-8000-000000000001', state, bytesDownloaded: 0, totalBytes: null, purpose, errorCode });
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
});

test('queue labels translate internal states into useful recovery guidance', () => {
  expect(queueStateLabel(entry('rescan_required'))).toBe('Scan again');
  expect(queueStateLabel(entry('completed', 'probe'))).toBe('Formats ready');
  expect(queueErrorDescription('EXPIRED_URL')).toContain('Scan the page again');
});
