import { expect, test } from 'vitest';
import { automaticRetryDelay, maximumAutomaticAttempts, shouldRetryAutomatically } from '../src/retry.ts';

test('automatic retry delay grows between attempts and stops at the limit', () => {
  expect(automaticRetryDelay(1)).toBe(5_000);
  expect(automaticRetryDelay(2)).toBe(15_000);
  expect(automaticRetryDelay(maximumAutomaticAttempts)).toBeUndefined();
  expect(automaticRetryDelay(0)).toBeUndefined();
});

test('only transient failures retry automatically', () => {
  expect(shouldRetryAutomatically('HTTP_ERROR', 1)).toBe(true);
  expect(shouldRetryAutomatically('DOWNLOAD_FAILED', 2)).toBe(true);
  expect(shouldRetryAutomatically('LEASE_LOST', 1)).toBe(true);
  expect(shouldRetryAutomatically('EXPIRED_URL', 1)).toBe(false);
  expect(shouldRetryAutomatically('DESTINATION_ERROR', 1)).toBe(false);
});
