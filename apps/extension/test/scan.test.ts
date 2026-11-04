// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { scanPage } from '../src/scan';

test('finds direct DOM sources and variants, deduplicates and rejects manifest or blob URLs', () => {
  document.head.innerHTML = '<base href="https://media.example/"><meta property="og:image" content="preview.png">';
  document.body.innerHTML = `
    <picture><source srcset="wide.webp 2x, normal.webp 1x"><img src="preview.png#duplicate"></picture>
    <video src="blob:https://media.example/a"><source src="video.mp4"><source src="master.m3u8"></video>
    <a href="/full.jpg">Original</a><a href="https://secret@media.example/private.jpg">Private</a>`;
  expect(scanPage().map(item => [new URL(item.url).pathname, item.mediaType])).toEqual([
    ['/preview.png', 'image'], ['/wide.webp', 'image'], ['/normal.webp', 'image'],
    ['/video.mp4', 'video'], ['/full.jpg', 'image'],
  ]);
  expect(scanPage().every(item => item.width === null && item.height === null)).toBe(true);
});
