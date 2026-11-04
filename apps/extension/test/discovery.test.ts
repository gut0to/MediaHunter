// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { discover } from '../src/discovery';

test('finds CSS, posters, open shadow roots and responsive groups without inventing dimensions', async () => {
  document.head.innerHTML = '<base href="https://example.com/">';
  document.body.innerHTML = '<picture><source srcset="a.webp 1x, a-large.webp 2x"><img src="a.webp"></picture><video poster="poster.jpg" src="master.m3u8"></video><div style="background-image:url(bg.png)"></div><div id="shadow"></div>';
  document.querySelector('#shadow')!.attachShadow({ mode: 'open' }).innerHTML = '<img src="shadow.png">';
  const result = await discover();
  expect(result.candidates.map(item => new URL(item.url).pathname)).toEqual(expect.arrayContaining(['/a.webp', '/a-large.webp', '/poster.jpg', '/master.m3u8', '/bg.png', '/shadow.png']));
  const image = result.candidates.find(item => item.url.endsWith('/a.webp'))!;
  expect(image.groupKey).toBe(result.candidates.find(item => item.url.endsWith('/a-large.webp'))?.groupKey);
  expect(image.width).toBeNull();
  expect(result.candidates.find(item => item.url.endsWith('/master.m3u8'))?.delivery).toBe('hls');
});

test('observes bounded lazy changes', async () => {
  document.body.innerHTML = '<div id="lazy"></div>';
  const result = discover(50);
  document.querySelector('#lazy')!.innerHTML = '<img src="https://example.com/lazy.png">';
  expect((await result).candidates.some(item => item.url.endsWith('lazy.png'))).toBe(true);
});

test('bounds a page with more than 500 images', async () => {
  document.body.innerHTML=Array.from({length:600},(_,index)=>'<img src="https://example.com/image-'+index+'.png">').join('');
  const result=await discover();
  expect(result.candidates).toHaveLength(200);
  expect(result.warnings).toContain('Scan reached its page or result limit.');
});
