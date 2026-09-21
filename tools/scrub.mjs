#!/usr/bin/env node
/*
 * Take the owner out of a probe run that already happened.
 *
 *     node tools/scrub.mjs probe-output/<timestamp>
 *
 * New runs are scrubbed as they are written; this is for anything captured
 * before that was true.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scrubConfigs, scrubDump, scrubSummary } from '../src/camera/privacy.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/scrub.mjs <probe-output-dir>'); process.exit(1); }

let changed = 0;
for (const name of await readdir(dir)) {
  const path = join(dir, name);
  if (name === 'report.json') {
    const report = JSON.parse(await readFile(path, 'utf8'));
    if (report.phases?.config?.configs) report.phases.config.configs = scrubConfigs(report.phases.config.configs);
    if (report.phases?.summary) report.phases.summary = scrubSummary(report.phases.summary);
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
    changed++;
  } else if (name.endsWith('.txt')) {
    const text = await readFile(path, 'utf8');
    await writeFile(path, scrubSummary(scrubDump(text)));
    changed++;
  }
}
console.log(`scrubbed ${changed} files in ${dir}`);
