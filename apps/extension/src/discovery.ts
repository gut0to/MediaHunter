import type { Candidate } from '@mediahunter/contracts';

export type Discovery = { candidates: Candidate[]; warnings: string[]; pageOrigin: string };

// Injected as a single function into the top frame's isolated world.
export async function discover(observeMs = 0): Promise<Discovery> {
  const found = new Map<string, Candidate>();
  const groups = new WeakMap<Element, string>();
  const warnings = new Set<string>();
  const imageExt = /\.(avif|bmp|gif|ico|jpe?g|png|webp)$/i;
  const videoExt = /\.(mp4|webm|mov|m4v|ogv|m3u8|mpd)$/i;
  let groupCount = 0;
  const group = (element: Element) => {
    let id = groups.get(element);
    if (!id) {
      id = String(++groupCount);
      groups.set(element, id);
    }
    return id;
  };
  function add(raw: string | null, base: string, source: Candidate['source'], groupKey?: string,
    mediaType?: Candidate['mediaType'], width?: number, height?: number) {
    if (!raw || found.size >= 200) return;
    let url: URL;
    try { url = new URL(raw, base); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return;
    url.hash = '';
    if (url.href.length > 8192) return;
    const format = (imageExt.exec(url.pathname)?.[1] ?? videoExt.exec(url.pathname)?.[1])?.toLowerCase() ?? null;
    mediaType ??= imageExt.test(url.pathname) ? 'image' : videoExt.test(url.pathname) ? 'video' : undefined;
    if (!mediaType) return;
    const delivery = format === 'm3u8' ? 'hls' : format === 'mpd' ? 'dash' : 'direct';
    if (delivery !== 'direct') mediaType = 'video';
    const previous = found.get(url.href);
    if (previous && (!groupKey || previous.groupKey) && (!width || previous.width)) return;
    found.set(url.href, { url: url.href, mediaType, source, format, delivery,
      groupKey: previous?.groupKey ?? groupKey, width: width || previous?.width || null, height: height || previous?.height || null });
  }
  function srcset(raw: string | null, base: string, source: 'srcset' | 'picture', groupKey: string) {
    let rest = raw ?? '';
    while (found.size < 200) {
      const token = /^[\s,]*(\S+)/.exec(rest);
      if (!token) break;
      add(token[1].replace(/,+$/, ''), base, source, groupKey, 'image');
      rest = rest.slice(token[0].length);
      if (token[1].endsWith(',')) continue;
      const comma = rest.indexOf(',');
      if (comma < 0) break;
      rest = rest.slice(comma + 1);
    }
  }

  const observed = new WeakSet<Node>();
  let observer: MutationObserver | undefined;
  const roots = new Set<Document | ShadowRoot>();
  let processed = 0;
  function scan(root: Document | ShadowRoot) {
    if (roots.has(root)) return;
    roots.add(root);
    if (observer && !observed.has(root)) {
      observer.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['src', 'srcset', 'poster', 'href', 'style', 'class', 'content'] });
      observed.add(root);
    }
    const doc = root.nodeType === 9 ? root as Document : root.ownerDocument!;
    const base = doc.baseURI;
    const walker = doc.createTreeWalker(root, 1);
    for (let node = walker.nextNode() as Element | null; node; node = walker.nextNode() as Element | null) {
      if (++processed > 5000 || found.size >= 200) { warnings.add('Scan reached its page or result limit.'); break; }
      const name = node.localName;
      if (name === 'img') {
        const img = node as HTMLImageElement;
        const picture = img.closest('picture');
        const responsive = picture || img.hasAttribute('srcset');
        const key = group(picture ?? img);
        add(img.currentSrc, base, 'dom', key, 'image', responsive ? undefined : img.naturalWidth,
          responsive ? undefined : img.naturalHeight);
        add(img.getAttribute('src'), base, 'dom', key, 'image');
        srcset(img.getAttribute('srcset'), base, 'srcset', key);
      } else if (name === 'source') {
        const picture = node.closest('picture');
        const video = node.closest('video');
        if (picture) srcset(node.getAttribute('srcset'), base, 'picture', group(picture));
        if (video) add(node.getAttribute('src'), base, 'dom', group(video), 'video');
      } else if (name === 'video') {
        const video = node as HTMLVideoElement;
        const key = group(video);
        add(video.currentSrc, base, 'dom', key, 'video', video.videoWidth, video.videoHeight);
        add(video.getAttribute('src'), base, 'dom', key, 'video');
        add(video.getAttribute('poster'), base, 'dom', undefined, 'image');
      } else if (name === 'a') {
        add(node.getAttribute('href'), base, 'dom');
      } else if (name === 'meta') {
        const tag = node.getAttribute('property') ?? node.getAttribute('name') ?? '';
        if (/^(?:og|twitter):(image|video)(?::(?:url|secure_url|src))?$/.test(tag)) {
          add(node.getAttribute('content'), base, 'metadata', undefined, tag.includes('image') ? 'image' : 'video');
        }
      } else if (name === 'iframe') {
        const frame = node as HTMLIFrameElement;
        if (frame.contentDocument) scan(frame.contentDocument);
        else warnings.add('Cross-origin or sandboxed frames were skipped.');
      }
      if (node.shadowRoot) scan(node.shadowRoot);
      const background = doc.defaultView?.getComputedStyle(node).backgroundImage ?? '';
      for (const match of background.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)) {
        add(match[1] ?? match[2] ?? match[3], base, 'css', undefined, 'image');
      }
    }
    for (const entry of doc.defaultView?.performance.getEntriesByType('resource').slice(-600) ?? []) {
      add(entry.name, base, 'performance');
    }
  }

  const collect = () => { roots.clear(); processed = 0; scan(document); };
  if (observeMs > 0) {
    await new Promise<void>(resolve => {
      const state = globalThis as typeof globalThis & { mediaHunterStop?: () => void };
      state.mediaHunterStop?.();
      let refresh: ReturnType<typeof setTimeout> | undefined;
      observer = new MutationObserver(() => {
        if (!refresh) refresh = setTimeout(() => { refresh = undefined; collect(); }, 300);
      });
      const timer = setTimeout(stop, Math.min(observeMs, 8000));
      function stop() {
        observer?.disconnect();
        clearTimeout(timer);
        clearTimeout(refresh);
        delete state.mediaHunterStop;
        resolve();
      }
      state.mediaHunterStop = stop;
      collect();
    });
  }
  collect();
  return { candidates: [...found.values()], warnings: [...warnings], pageOrigin: location.origin };
}
