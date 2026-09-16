import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = new URL('../node_modules/stockfish/', import.meta.url);
const target = new URL('../web/public/engine/', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
if (pkg.version !== '18.0.8') throw new Error('Unexpected engine version; update the analysis configuration and retrain before changing it.');
await mkdir(target, { recursive: true });
const files = {};
for (const name of ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm']) {
  const input = new URL(`bin/${name}`, source);
  await copyFile(input, new URL(name, target));
  files[name] = createHash('sha256').update(await readFile(input)).digest('hex');
}
await copyFile(new URL('Copying.txt', source), new URL('COPYING.txt', target));
await writeFile(new URL('package.json', target), '{"type":"commonjs"}\n');
await writeFile(new URL('manifest.json', target), JSON.stringify({ version: pkg.version, flavor: 'lite-single', files, license: 'GPL-3.0', source: 'https://github.com/nmrugg/stockfish.js/tree/93c994592dcf3b4b21052ab925e9b534df9c0918' }, null, 2) + '\n');
console.log('Stockfish 18.0.8 lite-single assets ready.');
