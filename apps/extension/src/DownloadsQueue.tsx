import { useState } from 'react';
import { queueFilterCount, queueFilters, matchesQueueFilter, type QueueFilter, type QueueJob } from './queue';

type Props = { jobs: QueueJob[] };

export function DownloadsQueue({ jobs }: Props) {
  const [filter, setFilter] = useState<QueueFilter>('active');
  const visible = jobs.filter(entry => matchesQueueFilter(entry, filter));

  return <section aria-label="Downloads" className="download-queue">
    <h2>Downloads <small>{queueFilterCount(jobs, filter)}</small></h2>
    <div className="queue-filters" role="group" aria-label="Filter downloads">
      {queueFilters.map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
        {value === 'active' ? 'Active' : value === 'completed' ? 'Completed' : value === 'attention' ? 'Needs attention' : 'All'}
        <span>{queueFilterCount(jobs, value)}</span>
      </button>)}
    </div>
    {!visible.length && <p>No downloads in this view.</p>}
  </section>;
}
