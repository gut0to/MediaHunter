import { expect, test } from 'vitest';
import type { Candidate } from '@mediahunter/contracts';
import { groupVariants } from '../src/quality';

test('groups only related variants and ranks known pixel dimensions ahead of unknown values', () => {
  const make = (url: string, width: number | null, height: number | null, groupKey?: string): Candidate =>
    ({ url, width, height, groupKey, mediaType: 'image', format: 'png', source: 'srcset' });
  const items = [make('https://example.com/a.png', null, null, 'picture'),
    make('https://example.com/a-large.png', 1600, 900, 'picture'),
    make('https://example.com/separate.png', 20, 20)];
  const groups = groupVariants(items);
  expect(groups).toHaveLength(2);
  expect(groups[0].variants[0].url).toBe(items[1].url);
  expect(groups[1].variants[0].width).toBe(20);
});
