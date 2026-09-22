#!/usr/bin/env node
/*
 * A static server for the browser harness, with no dependencies.
 *
 * It serves www/ as the site root and lends it src/ at the same URL the build
 * will publish, so a module path is identical here and deployed. Nothing is
 * rewritten between the two, which is the only way they cannot drift.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const REPO = new URL('..', import.meta.url).pathname;
const ROOT = join(REPO, 'www');
const PORT = Number(process.env.PORT ?? 8099);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  /*
   * The deploy writes this file into dist; here there is no deploy, so answer
   * with what the working copy is. Same URL either way, which is the point —
   * the page asks one question and gets a true answer in both places.
   */
  if (path === '/deployed.txt') {
    const { execSync } = await import('node:child_process');
    let stamp = 'unknown';
    try {
      stamp = execSync('git describe --always --dirty --tags', { cwd: REPO }).toString().trim();
    } catch { /* not a checkout */ }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`${stamp} (working copy)\n${new Date().toISOString()}\n`);
    return;
  }
  const clean = normalize(path === '/' ? '/index.html' : path);
  /* /src/... is served from the repository, exactly where the build copies it. */
  const file = clean.startsWith('/src/') ? join(REPO, clean) : join(ROOT, clean);
  if (!file.startsWith(ROOT) && !file.startsWith(join(REPO, 'src'))) { res.writeHead(403).end('no'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  console.log(`\n  Harness at http://localhost:${PORT}/\n`);
  console.log('  WebUSB needs Chrome or Edge. Safari has none, so this will not work there.');
  console.log('  On macOS, free the camera first:');
  console.log('    sudo launchctl disable system/com.apple.ptpcamerad');
  console.log('    sudo killall ptpcamerad\n');
});
