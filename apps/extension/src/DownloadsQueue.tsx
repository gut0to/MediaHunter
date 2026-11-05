import { useState } from 'react';
import { canApplyQueueAction, eligibleQueueJobs, formatBytes, progressPercent, queueErrorDescription, queueFilterCount, queueFilters, matchesQueueFilter, queueStateLabel, searchQueueJob, type QueueAction, type QueueFilter, type QueueJob } from './queue';

type Props = { jobs: QueueJob[]; rates?: Record<string, number>; online: boolean; busy: boolean;
  onAction: (id: string, action: QueueAction) => void; onBulkAction: (ids: string[], action: QueueAction) => void;
  onExport: () => void; onClear: () => void };

export function DownloadsQueue({ jobs, rates = {}, online, busy, onAction, onBulkAction, onExport, onClear }: Props) {
  const [filter, setFilter] = useState<QueueFilter>('active');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const visible = jobs.filter(entry => matchesQueueFilter(entry, filter) && searchQueueJob(entry, query));
  const selectable = visible.filter(entry => (['pause', 'retry', 'cancel'] as const).some(action => canApplyQueueAction(entry, action)));
  const selected = selectable.filter(entry => selectedIds.includes(entry.id));
  const eligible = (action: QueueAction) => eligibleQueueJobs(selected, action);
  const setFilterAndClear = (value: QueueFilter) => { setFilter(value); setSelectedIds([]); };
  const runBulkAction = (action: QueueAction) => {
    const entries = eligible(action);
    if (action === 'cancel' && !window.confirm(`Cancel ${entries.length} selected downloads?`)) return;
    onBulkAction(entries.map(entry => entry.id), action);
    setSelectedIds([]);
  };

  return <section aria-label="Downloads" className="download-queue">
    <h2>Downloads <small>{queueFilterCount(jobs, filter)}</small></h2>
    <div className="queue-filters" role="group" aria-label="Filter downloads">
      {queueFilters.map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilterAndClear(value)}>
        {value === 'active' ? 'Active' : value === 'completed' ? 'Completed' : value === 'attention' ? 'Needs attention' : 'All'}
        <span>{queueFilterCount(jobs, value)}</span>
      </button>)}
    </div>
    <label>Search downloads<input type="search" value={query} onChange={event => { setQuery(event.target.value); setSelectedIds([]); }}
      placeholder="Task ID, status, or error" /></label>
    <div className="queue-tools">
      <button className="secondary" disabled={busy} onClick={onExport}>Export JSON</button>
      <button className="secondary" disabled={busy || !online} onClick={onClear}>Clear finished history</button>
    </div>
    {selectable.length > 0 && <div className="queue-bulk-actions">
      <button className="secondary" onClick={() => setSelectedIds(selected.length === selectable.length ? [] : selectable.map(entry => entry.id))}>
        {selected.length === selectable.length ? 'Clear selection' : 'Select actionable'}
      </button>
      {(['pause', 'retry', 'cancel'] as const).map(action => eligible(action).length > 0 && <button key={action}
        className={action === 'cancel' ? 'secondary' : undefined} disabled={busy || !online}
        onClick={() => runBulkAction(action)}>{action === 'retry' ? 'Resume / retry' : action[0].toUpperCase() + action.slice(1)} selected ({eligible(action).length})</button>)}
    </div>}
    {!visible.length && <div className="queue-empty" role="status">
      <p>{query ? 'No downloads match this search.' : filter === 'active' ? 'No active downloads. New jobs will appear here.' :
        filter === 'completed' ? 'No completed downloads yet.' : filter === 'attention' ? 'No downloads need attention.' : 'No downloads queued yet.'}</p>
      {query && <button className="secondary" onClick={() => setQuery('')}>Clear search</button>}
    </div>}
    {visible.map(entry => <article className="queue-job" key={entry.id}>
      {selectable.includes(entry) && <input type="checkbox" aria-label={`Select task ${entry.id.slice(0, 8)}`}
        checked={selectedIds.includes(entry.id)} onChange={event => setSelectedIds(current => event.target.checked ? [...current, entry.id] : current.filter(id => id !== entry.id))} />}
      <div className="queue-job-copy">
        <strong>{queueStateLabel(entry)}</strong>
        <small>{entry.id.slice(0, 8)} · {formatBytes(entry.bytesDownloaded)} received</small>
        {entry.state === 'downloading' && <>
          <progress aria-label={`Progress for task ${entry.id.slice(0, 8)}`} max={entry.totalBytes || undefined}
            value={progressPercent(entry) === undefined ? undefined : Math.min(entry.bytesDownloaded, entry.totalBytes!)} />
          <small>{entry.totalBytes ? `${formatBytes(entry.bytesDownloaded)} of ${formatBytes(entry.totalBytes)} · ${progressPercent(entry)}%` :
            `${formatBytes(entry.bytesDownloaded)} received · total size unknown`}</small>
          {rates[entry.id] > 0 && <small>{formatBytes(rates[entry.id])}/s</small>}
        </>}
        {queueErrorDescription(entry.errorCode) && <small className="queue-error">{queueErrorDescription(entry.errorCode)}</small>}
      </div>
      <div className="job-actions">{(['pause', 'retry', 'cancel'] as const).filter(action => canApplyQueueAction(entry, action)).map(action => <button
        key={action} className={action === 'cancel' ? 'secondary' : undefined} disabled={busy || !online}
        onClick={() => action !== 'cancel' || window.confirm('Cancel this download?') ? onAction(entry.id, action) : undefined}>
        {action === 'retry' ? entry.state === 'paused' ? 'Resume' : 'Retry' : action[0].toUpperCase() + action.slice(1)}
      </button>)}</div>
    </article>)}
  </section>;
}
