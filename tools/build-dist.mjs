#!/usr/bin/env node
/*
 * Assemble the publishable site.
 *
 * dist/ is www/ with src/ beside it, which is the same shape tools/serve.mjs
 * serves. No path is rewritten on the way, so what is tested locally is what
 * is published — the alternative is a rewrite step that works until it doesn't
 * and fails as a 404 nobody can explain.
 */

import { cp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
const DIST = join(REPO, 'dist');
const DOMAIN = process.env.TETHER_DOMAIN ?? 'tether.halfstop.app';

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(join(REPO, 'www'), DIST, { recursive: true });
await cp(join(REPO, 'src'), join(DIST, 'src'), { recursive: true });

/* GitHub Pages reads this to serve the custom domain. */
await writeFile(join(DIST, 'CNAME'), `${DOMAIN}\n`);

/* Say what was published, so a deploy that changed nothing does not look like
 * one that worked. The same trick the map's deploy uses. */
await writeFile(join(DIST, 'deployed.txt'),
  `${process.env.GITHUB_SHA ?? 'local'}\n${new Date().toISOString()}\n`);

/*
 * Every module the page imports has to exist under dist, or the site is a
 * blank screen with a console error. Check rather than hope.
 */
const html = await readFile(join(DIST, 'index.html'), 'utf8');
const imports = [...html.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
const missing = [];
for (const spec of imports) {
  const resolved = join(DIST, spec.replace(/^\.\//, ''));
  if (!resolved.startsWith(DIST)) { missing.push(`${spec} escapes the site root`); continue; }
  try { await readFile(resolved); } catch { missing.push(`${spec} is not in dist`); }
}
if (missing.length) {
  console.error('dist would not load in a browser:');
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}

const files = await readdir(DIST);
console.log(`dist/ — ${DOMAIN}, ${files.length} entries at the root, ${imports.length} modules checked`);
