import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { agents, candidate, claimInput, error, job, pairing, scanResult, uuid, type Candidate } from '@mediahunter/contracts';
import { discover } from './discovery';
import { groupVariants } from './quality';
import './style.css';

type Connection = { origin: string; token: string };
type Result = Candidate & { id: string };
type Agent = ReturnType<typeof agents.parse>[number];
type Job = ReturnType<typeof job.parse>;

function hubOrigin(raw: string) {
  const url = new URL(raw.trim());
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) {
    throw new Error('Enter a private HTTPS origin, with no path.');
  }
  return url;
}

async function api(connection: Connection, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(connection.origin + '/api/v1' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(connection.token ? { Authorization: 'Bearer ' + connection.token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(error.safeParse(result).data?.code ?? 'HUB_REQUEST_FAILED');
  return result;
}

function Popup() {
  const [connection, setConnection] = useState<Connection>();
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab>();
  const [origin, setOrigin] = useState('');
  const [code, setCode] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [devices, setDevices] = useState<Agent[]>([]);
  const [target, setTarget] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  const [keys] = useState(() => new Map<string, string>());
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [scanned, setScanned] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [formats, setFormats] = useState<Record<string, string>>({});
  const [probes, setProbes] = useState<Record<string, string>>({});
  const [destination, setDestination] = useState('default');
  const [captureTab, setCaptureTab] = useState<number>();
  const [allowedHosts, setAllowedHosts] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [preview, setPreview] = useState('');
  const [browserMode, setBrowserMode] = useState(false);
  const panel = new URLSearchParams(location.search).has('panel');
  const profileNames = devices.find(device => device.id === target)?.profiles ?? ['default'];
  const profile = profileNames.includes(destination) ? destination : profileNames[0] ?? 'default';

  useEffect(() => {
    void chrome.storage.session.get('lastScan').then(value => {
      const saved = value.lastScan as { results?: unknown; warnings?: unknown } | undefined;
      const parsed = candidate.extend({ id: uuid }).array().max(200).safeParse(saved?.results);
      if (parsed.success) {
        setResults(parsed.data);
        setWarnings(Array.isArray(saved?.warnings) ? saved.warnings.filter((entry): entry is string => typeof entry === 'string').slice(0, 20) : []);
        setScanned(true);
      }
    });
  }, []);

  useEffect(() => {
    const refreshTab = () => { void chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => setActiveTab(tabs[0])); };
    refreshTab();
    chrome.tabs.onActivated.addListener(refreshTab);
    chrome.tabs.onUpdated.addListener(refreshTab);
    return () => {
      chrome.tabs.onActivated.removeListener(refreshTab);
      chrome.tabs.onUpdated.removeListener(refreshTab);
    };
  }, []);

  useEffect(() => {
    void chrome.storage.local.get('connection').then(value => {
      if (value.connection) setConnection(value.connection as Connection);
    }).catch(() => setMessage('Could not load pairing.'));
  }, []);

  useEffect(() => {
    if (!connection) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [agentResponse, jobResponse] = await Promise.all([api(connection!, '/devices'), api(connection!, '/jobs')]);
        const nextDevices = agents.parse(agentResponse);
        if (closed) return;
        setOnline(true);
        setDevices(nextDevices);
        setTarget(value => nextDevices.some(agent => agent.id === value) ? value : nextDevices[0]?.id ?? '');
        setJobs(job.array().parse(jobResponse));
      } catch {
        if (!closed) setOnline(false);
      } finally {
        if (!closed) timer = setTimeout(refresh, 2500);
      }
    }
    void refresh();
    return () => { closed = true; clearTimeout(timer); };
  }, [connection]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try { await operation(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Operation failed.'); }
    finally { setBusy(false); }
  }

  function pair(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const url = hubOrigin(origin);
      const input = claimInput.parse({ kind: 'extension', name: 'Chromium extension', code: code.trim() });
      const pattern = url.protocol + '//' + url.hostname + '/*';
      if (!await chrome.permissions.request({ origins: [pattern] })) throw new Error('Hub permission was declined.');
      const result = pairing.parse(await api({ origin: url.origin, token: '' }, '/pairing/claim', input));
      const next = { origin: url.origin, token: result.token };
      await chrome.storage.local.set({ connection: next });
      setConnection(next);
      setCode('');
    });
  }

  function scan(mode: 'dom' | 'network' | 'site') {
    if (!connection) return;
    if (mode === 'network' && !confirm('Reload the active tab and observe permitted media requests for up to 15 seconds?')) return;
    void run(async () => {
      setSelected([]);
      const tab = activeTab;
      if (tab?.id === undefined || !/^https?:\/\//.test(tab.url ?? '')) throw new Error('Open an HTTP or HTTPS page to scan.');
      const tabId = tab.id;
      const page = new URL(tab.url!);
      let candidates: Candidate[] = [];
      let nextWarnings: string[] = [];
      if (mode === 'site') {
        page.hash = '';
        candidates = [{ url: page.href, mediaType: 'video', source: 'site', delivery: 'site', width: null, height: null, format: null }];
      } else if (mode === 'network') {
        const hosts = [page.origin, ...allowedHosts.split(',').map(host => host.trim()).filter(Boolean)];
        const origins = hosts.map(host => {
          const url = new URL(host);
          if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
            throw new Error('Enter exact HTTP or HTTPS origins separated by commas.');
          }
          return url.protocol + '//' + url.hostname + '/*';
        });
        if (!await chrome.permissions.request({ permissions: ['webRequest'], origins })) throw new Error('Capture permission was declined.');
        const port = chrome.runtime.connect({ name: 'capture-view' });
        port.postMessage(tabId);
        try {
          if (!await chrome.runtime.sendMessage({ type: 'capture:start', tab: tabId })) throw new Error('Capture could not start.');
          setCaptureTab(tabId);
          await chrome.tabs.reload(tabId);
          await new Promise<void>(resolve => {
            const timer = setTimeout(() => { window.removeEventListener('stop-capture', stop); resolve(); }, 12_000);
            function stop() { clearTimeout(timer); resolve(); }
            window.addEventListener('stop-capture', stop, { once: true });
          });
          candidates = candidate.array().parse(await chrome.runtime.sendMessage({ type: 'capture:stop', tab: tabId }));
          nextWarnings = ['Capture includes only requests Chromium exposes for granted origins. Cache and other hosts may be missing.'];
        } finally {
          port.disconnect();
          setCaptureTab(undefined);
        }
      } else {
        setCaptureTab(tabId);
        try {
          let executions: chrome.scripting.InjectionResult<Awaited<ReturnType<typeof discover>>>[];
          try {
            executions = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: discover, args: [5000] });
          } catch {
            executions = await chrome.scripting.executeScript({ target: { tabId }, func: discover, args: [5000] });
            nextWarnings.push('Some frames could not be scanned with the current permissions.');
          }
          if (!executions.some(execution => execution.result)) throw new Error('Chromium could not scan this tab.');
          const collected = new Map<string, Candidate>();
          for (const execution of executions) {
            if (!execution.result) continue;
            for (const item of candidate.array().parse(execution.result.candidates)) {
              if (!collected.has(item.url) && collected.size < 200) {
                collected.set(item.url, { ...item, groupKey: item.groupKey ? execution.frameId + ':' + item.groupKey : undefined });
              }
            }
            nextWarnings.push(...execution.result.warnings);
          }
          candidates = [...collected.values()];
          nextWarnings = [...new Set(nextWarnings)];
        } finally {
          setCaptureTab(undefined);
        }
      }
      const registered = scanResult.parse(await api(connection, '/scans', { pageOrigin: page.origin, candidates }));
      const items = candidates.map((item, index) => ({ ...item, id: registered.candidateIds[index] }));
      const nextResults = mode === 'dom' ? items : [...results.filter(item => !items.some(next => next.url === item.url)), ...items].slice(-200);
      setResults(nextResults);
      setWarnings(nextWarnings);
      setScanned(true);
      await chrome.storage.session.set({ lastScan: { results: nextResults, warnings: nextWarnings } });
    });
  }

  function stopScan() {
    if (captureTab === undefined) return;
    window.dispatchEvent(new Event('stop-capture'));
    void chrome.scripting.executeScript({ target: { tabId: captureTab, allFrames: true }, func: () => {
      (globalThis as typeof globalThis & { mediaHunterStop?: () => void }).mediaHunterStop?.();
    } }).catch(() => undefined);
  }

  const keyFor = (item: Result, purpose: 'probe' | 'download' = 'download') =>
    [item.id, target, profile, purpose, purpose === 'download' ? formats[item.id] : ''].join(':');

  function enqueue(items: Result[], purpose: 'probe' | 'download' = 'download') {
    if (!connection || !target) return;
    void run(async () => {
      const outcomes = await Promise.allSettled(items.map(async item => {
        const key = keyFor(item, purpose);
        const idempotencyKey = keys.get(key) ?? crypto.randomUUID();
        keys.set(key, idempotencyKey);
        const added = job.parse(await api(connection, '/jobs', { candidateId: item.id, targetAgentId: target,
          idempotencyKey, purpose, destinationProfileId: profile, requestedFormat: purpose === 'download' ? formats[item.id] || undefined : undefined }));
        setJobs(current => [added, ...current.filter(currentJob => currentJob.id !== added.id)]);
        setQueued(current => [...current, key]);
        if (purpose === 'probe') setProbes(current => ({ ...current, [item.id]: added.id }));
      }));
      const failed = outcomes.filter(outcome => outcome.status === 'rejected').length;
      if (failed) throw new Error(failed + ' of ' + outcomes.length + ' requests could not be queued.');
    });
  }

  function browserDownload(item: Result) {
    void run(async () => {
      if (!await chrome.permissions.request({ permissions: ['downloads'] })) throw new Error('Download permission was declined.');
      await chrome.downloads.download({ url: item.url, saveAs: true });
      setMessage('Browser-managed download requested. Check Chromium Downloads.');
    });
  }

  const visible = groupVariants(results.filter(item => filter === 'all' || filter === item.mediaType));
  const chosen = visible.map(group => group.variants.find(item => item.id === variants[group.id]) ?? group.variants[0]);
  const chosenSelected = chosen.filter(item => selected.includes(item.id) && !queued.includes(keyFor(item)));
  const activeJobs = jobs.filter(item => item.purpose !== 'probe' && ['queued', 'leased', 'downloading', 'paused'].includes(item.state));

  return <main className={panel ? 'panel' : undefined}>
    <header><h1>MediaHunter</h1><span className={online ? 'online' : ''}>{connection ? online ? 'Hub online' : 'Hub offline' : 'Unpaired'}</span></header>
    {!panel && <button className="secondary open-panel" disabled={!activeTab} onClick={() => {
      if (activeTab) void chrome.sidePanel.open({ windowId: activeTab.windowId }).catch(() => setMessage('Chromium could not open the side panel.'));
    }}>Open side panel</button>}
    {!connection ? <form onSubmit={pair}>
      <label>Hub origin<input type="url" required value={origin} onChange={event => setOrigin(event.target.value)} placeholder="https://hub.example.net" /></label>
      <label>Pairing code<input required pattern="[0-9a-f]{16}" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} /></label>
      <button disabled={busy}>Pair extension</button>
    </form> : <>
      <section className="controls">
        <label>Windows agent<select value={target} onChange={event => setTarget(event.target.value)}>
          <option value="" disabled>Waiting for an agent</option>
          {devices.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.online ? 'online' : 'offline'}</option>)}
        </select></label>
        <button disabled={busy || !online} onClick={() => scan('dom')}>Scan page</button>
        {captureTab !== undefined && <button onClick={stopScan}>Stop scan</button>}
      </section>
      <label>Destination<select value={profile} onChange={event => setDestination(event.target.value)}>
        {profileNames.map(name => <option key={name}>{name}</option>)}
      </select></label>
      <button className="secondary" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>Capture options</button>
      {advanced && <section>
        <label>Extra media origins<input value={allowedHosts} onChange={event => setAllowedHosts(event.target.value)} placeholder="https://media.example.net" /></label>
        <button disabled={busy || !online} onClick={() => scan('network')}>Reload and capture</button>{' '}
        <button disabled={busy || !online} onClick={() => scan('site')}>Inspect site with yt-dlp</button>
        <label className="choice"><input type="checkbox" checked={browserMode} onChange={event => setBrowserMode(event.target.checked)} /> Show browser download for direct links that need my session</label>
      </section>}
      {warnings.map(warning => <p className="note" key={warning}>{warning}</p>)}
      {scanned && <section aria-label="Media">
        <h2>Media <small>{visible.length} groups</small></h2>
        <div className="filters">
          {(['all', 'image', 'video'] as const).map(value => <button key={value} aria-pressed={filter === value}
            onClick={() => setFilter(value)}>{value === 'all' ? 'All' : value === 'image' ? 'Images' : 'Videos'}</button>)}
        </div>
        {!chosen.length && <p>No media found in this view.</p>}
        {chosen.length > 0 && <div className="selection">
          <button onClick={() => setSelected(chosen.map(item => item.id))}>Select all visible</button>
          <button disabled={busy || !online || !target || !chosenSelected.length} onClick={() => enqueue(chosenSelected)}>Download selected ({chosenSelected.length})</button>
        </div>}
        {visible.map((group, index) => {
          const item = chosen[index];
          const probe = jobs.find(entry => entry.id === probes[item.id]);
          const adaptive = Boolean(item.delivery && item.delivery !== 'direct');
          const url = new URL(item.url);
          let name = url.pathname.split('/').pop() || item.mediaType;
          try { name = decodeURIComponent(name); } catch { /* Keep the encoded name. */ }
          return <article className="media" key={group.id}>
            <label className="choice media-title"><input type="checkbox" checked={selected.includes(item.id)} onChange={event =>
              setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />
              <strong title={name}>{name}</strong></label>
            <small>{url.hostname} / {item.format ?? item.mediaType} / {item.width && item.height ? item.width + ' × ' + item.height : 'Unknown resolution'} / {item.source}</small>
            {group.variants.length > 1 && <label>Variant<select value={variants[group.id] ?? ''} onChange={event =>
              setVariants(current => ({ ...current, [group.id]: event.target.value }))}>
              <option value="">Best available{item.width ? ' by detected dimensions' : ' · dimensions unknown'}</option>
              {group.variants.map((entry, order) => <option key={entry.id} value={entry.id}>{order + 1} / {entry.width && entry.height ? entry.width + ' × ' + entry.height : 'Unknown'} / {entry.source}</option>)}
            </select></label>}
            {probe?.formats?.length ? <label>yt-dlp formats<select value={formats[item.id] ?? ''} onChange={event =>
              setFormats(current => ({ ...current, [item.id]: event.target.value }))}>
              <option value="">Best available with audio</option>
              {probe.formats.filter(format => format.hasVideo).map(format => <option key={format.id} value={format.id}>
                {format.height ? format.height + 'p' : 'Unknown resolution'} / {format.format} / {format.hasAudio ? 'audio included' : 'merge audio if available'}
                {format.fps ? ' / ' + format.fps + ' fps' : ''}{format.bitrate ? ' / ' + Math.round(format.bitrate) + ' kbps' : ''}
              </option>)}
            </select></label> : probe && <small>yt-dlp inspection {probe.state.replaceAll('_', ' ')} {probe.errorCode}</small>}
            {preview === item.id && item.mediaType === 'image' && <img className="preview" src={item.url} referrerPolicy="no-referrer" alt="" />}
            <div className="media-actions">
              <button disabled={busy || !online || !target || queued.includes(keyFor(item))} onClick={() => enqueue([item])}>Download</button>
              {adaptive && <button disabled={busy || !target || !online || Boolean(probe && !['completed', 'failed', 'rescan_required'].includes(probe.state))}
                onClick={() => enqueue([item], 'probe')}>Inspect formats</button>}
              {item.mediaType === 'image' && <button onClick={() => setPreview(preview === item.id ? '' : item.id)}>{preview === item.id ? 'Hide preview' : 'Preview'}</button>}
              {browserMode && !adaptive && <button onClick={() => browserDownload(item)}>Download in browser</button>}
            </div>
          </article>;
        })}
      </section>}
      <section aria-label="Downloads"><h2>Downloads</h2>
        {!jobs.length && <p>No downloads queued.</p>}
        {activeJobs.length > 0 && <p className="note">{activeJobs.length} unfinished · {activeJobs.reduce((bytes, item) => bytes + item.bytesDownloaded, 0).toLocaleString()} bytes received</p>}
        {jobs.map(item => <article key={item.id}><div><strong>{item.state.replaceAll('_', ' ')}</strong>
          <small>{item.id.slice(0, 8)} · {item.bytesDownloaded.toLocaleString()} bytes{item.errorCode ? ' · ' + item.errorCode : ''}</small>
        </div><div className="job-actions">{([
          ...(['queued', 'leased', 'downloading'].includes(item.state) ? ['pause'] : []),
          ...(['paused', 'failed'].includes(item.state) ? ['retry'] : []),
          ...(['queued', 'leased', 'downloading', 'paused'].includes(item.state) ? ['cancel'] : []),
        ]).map(action => <button key={action} disabled={busy || !online} onClick={() => void run(async () => {
          const updated = job.parse(await api(connection, '/jobs/' + item.id + '/' + action, {}));
          setJobs(current => current.map(value => value.id === updated.id ? updated : value));
        })}>{action === 'retry' && item.state === 'paused' ? 'Resume' : action[0].toUpperCase() + action.slice(1)}</button>)}</div></article>)}
      </section>
      <button disabled={busy} className="secondary" onClick={() => void run(async () => {
        await chrome.storage.local.remove('connection');
        await chrome.storage.session.remove('lastScan');
        setConnection(undefined); setOnline(false); setJobs([]); setResults([]); setScanned(false);
      })}>Forget pairing</button>
    </>}
    {message && <p className="message" role="alert">{message}</p>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup />);
