import { origin, profileId, uuid } from '@mediahunter/contracts';

export type ExtensionPreferences = {
  hubOrigin: string;
  targetAgentId: string;
  destinationProfileId: string;
};

export function parseExtensionPreferences(value: unknown): ExtensionPreferences | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!origin.safeParse(record.hubOrigin).success) return undefined;
  if (typeof record.targetAgentId !== 'string' ||
    (record.targetAgentId !== '' && !uuid.safeParse(record.targetAgentId).success)) return undefined;
  if (!profileId.safeParse(record.destinationProfileId).success) return undefined;
  return {
    hubOrigin: record.hubOrigin as string,
    targetAgentId: record.targetAgentId,
    destinationProfileId: record.destinationProfileId as string,
  };
}

export function preferencesForHub(value: unknown, hubOrigin: string): ExtensionPreferences | undefined {
  const preferences = parseExtensionPreferences(value);
  return preferences?.hubOrigin === hubOrigin ? preferences : undefined;
}
