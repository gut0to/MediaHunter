import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { agents, candidate, claimInput, job, jobInput, kind, lease, leaseReport, pairing, profileId, scanInput, scanResult, sourceUrl, uuid } from '@mediahunter/contracts';
import { hash, secret, type Store } from './store.ts';

const minute = 60_000;
const leaseDuration = 45_000;
const terminal = "('completed','failed','canceled','rescan_required')";
const publicJob = 'id, state, bytes_downloaded AS bytesDownloaded, error_code AS errorCode, total_bytes AS totalBytes, purpose, formats_json';
const formatJob = (value: unknown) => {
  const row = value as { formats_json?: string };
  return job.parse({ ...row, formats: row.formats_json ? JSON.parse(row.formats_json) : undefined });
};

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function buildApp(store: Store, allowedOrigins: string[] = [], now = Date.now,
  retention = { sourceTTL: 30 * minute, historyTTL: 30 * 24 * 60 * minute }) {
  const { db } = store;
  const app = Fastify({ bodyLimit: 512 * 1024, logger: false, requestTimeout: 15_000, connectionTimeout: 15_000 });
  await app.register(cors, { origin: allowedOrigins, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: minute });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ code: error.code });
    if (error instanceof z.ZodError) return reply.code(400).send({ code: 'INVALID_REQUEST' });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ code: status === 429 ? 'RATE_LIMITED' : status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR' });
  });

  const clean = db.transaction((time: number) => {
    db.prepare(`UPDATE jobs SET state='rescan_required', error_code='EXPIRED_URL', updated=?, lease_id=NULL, lease_until=NULL
      WHERE state NOT IN ${terminal} AND candidate_id IN
      (SELECT c.id FROM candidates c JOIN scans s ON s.id=c.scan_id WHERE s.expires<=?)`).run(time, time);
    db.prepare(`UPDATE jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
      error_code=CASE WHEN attempts>=3 THEN 'LEASE_LOST' ELSE NULL END, bytes_downloaded=0, total_bytes=NULL,
      lease_id=NULL, lease_until=NULL, updated=? WHERE state IN ('leased','downloading') AND lease_until<=?`).run(time, time);
    db.prepare('DELETE FROM scans WHERE expires<=?').run(time);
    db.prepare('DELETE FROM pairing_codes WHERE expires<=?').run(time);
    db.prepare(`DELETE FROM jobs WHERE state IN ${terminal} AND updated<=?`).run(time - retention.historyTTL);
  });
  const timer = setInterval(() => {
    try { clean.immediate(now()); } catch { console.error(JSON.stringify({ event: 'retention_failed' })); }
  }, minute);
  timer.unref();
  app.addHook('onClose', () => clearInterval(timer));

  function authenticate(request: FastifyRequest, role: z.infer<typeof kind>) {
    const match = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.authorization ?? '');
    const device = match && db.prepare('SELECT id, kind FROM devices WHERE token_hash=? AND revoked IS NULL')
      .get(hash(match[1])) as { id: string; kind: string } | null | undefined;
    if (!device) throw new ApiError(401, 'UNAUTHORIZED');
    if (device.kind !== role) throw new ApiError(403, 'ACCESS_DENIED');
    db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(now(), device.id);
    return device.id;
  }

  const path = '/api/v1';
  app.get(path + '/health', () => ({ status: 'ok' }));

  app.post(path + '/pairing/claim', { config: { rateLimit: { max: 12, timeWindow: minute } } }, request => {
    const input = claimInput.parse(request.body);
    return db.transaction(() => {
      const time = now();
      const consumed = db.prepare('UPDATE pairing_codes SET consumed=? WHERE hash=? AND kind=? AND consumed IS NULL AND expires>?')
        .run(time, hash(input.code), input.kind, time);
      if (!consumed.changes) throw new ApiError(403, 'INVALID_PAIRING_CODE');
      const id = randomUUID();
      const token = secret(32);
      db.prepare('INSERT INTO devices (id,kind,name,token_hash,last_seen) VALUES (?,?,?,?,?)')
        .run(id, input.kind, input.name, hash(token), 0);
      return pairing.parse({ id, token });
    }).immediate();
  });

  app.get(path + '/devices', request => {
    authenticate(request, 'extension');
    const rows = db.prepare("SELECT id,name,last_seen,profiles_json FROM devices WHERE kind='windows_agent' AND revoked IS NULL ORDER BY name LIMIT 100")
      .all() as { id: string; name: string; last_seen: number; profiles_json: string }[];
    return agents.parse(rows.map(row => ({ ...row, online: row.last_seen > now() - minute, profiles: JSON.parse(row.profiles_json) })));
  });

  app.post(path + '/scans', request => {
    const owner = authenticate(request, 'extension');
    const input = scanInput.parse(request.body);
    return db.transaction(() => {
      const time = now();
      const count = db.prepare('SELECT count(*) AS count FROM scans WHERE owner=? AND expires>?').get(owner, time) as { count: number };
      if (count.count >= 100) throw new ApiError(429, 'SCAN_LIMIT');
      const id = randomUUID();
      db.prepare('INSERT INTO scans VALUES (?,?,?,?)').run(id, owner, input.pageOrigin, time + retention.sourceTTL);
      const insert = db.prepare('INSERT INTO candidates VALUES (?,?,?,?)');
      const candidateIds = input.candidates.map(({ url, ...metadata }) => {
        const candidateId = randomUUID();
        insert.run(candidateId, id, JSON.stringify(metadata), store.encrypt(url));
        return candidateId;
      });
      return scanResult.parse({ id, candidateIds });
    }).immediate();
  });

  app.post(path + '/jobs', request => {
    const owner = authenticate(request, 'extension');
    const input = jobInput.parse(request.body);
    return db.transaction(() => {
      const existing = db.prepare(`SELECT ${publicJob}, candidate_id, agent, purpose, requested_format, destination_profile_id FROM jobs WHERE owner=? AND idempotency_key=?`)
        .get(owner, input.idempotencyKey) as { candidate_id: string; agent: string; purpose: string; requested_format: string | null; destination_profile_id: string } | undefined;
      if (existing) {
        if (existing.candidate_id !== input.candidateId || existing.agent !== input.targetAgentId || existing.purpose !== input.purpose ||
          existing.requested_format !== (input.requestedFormat ?? null) || existing.destination_profile_id !== input.destinationProfileId) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        }
        return formatJob(existing);
      }
      const time = now();
      const source = db.prepare(`SELECT c.metadata FROM candidates c JOIN scans s ON s.id=c.scan_id
        WHERE c.id=? AND s.owner=? AND s.expires>?`).get(input.candidateId, owner, time) as { metadata: string } | undefined;
      if (!source) throw new ApiError(404, 'SCAN_EXPIRED_OR_MISSING');
      const agent = db.prepare("SELECT profiles_json FROM devices WHERE id=? AND kind='windows_agent' AND revoked IS NULL").get(input.targetAgentId) as { profiles_json: string } | undefined;
      if (!agent) throw new ApiError(404, 'AGENT_NOT_FOUND');
      if (!z.array(profileId).parse(JSON.parse(agent.profiles_json)).includes(input.destinationProfileId)) {
        throw new ApiError(400, 'DESTINATION_NOT_AVAILABLE');
      }
      const metadata = candidate.omit({ url: true }).parse(JSON.parse(source.metadata));
      if ((metadata.delivery ?? 'direct') === 'direct' && (input.purpose === 'probe' || input.requestedFormat)) {
        throw new ApiError(400, 'INVALID_MEDIA_OPERATION');
      }
      const count = db.prepare(`SELECT count(*) AS count FROM jobs WHERE owner=? AND state NOT IN ${terminal}`).get(owner) as { count: number };
      if (count.count >= 200) throw new ApiError(429, 'QUEUE_LIMIT');
      const id = randomUUID();
      db.prepare(`INSERT INTO jobs (id,owner,agent,candidate_id,media_type,idempotency_key,created,updated,delivery,purpose,requested_format,destination_profile_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, owner, input.targetAgentId, input.candidateId, metadata.mediaType,
          input.idempotencyKey, time, time, metadata.delivery ?? 'direct', input.purpose, input.requestedFormat ?? null, input.destinationProfileId);
      return formatJob(db.prepare(`SELECT ${publicJob} FROM jobs WHERE id=?`).get(id));
    }).immediate();
  });

  app.get(path + '/jobs', request => {
    const owner = authenticate(request, 'extension');
    clean.immediate(now());
    return db.prepare(`SELECT ${publicJob} FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 200`).all(owner).map(formatJob);
  });

  app.post(path + '/jobs/:id/cancel', request => {
    const owner = authenticate(request, 'extension');
    const { id } = z.object({ id: uuid }).parse(request.params);
    const changed = db.prepare(`UPDATE jobs SET state='canceled', lease_id=NULL, lease_until=NULL, updated=?
      WHERE id=? AND owner=? AND state NOT IN ${terminal}`).run(now(), id, owner);
    if (!changed.changes) throw new ApiError(409, 'JOB_NOT_CANCELABLE');
    return formatJob(db.prepare(`SELECT ${publicJob} FROM jobs WHERE id=?`).get(id));
  });

  for (const action of ['pause', 'retry'] as const) {
    app.post(path + '/jobs/:id/' + action, request => {
      const owner = authenticate(request, 'extension');
      const { id } = z.object({ id: uuid }).parse(request.params);
      const time = now();
      clean.immediate(time);
      const changed = action === 'pause'
        ? db.prepare("UPDATE jobs SET state='paused',lease_id=NULL,lease_until=NULL,updated=? WHERE id=? AND owner=? AND state IN ('queued','leased','downloading')").run(time, id, owner)
        : db.prepare(`UPDATE jobs SET state='queued',attempts=0,bytes_downloaded=0,total_bytes=NULL,error_code=NULL,formats_json=NULL,
          lease_id=NULL,lease_until=NULL,updated=? WHERE id=? AND owner=? AND state IN ('paused','failed') AND candidate_id IN
          (SELECT c.id FROM candidates c JOIN scans s ON s.id=c.scan_id WHERE s.expires>?)`).run(time, id, owner, time);
      if (!changed.changes) throw new ApiError(409, 'JOB_ACTION_UNAVAILABLE');
      return formatJob(db.prepare(`SELECT ${publicJob} FROM jobs WHERE id=?`).get(id));
    });
  }

  app.delete(path + '/jobs', request => {
    const owner = authenticate(request, 'extension');
    const result = db.prepare(`DELETE FROM jobs WHERE owner=? AND state IN ${terminal}`).run(owner);
    return { removed: result.changes };
  });

  app.post(path + '/jobs/:id/open', request => {
    const owner = authenticate(request, 'extension');
    const { id } = z.object({ id: uuid }).parse(request.params);
    const { action } = z.object({ action: z.enum(['file', 'folder']) }).parse(request.body);
    return db.transaction(() => {
      const row = db.prepare("SELECT agent FROM jobs WHERE id=? AND owner=? AND state='completed' AND purpose='download'").get(id, owner) as { agent: string } | undefined;
      if (!row) throw new ApiError(404, 'COMPLETED_DOWNLOAD_NOT_FOUND');
      const pending = db.prepare('SELECT count(*) AS count FROM device_actions WHERE agent=? AND consumed IS NULL AND created>?').get(row.agent, now() - minute) as { count: number };
      if (pending.count >= 20) throw new ApiError(429, 'ACTION_LIMIT');
      db.prepare('INSERT INTO device_actions (id,job_id,agent,action,created) VALUES (?,?,?,?,?)')
        .run(randomUUID(), id, row.agent, action, now());
      return { requested: true };
    }).immediate();
  });

  app.post(path + '/agent/actions/lease', request => {
    const agent = authenticate(request, 'windows_agent');
    return db.transaction(() => {
      const time = now();
      db.prepare('DELETE FROM device_actions WHERE created<?').run(time - minute);
      const next = db.prepare(`SELECT a.id,a.job_id AS jobId,a.action FROM device_actions a JOIN jobs j ON j.id=a.job_id
        WHERE a.agent=? AND a.consumed IS NULL AND j.state='completed' AND j.purpose='download' ORDER BY a.created LIMIT 1`)
        .get(agent) as { id: string; jobId: string; action: 'file' | 'folder' } | undefined;
      if (!next) return null;
      db.prepare('UPDATE device_actions SET consumed=? WHERE id=?').run(time, next.id);
      return next;
    }).immediate();
  });

  app.post(path + '/agent/jobs/lease', request => {
    const agent = authenticate(request, 'windows_agent');
    const time = now();
    clean.immediate(time);
    return db.transaction(() => {
      const profiles = z.object({ profiles: z.array(profileId).min(1).max(20).default(['default']) }).parse(request.body ?? {});
      db.prepare('UPDATE devices SET profiles_json=? WHERE id=?').run(JSON.stringify(profiles.profiles), agent);
      const active = db.prepare("SELECT count(*) AS count FROM jobs WHERE agent=? AND state IN ('leased','downloading')").get(agent) as { count: number };
      if (active.count >= 2) return null;
      const next = db.prepare(`SELECT j.id,j.media_type,j.delivery,j.purpose,j.requested_format,j.destination_profile_id,c.source FROM jobs j JOIN candidates c ON c.id=j.candidate_id
        WHERE j.agent=? AND j.state='queued' ORDER BY j.created LIMIT 1`).get(agent) as { id: string; media_type: 'image' | 'video'; source: string; delivery: string; purpose: string; requested_format: string | null; destination_profile_id: string } | undefined;
      if (!next) return null;
      const leaseId = randomUUID();
      const url = sourceUrl.parse(store.decrypt(next.source));
      db.prepare("UPDATE jobs SET state='leased', lease_id=?, lease_until=?, attempts=attempts+1, updated=? WHERE id=?")
        .run(leaseId, time + leaseDuration, time, next.id);
      return lease.parse({ id: next.id, leaseId, mediaType: next.media_type, url, destinationProfileId: next.destination_profile_id,
        delivery: next.delivery, purpose: next.purpose, requestedFormat: next.requested_format });
    }).immediate();
  });

  for (const action of ['heartbeat', 'complete', 'fail'] as const) {
    app.post(path + '/agent/jobs/:id/' + action, request => {
      const agent = authenticate(request, 'windows_agent');
      const { id } = z.object({ id: uuid }).parse(request.params);
      const report = leaseReport.parse(request.body);
      const time = now();
      clean.immediate(time);
      const state = action === 'heartbeat' ? 'downloading' : action === 'complete' ? 'completed' :
        report.errorCode === 'EXPIRED_URL' ? 'rescan_required' : 'failed';
      const changed = db.prepare(`UPDATE jobs SET state=?, bytes_downloaded=COALESCE(?, bytes_downloaded), error_code=?,
        lease_until=?, updated=?, formats_json=COALESCE(?, formats_json), total_bytes=COALESCE(?, total_bytes) WHERE id=? AND agent=? AND lease_id=? AND
        (state IN ('leased','downloading') OR state=?)`).run(state, report.bytesDownloaded ?? null,
        action === 'fail' ? report.errorCode ?? 'DOWNLOAD_FAILED' : null, action === 'heartbeat' ? time + leaseDuration : null,
        time, action === 'complete' && report.formats ? JSON.stringify(report.formats) : null, report.totalBytes ?? null, id, agent, report.leaseId, state);
      if (!changed.changes) throw new ApiError(409, 'LEASE_LOST');
      return formatJob(db.prepare(`SELECT ${publicJob} FROM jobs WHERE id=?`).get(id));
    });
  }

  return app;
}
