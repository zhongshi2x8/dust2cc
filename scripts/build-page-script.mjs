import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const entry = resolve(root, 'src/content/hooks/page-script.ts');
const outfile = resolve(root, 'public/page-script.js');

await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
  sourcemap: false,
});
