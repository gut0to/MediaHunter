import { expect, test } from 'vitest';
import { configuration } from '../src/config.ts';

test('defaults to loopback and rejects public or malformed bind configuration', () => {
  expect(configuration.parse({}).MEDIAHUNTER_HOST).toBe('127.0.0.1');
  for (const input of [{ MEDIAHUNTER_HOST: '0.0.0.0' }, { MEDIAHUNTER_PORT: 'invalid' },
    { MEDIAHUNTER_SOURCE_TTL_MINUTES: 999 }, { MEDIAHUNTER_HISTORY_DAYS: 0 }]) {
    expect(configuration.safeParse(input).success).toBe(false);
  }
});
