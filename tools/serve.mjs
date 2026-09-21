#!/usr/bin/env node
/*
 * A static server for the browser harness, with no dependencies.
 *
 * It serves the repository root rather than www/, because the harness imports
 * the same src/ modules the app will — there is no build step and no copy that
 * could drift.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8099);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, normalize(path === '/' ? '/www/index.html' : path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('no'); return; }
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
