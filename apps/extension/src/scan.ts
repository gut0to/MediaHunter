import type { Candidate } from '@mediahunter/contracts';

// Chrome serializes this function into the active tab. Keep all runtime dependencies inside it.
export function scanPage(): Candidate[] {
  const results = new Map<string, Candidate>();
  const images = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$)/i;
  const videos = /\.(mp4|webm|mov|m4v|ogv)(?:$)/i;
  function add(raw: string | null, source: Candidate['source'], type?: Candidate['mediaType'], width = 0, height = 0) {
    if (!raw || results.size >= 200) return;
    let url: URL;
    try { url = new URL(raw, document.baseURI); } catch { return; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
    url.hash = '';
    if (url.href.length > 8192) return;
    const format = (images.exec(url.pathname)?.[1] ?? videos.exec(url.pathname)?.[1])?.toLowerCase() ?? null;
    const mediaType = type ?? (images.test(url.pathname) ? 'image' : videos.test(url.pathname) ? 'video' : null);
    if (!mediaType || /\.(m3u8|mpd)$/i.test(url.pathname)) return;
    const previous = results.get(url.href);
    if (previous && (!width || previous.width)) return;
    results.set(url.href, { url: url.href, source, mediaType, format, width: width || null, height: height || null });
  }

  function addSrcset(value: string | null, source: 'srcset' | 'picture') {
    // URL tokens can include commas (for example in signed query values).
    const tokens = value?.matchAll(/[^\s,][^\s]*(?:\s+[^,]*)?/g) ?? [];
    for (const [token] of tokens) {
      add(token.trim().split(/\s+/, 1)[0].replace(/,+$/, ''), source, 'image');
    }
  }

  for (const element of document.querySelectorAll('img, picture source, video, video source, a[href], meta[property]')) {
    if (results.size >= 200) break;
    if (element instanceof HTMLImageElement) {
      const responsive = element.hasAttribute('srcset') || element.closest('picture');
      add(element.currentSrc, 'dom', 'image', responsive ? 0 : element.naturalWidth, responsive ? 0 : element.naturalHeight);
      add(element.getAttribute('src'), 'dom', 'image');
      addSrcset(element.getAttribute('srcset'), 'srcset');
    } else if (element instanceof HTMLVideoElement) {
      add(element.currentSrc, 'dom', 'video', element.videoWidth, element.videoHeight);
      add(element.getAttribute('src'), 'dom', 'video');
    } else if (element instanceof HTMLSourceElement) {
      if (element.closest('picture')) addSrcset(element.getAttribute('srcset'), 'picture');
      else if (!/mpegurl|dash\+xml/i.test(element.type)) add(element.getAttribute('src'), 'dom', 'video');
    } else if (element instanceof HTMLAnchorElement) {
      add(element.getAttribute('href'), 'dom');
    } else if (element instanceof HTMLMetaElement) {
      const property = element.getAttribute('property') ?? '';
      if (/^og:(image|video)(?::(?:url|secure_url))?$/.test(property)) {
        add(element.content, 'metadata', property.startsWith('og:image') ? 'image' : 'video');
      }
    }
  }
  return [...results.values()];
}
