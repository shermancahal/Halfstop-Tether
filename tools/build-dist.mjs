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
import { join, dirname, relative } from 'node:path';

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
 * Every module every page imports has to exist under dist, or that page is a
 * blank screen with a console error nobody sees. Check all of them — checking
 * only index.html once let the harness go unverified.
 */
const pages = (await readdir(DIST)).filter((name) => name.endsWith('.html'));
const missing = [];
const seen = new Set();

/*
 * All three ways a module names another one. `from` alone missed the two that
 * have no `from`: a side-effect import and a dynamic one. Both load a file the
 * browser has to find.
 */
const specsIn = (source) => [
  ...source.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g),
  ...source.matchAll(/import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
].map((m) => m[1]);

/*
 * Follow the imports all the way down.
 *
 * Checking only the ones written in the HTML was checking one link of the
 * chain: app.mjs imports icons.mjs imports whatever it likes, and any of those
 * missing is the same blank screen with the same console error nobody sees.
 * The browser resolves the whole graph, so this has to as well.
 */
async function follow(spec, fromDir, blamed) {
  const resolved = spec.startsWith('./') || spec.startsWith('../')
    ? join(fromDir, spec) : join(DIST, spec);
  if (!resolved.startsWith(DIST)) { missing.push(`${blamed}: ${spec} escapes the site root`); return; }
  if (seen.has(resolved)) return;
  seen.add(resolved);

  let source;
  try { source = await readFile(resolved, 'utf8'); } catch {
    missing.push(`${blamed}: ${spec} is not in dist`);
    return;
  }
  const here = dirname(resolved);
  for (const next of specsIn(source)) await follow(next, here, relative(DIST, resolved));
}

for (const page of pages) {
  const html = await readFile(join(DIST, page), 'utf8');
  for (const spec of specsIn(html)) await follow(spec, DIST, page);
}
const imports = [...seen];
if (missing.length) {
  console.error('dist would not load in a browser:');
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}

console.log(`dist/ — ${DOMAIN}, ${pages.length} page${pages.length > 1 ? 's' : ''}, ${imports.length} module imports checked`);
