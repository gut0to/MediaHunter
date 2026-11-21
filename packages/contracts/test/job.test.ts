import { expect, test } from 'vitest';
import { job, jobInput } from '../src/index.ts';

const baseInput = {
  candidateId: '00000000-0000-4000-8000-000000000001',
  targetAgentId: '00000000-0000-4000-8000-000000000002',
  idempotencyKey: '00000000-0000-4000-8000-000000000003',
};

test('queue inputs default to normal priority and reject unknown levels', () => {
  expect(jobInput.parse(baseInput).priority).toBe('normal');
  expect(jobInput.safeParse({ ...baseInput, priority: 'urgent' }).success).toBe(false);
});

test('public jobs validate attempt scheduling metadata', () => {
  const value = job.parse({ id: baseInput.idempotencyKey, state: 'queued', bytesDownloaded: 0,
    errorCode: null, priority: 'high', attempts: 2, nextAttemptAt: 1000 });
  expect(value).toMatchObject({ priority: 'high', attempts: 2, nextAttemptAt: 1000 });
  expect(job.safeParse({ ...value, attempts: -1 }).success).toBe(false);
});
