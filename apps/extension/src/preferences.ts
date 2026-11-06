import { origin, profileId, uuid } from '@mediahunter/contracts';

export type ExtensionPreferences = {
  hubOrigin: string;
  targetAgentId: string;
  destinationProfileId: string;
};

export type ExtensionPreferenceStore = Record<string, ExtensionPreferences>;

function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { return origin.safeParse(value).success; }
  catch { return false; }
}

function parsePreference(value: unknown): ExtensionPreferences | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!isOrigin(record.hubOrigin)) return undefined;
  if (typeof record.targetAgentId !== 'string' ||
    (record.targetAgentId !== '' && !uuid.safeParse(record.targetAgentId).success)) return undefined;
  if (!profileId.safeParse(record.destinationProfileId).success) return undefined;
  return {
    hubOrigin: record.hubOrigin as string,
    targetAgentId: record.targetAgentId,
    destinationProfileId: record.destinationProfileId as string,
  };
}

export function parseExtensionPreferences(value: unknown): ExtensionPreferenceStore {
  const legacy = parsePreference(value);
  if (legacy) return { [legacy.hubOrigin]: legacy };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const preferences: ExtensionPreferenceStore = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isOrigin(key)) continue;
    const parsed = parsePreference(item);
    if (parsed?.hubOrigin === key) preferences[key] = parsed;
  }
  return preferences;
}

export function preferencesForHub(value: unknown, hubOrigin: string): ExtensionPreferences | undefined {
  return parseExtensionPreferences(value)[hubOrigin];
}

export function preferencesWithHub(value: unknown, preferences: ExtensionPreferences): ExtensionPreferenceStore {
  return { ...parseExtensionPreferences(value), [preferences.hubOrigin]: preferences };
}
