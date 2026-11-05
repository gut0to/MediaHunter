import { useState } from 'react';
import { formatBytes, progressPercent, queueErrorDescription, queueFilterCount, queueFilters, matchesQueueFilter, queueStateLabel, searchQueueJob, type QueueFilter, type QueueJob } from './queue';

type Props = { jobs: QueueJob[]; rates?: Record<string, number> };

export function DownloadsQueue({ jobs, rates = {} }: Props) {
  const [filter, setFilter] = useState<QueueFilter>('active');
  const [query, setQuery] = useState('');
  const visible = jobs.filter(entry => matchesQueueFilter(entry, filter) && searchQueueJob(entry, query));

  return <section aria-label="Downloads" className="download-queue">
    <h2>Downloads <small>{queueFilterCount(jobs, filter)}</small></h2>
    <div className="queue-filters" role="group" aria-label="Filter downloads">
      {queueFilters.map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
        {value === 'active' ? 'Active' : value === 'completed' ? 'Completed' : value === 'attention' ? 'Needs attention' : 'All'}
        <span>{queueFilterCount(jobs, value)}</span>
      </button>)}
    </div>
    <label>Search downloads<input type="search" value={query} onChange={event => setQuery(event.target.value)}
      placeholder="Task ID, status, or error" /></label>
    {!visible.length && <div className="queue-empty" role="status">
      <p>{query ? 'No downloads match this search.' : filter === 'active' ? 'No active downloads. New jobs will appear here.' :
        filter === 'completed' ? 'No completed downloads yet.' : filter === 'attention' ? 'No downloads need attention.' : 'No downloads queued yet.'}</p>
      {query && <button className="secondary" onClick={() => setQuery('')}>Clear search</button>}
    </div>}
    {visible.map(entry => <article className="queue-job" key={entry.id}>
      <div className="queue-job-copy">
        <strong>{queueStateLabel(entry)}</strong>
        <small>{entry.id.slice(0, 8)} · {formatBytes(entry.bytesDownloaded)} received</small>
        {entry.state === 'downloading' && <>
          <progress aria-label={`Progress for task ${entry.id.slice(0, 8)}`} max={entry.totalBytes || undefined}
            value={progressPercent(entry) === undefined ? undefined : entry.bytesDownloaded} />
          <small>{entry.totalBytes ? `${formatBytes(entry.bytesDownloaded)} of ${formatBytes(entry.totalBytes)} · ${progressPercent(entry)}%` :
            `${formatBytes(entry.bytesDownloaded)} received · total size unknown`}</small>
          {rates[entry.id] > 0 && <small>{formatBytes(rates[entry.id])}/s</small>}
        </>}
        {queueErrorDescription(entry.errorCode) && <small className="queue-error">{queueErrorDescription(entry.errorCode)}</small>}
      </div>
    </article>)}
  </section>;
}
