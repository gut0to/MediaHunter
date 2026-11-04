import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = (await readdir(root)).filter(name => extname(name) === '.md').map(name => resolve(root, name));
for (const file of await readdir(resolve(root, 'docs'))) {
  if (extname(file) === '.md') files.push(resolve(root, 'docs', file));
}
let failed = false;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const reference = match[1].split('#')[0];
    if (!reference || /^[a-z][a-z0-9+.-]*:/i.test(reference)) continue;
    try { await access(resolve(dirname(file), decodeURIComponent(reference))); }
    catch { console.error('Broken relative link in ' + file + ' to ' + reference); failed = true; }
  }
}
if (failed) process.exitCode = 1;
else console.log('Relative documentation links are valid.');
