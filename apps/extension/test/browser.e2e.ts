import { chromium, expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const savedAgentId = '0a207c3c-9d3b-4206-8a79-e22a37b16ab5';
type StoredPreferences = Record<string, { destinationProfileId: string }>;

test('MV3 popup discovers DOM variants and captures only its authorized fixture tab', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mediahunter-browser-'));
  const extension = join(directory, 'extension');
  await cp(resolve('apps/extension/dist'), extension, { recursive: true });
  const manifestPath = join(extension, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // The test build pregrants only its loopback fixture, allowing headless
  // automation to exercise the same production scripts without a permission UI.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  manifest.permissions.push('webRequest');
  await writeFile(manifestPath, JSON.stringify(manifest));
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    if (request.method === 'OPTIONS') { response.end(); return; }
    const path = new URL(request.url!, 'http://fixture').pathname;
    response.setHeader('Content-Type', 'application/json');
    if (path === '/api/v1/devices') {
      response.end(JSON.stringify([
        { id: 'aeb82f75-38e3-4bcf-bf1a-54ad41d9a268', name: 'Fixture agent', online: true, profiles: ['default'] },
        { id: savedAgentId, name: 'Saved fixture agent', online: true, profiles: ['default', 'archive'] },
      ]));
    } else if (path === '/api/v1/jobs') {
      response.end('[]');
    } else if (path === '/api/v1/scans') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const scan = JSON.parse(body);
      response.end(JSON.stringify({ id: randomUUID(), candidateIds: scan.candidates.map(() => randomUUID()) }));
    } else {
      try {
        const filename = path === '/' ? 'advanced.html' : path.slice(1);
        if (!/^[a-zA-Z0-9._/-]+$/.test(filename) || filename.includes('..')) throw new Error('invalid fixture path');
        const content = await readFile(resolve('fixtures', filename));
        const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.html': 'text/html', '.mp4': 'video/mp4' };
        response.setHeader('Content-Type', types[extname(filename)] ?? 'application/octet-stream');
        response.end(content);
      } catch { response.statusCode = 404; response.end(); }
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    channel: 'chromium', headless: true, viewport: { width: 420, height: 900 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const fixture = await context.newPage();
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/index.html?panel=1');
    await popup.evaluate(async values => {
      await chrome.storage.local.set(values);
    }, {
      connection: { origin, token: 'a'.repeat(64) },
      extensionPreferences: {
        [origin]: { hubOrigin: origin, targetAgentId: savedAgentId, destinationProfileId: 'archive' },
        'https://other.example.net': {
          hubOrigin: 'https://other.example.net', targetAgentId: '', destinationProfileId: 'default',
        },
      },
    });
    await popup.reload();
    await fixture.goto(origin);
    await fixture.bringToFront();
    await expect(popup.getByText('Hub online', { exact: true })).toBeVisible();
    await expect(popup.getByLabel('Windows agent')).toHaveValue(savedAgentId);
    await expect(popup.getByLabel('Destination')).toHaveValue('archive');
    await expect(popup.getByText('No active downloads. New jobs will appear here.')).toBeVisible();
    await expect(popup.getByRole('button', { name: /Active/ })).toBeVisible();
    await popup.getByLabel('Destination').selectOption('default');
    await expect.poll(async () => popup.evaluate(async hubOrigin =>
      ((await chrome.storage.local.get('extensionPreferences')).extensionPreferences as StoredPreferences)[hubOrigin]?.destinationProfileId, origin)).toBe('default');
    await popup.reload();
    await expect(popup.getByText('Hub online', { exact: true })).toBeVisible();
    await expect(popup.getByLabel('Windows agent')).toHaveValue(savedAgentId);
    await expect(popup.getByLabel('Destination')).toHaveValue('default');
    expect(await popup.evaluate(async () =>
      ((await chrome.storage.local.get('extensionPreferences')).extensionPreferences as StoredPreferences)['https://other.example.net']?.destinationProfileId)).toBe('default');
    await popup.getByRole('button', { name: 'Scan page', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(popup.getByRole('button', { name: 'Scan page', exact: true })).toBeEnabled({ timeout: 15_000 });
    await expect(popup.getByRole('heading', { name: /^Media /, level: 2 })).toBeVisible();
    await expect(popup.locator('article.media')).not.toHaveCount(0);
    await popup.screenshot({ path: test.info().outputPath('panel.png'), fullPage: true });
    await popup.getByRole('button', { name: 'Capture options' }).evaluate((button: HTMLButtonElement) => button.click());
    popup.on('dialog', dialog => { void dialog.accept(); });
    await popup.getByRole('button', { name: 'Reload and capture' }).evaluate((button: HTMLButtonElement) => button.click());
    await expect.poll(async () => {
      if (await popup.getByRole('button', { name: 'Stop scan', exact: true }).isVisible()) return 'capturing';
      return await popup.getByRole('alert').textContent({ timeout: 200 }).catch(() => 'waiting');
    }).toBe('capturing');
    await popup.getByRole('button', { name: 'Stop scan', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(popup.getByText(/Capture includes only requests/)).toBeVisible();
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
