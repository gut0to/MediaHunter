import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hash, openStore } from '../src/store.ts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

async function setup() {
  let time = Date.now();
  const directory = mkdtempSync(join(tmpdir(), 'mediahunter-scheduling-'));
  directories.push(directory);
  const store = openStore(directory);
  const extension = { id: randomUUID(), token: 'a'.repeat(64) };
  const agent = { id: randomUUID(), token: 'b'.repeat(64) };
  const insert = store.db.prepare('INSERT INTO devices (id,kind,name,token_hash,last_seen) VALUES (?,?,?,?,?)');
  insert.run(extension.id, 'extension', 'Extension', hash(extension.token), time);
  insert.run(agent.id, 'windows_agent', 'Agent', hash(agent.token), time);
  const app = await buildApp(store, [], () => time);
  const post = (path: string, payload: object, token = extension.token) => app.inject({
    method: 'POST', url: '/api/v1' + path, payload, headers: { authorization: 'Bearer ' + token },
  });
  const scan = await post('/scans', { pageOrigin: 'https://example.com', candidates: [
    { url: 'https://example.com/media.png', mediaType: 'image', source: 'dom', format: 'png', width: 64, height: 48 },
  ] });
  const candidateId = scan.json<{ candidateIds: string[] }>().candidateIds[0];
  const queue = async (priority: 'low' | 'normal' | 'high') => (await post('/jobs', {
    candidateId, targetAgentId: agent.id, idempotencyKey: randomUUID(), priority,
  })).json<{ id: string }>();
  return { app, store, agent, post, queue, advance: (milliseconds: number) => { time += milliseconds; } };
}

test('leases high priority work before older normal and low jobs', async () => {
  const fixture = await setup();
  try {
    const low = await fixture.queue('low');
    const normal = await fixture.queue('normal');
    const high = await fixture.queue('high');
    const first = (await fixture.post('/agent/jobs/lease', {}, fixture.agent.token)).json<{ id: string }>();
    const second = (await fixture.post('/agent/jobs/lease', {}, fixture.agent.token)).json<{ id: string }>();
    expect([first.id, second.id]).toEqual([high.id, normal.id]);
    expect(first.id).not.toBe(low.id);
  } finally {
    await fixture.app.close();
    fixture.store.db.close();
  }
});

test('holds a transient failure until its retry window opens', async () => {
  const fixture = await setup();
  try {
    const queued = await fixture.queue('normal');
    const lease = (await fixture.post('/agent/jobs/lease', {}, fixture.agent.token)).json<{ id: string; leaseId: string }>();
    const failed = await fixture.post('/agent/jobs/' + lease.id + '/fail', {
      leaseId: lease.leaseId, errorCode: 'HTTP_ERROR', bytesDownloaded: 512, totalBytes: 1024,
    }, fixture.agent.token);
    expect(failed.json()).toMatchObject({ id: queued.id, state: 'queued', attempts: 1,
      errorCode: 'HTTP_ERROR', bytesDownloaded: 0, totalBytes: null });
    expect((await fixture.post('/agent/jobs/lease', {}, fixture.agent.token)).json()).toBeNull();
    fixture.advance(5_000);
    expect((await fixture.post('/agent/jobs/lease', {}, fixture.agent.token)).json()).toMatchObject({ id: queued.id });
  } finally {
    await fixture.app.close();
    fixture.store.db.close();
  }
});

test('keeps permanent failures terminal instead of retrying them', async () => {
  const fixture = await setup();
  try {
    await fixture.queue('normal');
    const lease = (await fixture.post('/agent/jobs/lease', {}, fixture.agent.token)).json<{ id: string; leaseId: string }>();
    const failed = await fixture.post('/agent/jobs/' + lease.id + '/fail', {
      leaseId: lease.leaseId, errorCode: 'DESTINATION_ERROR',
    }, fixture.agent.token);
    expect(failed.json()).toMatchObject({ state: 'failed', attempts: 1, errorCode: 'DESTINATION_ERROR', nextAttemptAt: null });
    fixture.advance(60_000);
    expect((await fixture.post('/agent/jobs/lease', {}, fixture.agent.token)).json()).toBeNull();
  } finally {
    await fixture.app.close();
    fixture.store.db.close();
  }
});
