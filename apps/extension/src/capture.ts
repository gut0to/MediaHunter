import type { Candidate } from '@mediahunter/contracts';

type Session = { until: number; candidates: Candidate[] };
const key = (tab: number) => 'capture:' + tab;
let pending = Promise.resolve();

function sequence<T>(operation: () => Promise<T>) {
  const next = pending.then(operation);
  pending = next.then(() => undefined, () => undefined);
  return next;
}

function record(details: chrome.webRequest.OnHeadersReceivedDetails): undefined {
  if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
  const type = details.responseHeaders?.find(header => header.name.toLowerCase() === 'content-type')
    ?.value?.split(';', 1)[0].toLowerCase() ?? '';
  const url = new URL(details.url);
  if (url.username || url.password || url.href.length > 8192) return;
  url.hash = '';
  const extension = /\.([a-z0-9]{1,12})$/i.exec(url.pathname)?.[1].toLowerCase() ?? null;
  const delivery = extension === 'm3u8' || /mpegurl/.test(type) ? 'hls' :
    extension === 'mpd' || type === 'application/dash+xml' ? 'dash' : 'direct';
  const mediaType = delivery !== 'direct' || type.startsWith('video/') ||
    /^(mp4|webm|mov|m4v|ogv)$/.test(extension ?? '') ? 'video' :
    type.startsWith('image/') || /^(png|jpe?g|avif|webp|gif|bmp)$/.test(extension ?? '') ? 'image' : null;
  if (!mediaType || /(?:\.ts|\.m4s)$/i.test(url.pathname) || type === 'image/svg+xml') return;

  void sequence(async () => {
    const name = key(details.tabId);
    const session = (await chrome.storage.session.get(name))[name] as Session | undefined;
    if (!session || session.until < Date.now() || session.candidates.length >= 150 ||
      session.candidates.some(item => item.url === url.href)) return;
    session.candidates.push({ url: url.href, mediaType, delivery, format: extension,
      source: 'network', width: null, height: null });
    await chrome.storage.session.set({ [name]: session });
  }).catch(() => undefined);
  return undefined;
}

function register() {
  const event = chrome.webRequest?.onHeadersReceived;
  if (event && !event.hasListener(record)) {
    event.addListener(record, { urls: ['http://*/*', 'https://*/*'], types: ['media', 'image', 'xmlhttprequest', 'other'] },
      ['responseHeaders']);
  }
}

register();
chrome.permissions.onAdded.addListener(register);
chrome.tabs.onRemoved.addListener(tab => { void sequence(() => chrome.storage.session.remove(key(tab))); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('index.html')) || !Number.isInteger(message?.tab)) return;
  const name = key(message.tab);
  if (message.type === 'capture:start') {
    register();
    void sequence(() => chrome.storage.session.set({ [name]: { until: Date.now() + 15_000, candidates: [] } }))
      .then(() => reply(true), () => reply(false));
    return true;
  }
  if (message.type === 'capture:stop') {
    void sequence(async () => {
      const result = (await chrome.storage.session.get(name))[name] as Session | undefined;
      await chrome.storage.session.remove(name);
      return result?.candidates ?? [];
    }).then(reply, () => reply([]));
    return true;
  }
});
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'capture-view' || port.sender?.id !== chrome.runtime.id ||
    !port.sender.url?.startsWith(chrome.runtime.getURL('index.html'))) return;
  const tabs = new Set<number>();
  port.onMessage.addListener(tab => { if (Number.isInteger(tab)) tabs.add(tab); });
  port.onDisconnect.addListener(() => { void sequence(() => chrome.storage.session.remove([...tabs].map(key))); });
});
