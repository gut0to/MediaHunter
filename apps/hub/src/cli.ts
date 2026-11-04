import { claimInput, uuid } from '@mediahunter/contracts';
import { buildApp } from './app.ts';
import { openStore, hash, secret } from './store.ts';

async function main() {
  process.umask(0o077);
  const store = openStore(process.env.MEDIAHUNTER_DATA_DIR ?? './mediahunter-data');
  const [command = 'serve', argument] = process.argv.slice(2);
  if (command === 'pair') {
    const kind = claimInput.shape.kind.parse(argument);
    const code = secret(8);
    store.db.prepare('INSERT INTO pairing_codes (hash,kind,expires) VALUES (?,?,?)').run(hash(code), kind, Date.now() + 600_000);
    console.log(code);
    store.db.close();
    return;
  }
  if (command === 'devices') {
    console.table(store.db.prepare('SELECT id,kind,name,revoked IS NOT NULL AS revoked FROM devices ORDER BY name').all());
    store.db.close();
    return;
  }
  if (command === 'revoke') {
    const id = uuid.parse(argument);
    store.db.transaction(() => {
      store.db.prepare('UPDATE devices SET revoked=? WHERE id=?').run(Date.now(), id);
      store.db.prepare("UPDATE jobs SET state='canceled', lease_id=NULL, lease_until=NULL, updated=? WHERE (owner=? OR agent=?) AND state IN ('queued','leased','downloading')")
        .run(Date.now(), id, id);
    }).immediate();
    store.db.close();
    return;
  }
  if (command !== 'serve') throw new Error('Unknown command');
  const origins = (process.env.MEDIAHUNTER_EXTENSION_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (origins.some(value => !/^chrome-extension:\/\/[a-p]{32}$/.test(value))) throw new Error('Invalid extension origin');
  const app = await buildApp(store, origins);
  const stop = async () => {
    await app.close();
    store.db.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log(await app.listen({
    host: process.env.MEDIAHUNTER_HOST ?? '127.0.0.1',
    port: Number(process.env.MEDIAHUNTER_PORT ?? '8787'),
  }));
}

main().catch(() => {
  console.error('MediaHunter Hub could not run the command. Check arguments, environment, port and data permissions.');
  process.exitCode = 1;
});
