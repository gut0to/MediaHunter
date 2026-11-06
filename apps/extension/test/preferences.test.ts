import { expect, test } from 'vitest';
import { parseExtensionPreferences } from '../src/preferences';

test('parses a complete saved agent and destination for one Hub', () => {
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net',
    targetAgentId: 'aeb82f75-38e3-4bcf-bf1a-54ad41d9a268', destinationProfileId: 'archive' })).toEqual({
    hubOrigin: 'https://hub.example.net', targetAgentId: 'aeb82f75-38e3-4bcf-bf1a-54ad41d9a268', destinationProfileId: 'archive',
  });
});
