import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = (size: number) => randomBytes(size).toString('hex');

export function openStore(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyPath = join(directory, 'source.key');
  try {
    writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('Invalid source encryption key');

  const db = new Database(join(directory, 'mediahunter.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.transaction(() => {
    const version = db.pragma('user_version', { simple: true }) as number;
    const migrations = ['./db/001.sql', './db/002.sql'];
    if (version > migrations.length) throw new Error('Database was created by a newer Hub');
    for (const [index, migration] of migrations.entries()) {
      if (index < version) continue;
      db.exec(readFileSync(new URL(migration, import.meta.url), 'utf8'));
      db.pragma('user_version = ' + (index + 1));
    }
  }).immediate();

  return {
    db,
    encrypt(value: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    decrypt(value: string) {
      const data = Buffer.from(value, 'base64');
      const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
    },
  };
}

export type Store = ReturnType<typeof openStore>;
