import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../src/app.ts';
import { hash, openStore } from '../src/store.ts';

const directory = mkdtempSync(join(tmpdir(), 'mediahunter-test-'));
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test('pair, queue, recover an expired lease across restart, fence old workers and cancel', async () => {
  let time = Date.now();
  let store = openStore(directory);
  let app = await buildApp(store, [], () => time);
  const insert = store.db.prepare('INSERT INTO pairing_codes (hash,kind,expires) VALUES (?,?,?)');
  const base = '/api/v1';
  const post = (path: string, payload: object, token?: string) => app.inject({
    method: 'POST', url: base + path, payload, headers: token ? { authorization: 'Bearer ' + token } : {},
  });
  const pair = async (kind: string, code: string) => {
    const response = await post('/pairing/claim', { code, kind, name: kind });
    expect(response.statusCode).toBe(200);
    return response.json<{ id: string; token: string }>();
  };
  const extCode = '1111111111111111';
  const agentCode = '2222222222222222';
  const oldCode = '3333333333333333';
  try {
    insert.run(hash(extCode), 'extension', time + 600_000);
    insert.run(hash(agentCode), 'windows_agent', time + 600_000);
    insert.run(hash(oldCode), 'extension', time);
    const extension = await pair('extension', extCode);
    const agent = await pair('windows_agent', agentCode);
    for (const code of [extCode, oldCode]) {
      expect((await post('/pairing/claim', { code, kind: 'extension', name: 'same' })).statusCode).toBe(403);
    }
    expect((await post('/agent/jobs/lease', {}, extension.token)).statusCode).toBe(403);
    expect((await post('/scans', { pageOrigin: 'https://example.com', candidates: [{ url: 'file:///abc' }] }, extension.token)).statusCode).toBe(400);
    const url = 'https://example.com/sample.png?signature=fixture';
    const scan = await post('/scans', { pageOrigin: 'https://example.com', candidates: [
      { url, mediaType: 'image', source: 'dom', format: 'png', width: 64, height: 48 },
    ] }, extension.token);
    expect(scan.statusCode).toBe(200);
    const { candidateIds } = scan.json<{ candidateIds: string[] }>();
    expect(JSON.stringify(store.db.prepare('SELECT * FROM candidates').get())).not.toContain('signature=fixture');
    const input = { candidateId: candidateIds[0], targetAgentId: agent.id, idempotencyKey: randomUUID() };
    const added = await post('/jobs', input, extension.token);
    expect(added.statusCode).toBe(200);
    expect(await post('/jobs', input, extension.token)).toHaveProperty('body', added.body);
    const first = (await post('/agent/jobs/lease', {}, agent.token)).json<{ id: string; leaseId: string; url: string }>();
    expect(first.url).toBe(url);
    expect((await post('/agent/jobs/lease', {}, agent.token)).json()).toBeNull();
    await app.close();
    store.db.close();
    time += 46_000;
    store = openStore(directory);
    app = await buildApp(store, [], () => time);
    const next = (await post('/agent/jobs/lease', {}, agent.token)).json<typeof first>();
    expect(next.id).toBe(first.id);
    expect(next.leaseId).not.toBe(first.leaseId);
    const action = '/agent/jobs/' + first.id;
    expect((await post(action + '/complete', { leaseId: first.leaseId }, agent.token)).statusCode).toBe(409);
    expect((await post(action + '/heartbeat', { leaseId: next.leaseId, bytesDownloaded: 32 }, agent.token)).json()).toMatchObject({ state: 'downloading', bytesDownloaded: 32 });
    expect((await post('/jobs/' + first.id + '/cancel', {}, extension.token)).json()).toMatchObject({ state: 'canceled' });
    expect((await post(action + '/complete', { leaseId: next.leaseId }, agent.token)).statusCode).toBe(409);
    const history = await app.inject({ url: base + '/jobs', headers: { authorization: 'Bearer ' + extension.token } });
    expect(history.json()).toMatchObject([{ id: first.id, state: 'canceled' }]);
    expect(history.body).not.toContain('signature');
  } finally {
    await app.close();
    store.db.close();
  }
});
