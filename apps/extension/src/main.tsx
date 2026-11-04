import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { agents, candidate, claimInput, error, job, pairing, scanResult, type Candidate } from '@mediahunter/contracts';
import { scanPage } from './scan';
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

  function scan() {
    if (!connection) return;
    void run(async () => {
      setResults([]);
      setScanned(false);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined || !/^https?:\/\//.test(tab.url ?? '')) throw new Error('Open an HTTP or HTTPS page to scan.');
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanPage });
      const candidates = candidate.array().parse(result?.result ?? []);
      const registered = scanResult.parse(await api(connection, '/scans', { pageOrigin: new URL(tab.url!).origin, candidates }));
      setResults(candidates.map((item, index) => ({ ...item, id: registered.candidateIds[index] })));
      setScanned(true);
    });
  }

  function enqueue(item: Result) {
    if (!connection || !target) return;
    void run(async () => {
      const key = item.id + target;
      const idempotencyKey = keys.get(key) ?? crypto.randomUUID();
      keys.set(key, idempotencyKey);
      const added = job.parse(await api(connection, '/jobs', { candidateId: item.id, targetAgentId: target, idempotencyKey }));
      setJobs(current => [added, ...current.filter(item => item.id !== added.id)]);
      setQueued(current => [...current, key]);
    });
  }

  return <main>
    <header><h1>MediaHunter</h1><span className={online ? 'online' : ''}>{connection ? online ? 'Hub online' : 'Hub offline' : 'Unpaired'}</span></header>
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
        <button disabled={busy || !online} onClick={scan}>Scan page</button>
      </section>
      <p className="note">Scans direct links in the active page only. Streaming manifests, protected media and browser sessions are outside this scan.</p>
      {scanned && <section aria-label="Media"><h2>Media <small>{results.length}{results.length === 200 ? '+' : ''}</small></h2>
        {!results.length && <p>No direct media found.</p>}
        {results.map(item => {
          const url = new URL(item.url);
          let name = url.pathname.split('/').pop() || item.mediaType;
          try { name = decodeURIComponent(name); } catch { /* Keep the encoded name. */ }
          return <article key={item.id}><div><strong>{name}</strong>
            <small>{url.hostname} · {item.format ?? item.mediaType} · {item.width && item.height ? item.width + ' × ' + item.height : 'Unknown resolution'} · {item.source}</small>
          </div><button disabled={busy || !online || !target || queued.includes(item.id + target)} onClick={() => enqueue(item)}>Download</button></article>;
        })}
      </section>}
      <section aria-label="Downloads"><h2>Downloads</h2>
        {!jobs.length && <p>No downloads queued.</p>}
        {jobs.map(item => <article key={item.id}><div><strong>{item.state.replaceAll('_', ' ')}</strong>
          <small>{item.id.slice(0, 8)} · {item.bytesDownloaded.toLocaleString()} bytes{item.errorCode ? ' · ' + item.errorCode : ''}</small>
        </div>{['queued', 'leased', 'downloading'].includes(item.state) && <button disabled={busy || !online} onClick={() => void run(async () => {
          const updated = job.parse(await api(connection, '/jobs/' + item.id + '/cancel', {}));
          setJobs(current => current.map(value => value.id === updated.id ? updated : value));
        })}>Cancel</button>}</article>)}
      </section>
      <button disabled={busy} className="secondary" onClick={() => void run(async () => {
        await chrome.storage.local.remove('connection');
        setConnection(undefined); setOnline(false); setJobs([]); setResults([]); setScanned(false);
      })}>Forget pairing</button>
    </>}
    {message && <p className="message" role="alert">{message}</p>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup />);
