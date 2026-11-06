import { expect, test } from 'vitest';
import { parseExtensionPreferences, preferencesForHub } from '../src/preferences';

test('parses a complete saved agent and destination for one Hub', () => {
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net',
    targetAgentId: 'aeb82f75-38e3-4bcf-bf1a-54ad41d9a268', destinationProfileId: 'archive' })).toEqual({
    hubOrigin: 'https://hub.example.net', targetAgentId: 'aeb82f75-38e3-4bcf-bf1a-54ad41d9a268', destinationProfileId: 'archive',
  });
});

test('accepts an empty agent before the Hub discovers devices', () => {
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net', targetAgentId: '', destinationProfileId: 'default' })?.targetAgentId).toBe('');
});

test('restores preferences only for the Hub that owns them', () => {
  const value = { hubOrigin: 'https://hub.example.net', targetAgentId: '', destinationProfileId: 'default' };
  expect(preferencesForHub(value, 'https://hub.example.net')).toEqual(value);
  expect(preferencesForHub(value, 'https://other.example.net')).toBeUndefined();
});

test('ignores malformed origins, agent IDs, profiles, and non-object values', () => {
  expect(parseExtensionPreferences(null)).toBeUndefined();
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net/path', targetAgentId: '', destinationProfileId: 'default' })).toBeUndefined();
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net', targetAgentId: 'agent', destinationProfileId: 'default' })).toBeUndefined();
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net', targetAgentId: '', destinationProfileId: '../media' })).toBeUndefined();
});
