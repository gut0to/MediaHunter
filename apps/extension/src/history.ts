import type { QueueJob } from './queue';

const columns = ['id', 'state', 'purpose', 'priority', 'attempts', 'bytes_downloaded', 'total_bytes', 'error_code', 'created_at', 'updated_at'] as const;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function historyCsv(jobs: QueueJob[]): string {
  const rows = jobs.map(entry => [entry.id, entry.state, entry.purpose ?? 'download', entry.priority, entry.attempts,
    entry.bytesDownloaded, entry.totalBytes, entry.errorCode, new Date(entry.createdAt).toISOString(), new Date(entry.updatedAt).toISOString()]);
  return [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
