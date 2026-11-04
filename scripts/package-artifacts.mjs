import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'release-artifacts');
const artifacts = (await readdir(directory, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name !== 'SHA256SUMS' && !entry.name.endsWith('.sha256'));
const sums = [];
for (const entry of artifacts) {
  const path = resolve(entry.parentPath, entry.name);
  const content = await readFile(path);
  const name = path.slice(directory.length + 1).replaceAll('\\', '/');
  sums.push(createHash('sha256').update(content).digest('hex') + '  ' + name);
}
await writeFile(resolve(directory, 'SHA256SUMS'), sums.sort().join('\n') + '\n');
console.log('Wrote checksums for ' + sums.length + ' artifacts.');
