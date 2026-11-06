import { expect, test } from 'vitest';
import { parseExtensionPreferences, preferencesForHub, preferencesWithHub } from '../src/preferences';

test('parses saved preferences independently for each Hub', () => {
  const preference = { hubOrigin: 'https://hub.example.net',
    targetAgentId: 'aeb82f75-38e3-4bcf-bf1a-54ad41d9a268', destinationProfileId: 'archive' };
  expect(parseExtensionPreferences({ [preference.hubOrigin]: preference })).toEqual({ [preference.hubOrigin]: preference });
});

test('accepts an empty agent before the Hub discovers devices', () => {
  const preference = { hubOrigin: 'https://hub.example.net', targetAgentId: '', destinationProfileId: 'default' };
  expect(parseExtensionPreferences(preference)[preference.hubOrigin]?.targetAgentId).toBe('');
});

test('restores preferences only for the Hub that owns them', () => {
  const value = { 'https://hub.example.net': { hubOrigin: 'https://hub.example.net', targetAgentId: '', destinationProfileId: 'default' } };
  expect(preferencesForHub(value, 'https://hub.example.net')).toEqual(value['https://hub.example.net']);
  expect(preferencesForHub(value, 'https://other.example.net')).toBeUndefined();
});

test('upgrades a legacy preference and preserves other Hubs on save', () => {
  const first = { hubOrigin: 'https://hub.example.net', targetAgentId: '', destinationProfileId: 'default' };
  const second = { hubOrigin: 'https://other.example.net', targetAgentId: '', destinationProfileId: 'archive' };
  expect(preferencesWithHub(first, second)).toEqual({ [first.hubOrigin]: first, [second.hubOrigin]: second });
});

test('ignores malformed origins, agent IDs, profiles, and non-object values', () => {
  expect(parseExtensionPreferences(null)).toEqual({});
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net/path', targetAgentId: '', destinationProfileId: 'default' })).toEqual({});
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net', targetAgentId: 'agent', destinationProfileId: 'default' })).toEqual({});
  expect(parseExtensionPreferences({ hubOrigin: 'https://hub.example.net', targetAgentId: '', destinationProfileId: '../media' })).toEqual({});
  expect(parseExtensionPreferences({ 'https://hub.example.net': { hubOrigin: 'https://other.example.net', targetAgentId: '', destinationProfileId: 'default' } })).toEqual({});
});
