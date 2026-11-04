import { z } from 'zod';

export const uuid = z.uuid();
export const kind = z.enum(['extension', 'windows_agent']);
export const sourceUrl = z.url({ protocol: /^https?$/ }).max(8192).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.hash;
});
export const origin = z.url({ protocol: /^https?$/ }).max(512).refine(value => new URL(value).origin === value);
export const candidate = z.object({
  url: sourceUrl,
  mediaType: z.enum(['image', 'video']),
  source: z.enum(['dom', 'srcset', 'picture', 'metadata', 'css', 'performance', 'network', 'site']),
  groupKey: z.string().max(100).optional(),
  delivery: z.enum(['direct', 'hls', 'dash', 'site']).optional(),
  format: z.string().regex(/^[a-z0-9]{1,12}$/).nullable(),
  width: z.number().int().positive().max(100000).nullable(),
  height: z.number().int().positive().max(100000).nullable(),
});
export type Candidate = z.infer<typeof candidate>;
export const scanInput = z.object({ pageOrigin: origin, candidates: z.array(candidate).max(200) });
export const claimInput = z.object({ kind, name: z.string().trim().min(1).max(60), code: z.string().regex(/^[0-9a-f]{16}$/) });
export const pairing = z.object({ id: uuid, token: z.string().regex(/^[0-9a-f]{64}$/) });
export const profileId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/);
export const formatId = z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/);
export const mediaFormat = z.object({
  id: formatId, width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
  fps: z.number().positive().nullable(), bitrate: z.number().positive().nullable(),
  hasAudio: z.boolean(), hasVideo: z.boolean(), format: z.string().max(20), estimatedBytes: z.number().int().positive().nullable(),
});
export const jobInput = z.object({
  candidateId: uuid, targetAgentId: uuid, idempotencyKey: uuid, destinationProfileId: profileId.default('default'),
  purpose: z.enum(['probe', 'download']).default('download'), requestedFormat: formatId.optional(),
});
export const jobState = z.enum(['queued', 'leased', 'downloading', 'completed', 'failed', 'canceled', 'paused', 'rescan_required']);
export const failure = z.enum(['DOWNLOAD_FAILED', 'HTTP_ERROR', 'EXPIRED_URL', 'UNSAFE_SOURCE', 'INVALID_MEDIA', 'SIZE_LIMIT', 'DESTINATION_ERROR', 'LEASE_LOST', 'TOOL_UNAVAILABLE', 'PROTECTED_MEDIA', 'UNSUPPORTED_FORMAT']);
export const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const job = z.object({ id: uuid, state: jobState, bytesDownloaded: bytes, errorCode: failure.nullable(),
  totalBytes: bytes.nullable().optional(), purpose: z.enum(['probe', 'download']).optional(), formats: z.array(mediaFormat).max(100).optional() });
export const agents = z.array(z.object({ id: uuid, name: z.string(), online: z.boolean(), profiles: z.array(profileId).max(20) }));
export const scanResult = z.object({ id: uuid, candidateIds: z.array(uuid) });
export const lease = z.object({
  id: uuid,
  leaseId: uuid,
  mediaType: candidate.shape.mediaType,
  url: sourceUrl,
  destinationProfileId: profileId,
  delivery: z.enum(['direct', 'hls', 'dash', 'site']), purpose: z.enum(['download', 'probe']), requestedFormat: formatId.nullable(),
});
export const leaseReport = z.object({ leaseId: uuid, bytesDownloaded: bytes.optional(), totalBytes: bytes.optional(), errorCode: failure.optional(), formats: z.array(mediaFormat).max(100).optional() });
export const error = z.object({ code: z.string() });
