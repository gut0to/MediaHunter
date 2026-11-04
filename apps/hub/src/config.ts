import { z } from 'zod';

const boundedInteger = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

export const configuration = z.object({
  MEDIAHUNTER_HOST: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
  MEDIAHUNTER_PORT: boundedInteger(8787, 1024, 65535),
  MEDIAHUNTER_DATA_DIR: z.string().min(1).default('./mediahunter-data'),
  MEDIAHUNTER_SOURCE_TTL_MINUTES: boundedInteger(30, 5, 120),
  MEDIAHUNTER_HISTORY_DAYS: boundedInteger(30, 1, 365),
  MEDIAHUNTER_EXTENSION_ORIGINS: z.string().default(''),
});
