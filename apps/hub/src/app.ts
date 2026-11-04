import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { agents, claimInput, job, jobInput, kind, lease, leaseReport, pairing, scanInput, scanResult, sourceUrl, uuid } from '@mediahunter/contracts';
import { hash, secret, type Store } from './store.ts';

const minute = 60_000;
const leaseDuration = 45_000;
const terminal = "('completed','failed','canceled','rescan_required')";
const publicJob = 'id, state, bytes_downloaded AS bytesDownloaded, error_code AS errorCode';

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function buildApp(store: Store, allowedOrigins: string[] = [], now = Date.now) {
  const { db } = store;
  const app = Fastify({ bodyLimit: 512 * 1024, logger: false });
  await app.register(cors, { origin: allowedOrigins, methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] });
  await app.register(rateLimit, { global: false });
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
      error_code=CASE WHEN attempts>=3 THEN 'LEASE_LOST' ELSE NULL END, bytes_downloaded=0,
      lease_id=NULL, lease_until=NULL, updated=? WHERE state IN ('leased','downloading') AND lease_until<=?`).run(time, time);
    db.prepare('DELETE FROM scans WHERE expires<=?').run(time);
    db.prepare('DELETE FROM pairing_codes WHERE expires<=?').run(time);
    db.prepare(`DELETE FROM jobs WHERE state IN ${terminal} AND updated<=?`).run(time - 30 * 24 * 60 * minute);
  });
  const timer = setInterval(() => clean.immediate(now()), minute);
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
    const rows = db.prepare("SELECT id,name,last_seen FROM devices WHERE kind='windows_agent' AND revoked IS NULL ORDER BY name LIMIT 100")
      .all() as { id: string; name: string; last_seen: number }[];
    return agents.parse(rows.map(row => ({ ...row, online: row.last_seen > now() - minute })));
  });

  app.post(path + '/scans', request => {
    const owner = authenticate(request, 'extension');
    const input = scanInput.parse(request.body);
    return db.transaction(() => {
      const time = now();
      const count = db.prepare('SELECT count(*) AS count FROM scans WHERE owner=? AND expires>?').get(owner, time) as { count: number };
      if (count.count >= 100) throw new ApiError(429, 'SCAN_LIMIT');
      const id = randomUUID();
      db.prepare('INSERT INTO scans VALUES (?,?,?,?)').run(id, owner, input.pageOrigin, time + 30 * minute);
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
      const existing = db.prepare(`SELECT ${publicJob}, candidate_id, agent FROM jobs WHERE owner=? AND idempotency_key=?`)
        .get(owner, input.idempotencyKey) as { candidate_id: string; agent: string } | undefined;
      if (existing) {
        if (existing.candidate_id !== input.candidateId || existing.agent !== input.targetAgentId) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        }
        return job.parse(existing);
      }
      const time = now();
      const source = db.prepare(`SELECT c.metadata FROM candidates c JOIN scans s ON s.id=c.scan_id
        WHERE c.id=? AND s.owner=? AND s.expires>?`).get(input.candidateId, owner, time) as { metadata: string } | undefined;
      if (!source) throw new ApiError(404, 'SCAN_EXPIRED_OR_MISSING');
      const agent = db.prepare("SELECT id FROM devices WHERE id=? AND kind='windows_agent' AND revoked IS NULL").get(input.targetAgentId);
      if (!agent) throw new ApiError(404, 'AGENT_NOT_FOUND');
      const count = db.prepare(`SELECT count(*) AS count FROM jobs WHERE owner=? AND state NOT IN ${terminal}`).get(owner) as { count: number };
      if (count.count >= 200) throw new ApiError(429, 'QUEUE_LIMIT');
      const id = randomUUID();
      db.prepare(`INSERT INTO jobs (id,owner,agent,candidate_id,media_type,idempotency_key,created,updated)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, owner, input.targetAgentId, input.candidateId, JSON.parse(source.metadata).mediaType, input.idempotencyKey, time, time);
      return job.parse({ id, state: 'queued', bytesDownloaded: 0, errorCode: null });
    }).immediate();
  });

  app.get(path + '/jobs', request => {
    const owner = authenticate(request, 'extension');
    clean.immediate(now());
    return z.array(job).parse(db.prepare(`SELECT ${publicJob} FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 200`).all(owner));
  });

  app.post(path + '/jobs/:id/cancel', request => {
    const owner = authenticate(request, 'extension');
    const { id } = z.object({ id: uuid }).parse(request.params);
    const changed = db.prepare(`UPDATE jobs SET state='canceled', lease_id=NULL, lease_until=NULL, updated=?
      WHERE id=? AND owner=? AND state NOT IN ${terminal}`).run(now(), id, owner);
    if (!changed.changes) throw new ApiError(409, 'JOB_NOT_CANCELABLE');
    return job.parse(db.prepare(`SELECT ${publicJob} FROM jobs WHERE id=?`).get(id));
  });

  app.post(path + '/agent/jobs/lease', request => {
    const agent = authenticate(request, 'windows_agent');
    const time = now();
    clean.immediate(time);
    return db.transaction(() => {
      if (db.prepare("SELECT 1 FROM jobs WHERE agent=? AND state IN ('leased','downloading')").get(agent)) return null;
      const next = db.prepare(`SELECT j.id,j.media_type,c.source FROM jobs j JOIN candidates c ON c.id=j.candidate_id
        WHERE j.agent=? AND j.state='queued' ORDER BY j.created LIMIT 1`).get(agent) as { id: string; media_type: 'image' | 'video'; source: string } | undefined;
      if (!next) return null;
      const leaseId = randomUUID();
      const url = sourceUrl.parse(store.decrypt(next.source));
      db.prepare("UPDATE jobs SET state='leased', lease_id=?, lease_until=?, attempts=attempts+1, updated=? WHERE id=?")
        .run(leaseId, time + leaseDuration, time, next.id);
      return lease.parse({ id: next.id, leaseId, mediaType: next.media_type, url, destinationProfileId: 'default' });
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
        lease_until=?, updated=? WHERE id=? AND agent=? AND lease_id=? AND
        (state IN ('leased','downloading') OR state=?)`).run(state, report.bytesDownloaded ?? null,
        action === 'fail' ? report.errorCode ?? 'DOWNLOAD_FAILED' : null, action === 'heartbeat' ? time + leaseDuration : null,
        time, id, agent, report.leaseId, state);
      if (!changed.changes) throw new ApiError(409, 'LEASE_LOST');
      return job.parse(db.prepare(`SELECT ${publicJob} FROM jobs WHERE id=?`).get(id));
    });
  }

  return app;
}
