import type { failure } from '@mediahunter/contracts';
import type { z } from 'zod';

type Failure = z.infer<typeof failure>;

const retryableFailures = new Set<Failure>(['DOWNLOAD_FAILED', 'HTTP_ERROR', 'LEASE_LOST']);
export const maximumAutomaticAttempts = 3;

export function automaticRetryDelay(attempts: number): number | undefined {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts >= maximumAutomaticAttempts) return undefined;
  return Math.min(5 * 60_000, 5_000 * 3 ** (attempts - 1));
}

export function shouldRetryAutomatically(code: Failure, attempts: number): boolean {
  return retryableFailures.has(code) && automaticRetryDelay(attempts) !== undefined;
}
