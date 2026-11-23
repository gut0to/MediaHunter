import { expect, test } from 'vitest';
import { job } from '@mediahunter/contracts';
import { historyCsv } from '../src/history';

test('exports a stable metadata-only history CSV', () => {
  const entry = job.parse({ id: '00000000-0000-4000-8000-000000000001', state: 'failed', purpose: 'download',
    priority: 'high', attempts: 2, bytesDownloaded: 512, totalBytes: 1024, errorCode: 'HTTP_ERROR',
    createdAt: 0, updatedAt: 60_000 });
  const csv = historyCsv([entry]);
  expect(csv).toContain('id,state,purpose,priority,attempts,bytes_downloaded,total_bytes,error_code,created_at,updated_at');
  expect(csv).toContain('HTTP_ERROR,1970-01-01T00:00:00.000Z,1970-01-01T00:01:00.000Z');
  expect(csv).not.toContain('url');
  expect(csv.endsWith('\r\n')).toBe(true);
});
