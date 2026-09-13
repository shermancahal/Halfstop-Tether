#!/usr/bin/env node
/*
 * What does this camera actually do?
 *
 * The published sources disagree with each other and with Nikon's own software
 * about the Z5, so this asks the camera instead. It changes nothing it does not
 * put back, and it never touches the card.
 *
 * Run it with the camera on and connected:
 *
 *     node tools/probe.mjs
 *
 * Needs gphoto2 on the PATH. Everything it learns lands in probe-output/.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';

const OUT = join('probe-output', new Date().toISOString().replace(/[:.]/g, '-'));

const run = (args, timeout = 60000) =>
  new Promise((resolve) => {
    execFile('gphoto2', args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ ok: !error, code: error?.code ?? 0, stdout: stdout ?? '', stderr: stderr ?? '', error: error?.message }),
    );
  });

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);
const say = (...a) => console.log(...a);

/*
 * `--list-all-config` returns every setting in one round trip, as blocks:
 *
 *     /main/capturesettings/f-number
 *     Label: F-Number
 *     Readonly: 0
 *     Type: RADIO
 *     Current: f/4
 *     Choice: 0 f/4
 *     END
 *
 * The Readonly flag and the Choice list are the interesting part: both move
 * with the camera's state, which is the whole reason for the mode sweep below.
 */
export function parseConfig(text) {
  const configs = {};
  let current = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith('/')) {
      current = { path: trimmed, label: null, readonly: null, type: null, value: null, choices: [] };
      configs[trimmed] = current;
    } else if (!current) {
      continue;
    } else if (trimmed === 'END') {
      current = null;
    } else {
      const m = trimmed.match(/^(Label|Readonly|Type|Current|Choice):\s?(.*)$/);
      if (!m) continue;
      const [, key, rest] = m;
      if (key === 'Label') current.label = rest;
      else if (key === 'Readonly') current.readonly = rest === '1';
      else if (key === 'Type') current.type = rest;
      else if (key === 'Current') current.value = rest;
      else current.choices.push(rest.replace(/^\d+\s/, ''));
    }
  }
  return configs;
}

/* Width and height straight out of the JPEG's frame header. */
export function jpegSize(buf) {
  let i = 2;
  while (i <= buf.length - 9) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const report = { probedAt: new Date().toISOString(), phases: {} };

async function main() {
  await mkdir(OUT, { recursive: true });
  say(`\nWriting to ${OUT}\n`);

  /* 0 — is the tooling even here, and is something else holding the camera? */
  const version = await run(['--version'], 10000);
  if (!version.ok) {
    say('gphoto2 is not on the PATH.');
    say('  macOS:  brew install gphoto2');
    say('  Debian: sudo apt install gphoto2');
    rl.close();
    process.exitCode = 1;
    return;
  }
  report.gphoto2 = version.stdout.split('\n')[0];
  say(report.gphoto2);

  /* 1 — find the camera. */
  const detect = await run(['--auto-detect'], 20000);
  const cameras = detect.stdout.split('\n').slice(2).filter((l) => l.trim() && !/^-+$/.test(l));
  report.phases.detect = { output: detect.stdout, cameras };
  if (!cameras.length) {
    say('\nNo camera detected. Things worth checking:');
    say('  - the camera is on, and awake');
    say('  - USB is in data mode, not charge-only');
    say('  - on macOS, the system PTPCamera agent may have grabbed it:');
    say('      killall PTPCamera');
    say('  - on Linux, the desktop volume monitor may have:');
    say('      gio mount -s gphoto2   (or kill gvfs-gphoto2-volume-monitor)');
    rl.close();
    process.exitCode = 1;
    return;
  }
  say(`\nFound: ${cameras.join(', ')}`);

  const summary = await run(['--summary'], 30000);
  report.phases.summary = summary.stdout;
  await writeFile(join(OUT, 'summary.txt'), summary.stdout);

  /*
   * 2 — the full setting surface, and how long it costs to read.
   *
   * The timing matters as much as the contents: it is the budget the tiered
   * poll in the design has to live inside.
   */
  say('\nReading every setting...');
  const t0 = Date.now();
  const all = await run(['--list-all-config'], 120000);
  const readMs = Date.now() - t0;
  const baseline = parseConfig(all.stdout);
  const paths = Object.keys(baseline);
  await writeFile(join(OUT, 'config-baseline.txt'), all.stdout);
  report.phases.config = {
    readMs,
    count: paths.length,
    writable: paths.filter((p) => baseline[p].readonly === false).length,
    readonly: paths.filter((p) => baseline[p].readonly === true).length,
    configs: baseline,
  };
  say(`  ${paths.length} settings in ${readMs} ms ` +
      `(${report.phases.config.writable} writable, ${report.phases.config.readonly} read-only)`);

  /* 3 — live view. The question Nikon's own software says no to on this body. */
  say('\nLive view...');
  const previewPath = join(OUT, 'liveview.jpg');
  const preview = await run(['--capture-preview', '--force-overwrite', `--filename=${previewPath}`], 45000);
  let live = { ok: false };
  if (preview.ok) {
    try {
      const buf = await readFile(previewPath);
      const size = jpegSize(buf);
      live = { ok: true, bytes: (await stat(previewPath)).size, ...size };
      say(`  yes — ${size?.width}x${size?.height}, ${live.bytes} bytes`);
    } catch {
      live = { ok: false, note: 'command succeeded but no readable frame' };
      say('  command succeeded but produced no readable frame');
    }
  } else {
    live = { ok: false, stderr: preview.stderr.trim() };
    say(`  no — ${preview.stderr.trim().split('\n').slice(-1)[0]}`);
  }
  report.phases.liveview = live;

  /* Frame rate, if there are frames at all. */
  if (live.ok) {
    const n = 10;
    const start = Date.now();
    let got = 0;
    for (let i = 0; i < n; i++) {
      const r = await run(['--capture-preview', '--force-overwrite', `--filename=${join(OUT, 'lv-rate.jpg')}`], 20000);
      if (r.ok) got++;
    }
    const fps = got / ((Date.now() - start) / 1000);
    report.phases.liveview.fps = Number(fps.toFixed(2));
    say(`  ${fps.toFixed(1)} frames/sec over ${got} frames`);
  }

  /*
   * 4 — does a descriptor move when the camera's state does?
   *
   * The design turns on this: a mode change is expected to alter which settings
   * are writable and what values they will accept, not merely their contents.
   * This is the measurement of that claim.
   */
  say('\nMode sweep. This measures the thing the whole design rests on.');
  const sweeps = {};
  for (const mode of ['M', 'A', 'S', 'P']) {
    const answer = await ask(`  Turn the mode dial to ${mode}, then press Enter (or 's' to skip): `);
    if (answer.trim().toLowerCase() === 's') continue;
    const dump = await run(['--list-all-config'], 120000);
    sweeps[mode] = parseConfig(dump.stdout);
    await writeFile(join(OUT, `config-mode-${mode}.txt`), dump.stdout);
    say(`    read ${Object.keys(sweeps[mode]).length} settings`);
  }

  const modes = Object.keys(sweeps);
  if (modes.length > 1) {
    const changes = { writability: [], choices: [] };
    const union = new Set(modes.flatMap((m) => Object.keys(sweeps[m])));
    for (const path of union) {
      const seen = modes.map((m) => sweeps[m][path]).filter(Boolean);
      if (seen.length < 2) continue;
      if (new Set(seen.map((c) => c.readonly)).size > 1) {
        changes.writability.push({
          path,
          label: seen[0].label,
          byMode: Object.fromEntries(modes.map((m) => [m, sweeps[m][path]?.readonly === false ? 'writable' : 'read-only'])),
        });
      }
      if (new Set(seen.map((c) => c.choices.join('|'))).size > 1) {
        changes.choices.push({
          path,
          label: seen[0].label,
          countByMode: Object.fromEntries(modes.map((m) => [m, sweeps[m][path]?.choices.length ?? null])),
        });
      }
    }
    report.phases.modeSweep = { modes, ...changes };
    say(`\n  ${changes.writability.length} settings change writability with the dial`);
    for (const c of changes.writability.slice(0, 12)) {
      say(`    ${c.label ?? c.path}: ${Object.entries(c.byMode).map(([m, s]) => `${m}=${s}`).join('  ')}`);
    }
    say(`  ${changes.choices.length} settings change their legal values with the dial`);
  }

  /*
   * 5 — does the camera volunteer a change, or must it be asked?
   *
   * If turning a dial by hand produces no event, the tiered poll in the design
   * is not an optimisation, it is the only thing keeping the app honest.
   */
  say('\nEvent stream. Turn any dial by hand during the next 15 seconds.');
  await ask('  Press Enter to start listening: ');
  const events = await run(['--wait-event=15s'], 40000);
  const lines = events.stdout.split('\n').filter((l) => /change|event|prop/i.test(l));
  report.phases.events = { raw: events.stdout, matched: lines };
  say(lines.length ? `  ${lines.length} event lines:` : '  nothing reported — polling is the only option');
  for (const l of lines.slice(0, 12)) say(`    ${l.trim()}`);

  /*
   * 6 — how long does a write take to come back?
   *
   * This is the latency the interface has to hide, and the window in which an
   * echo has to be told apart from a human turning a dial.
   */
  say('\nWrite round trip...');
  const candidate = ['/main/imgsettings/iso', '/main/imgsettings/whitebalance', '/main/capturesettings/f-number']
    .map((p) => baseline[p])
    .find((c) => c && c.readonly === false && c.choices.length > 1);
  if (candidate) {
    const original = candidate.value;
    const target = candidate.choices.find((c) => c !== original);
    const w0 = Date.now();
    const set = await run(['--set-config', `${candidate.path}=${target}`], 30000);
    const setMs = Date.now() - w0;
    const back = await run(['--get-config', candidate.path], 30000);
    const readBack = back.stdout.match(/^Current:\s?(.*)$/m)?.[1];
    await run(['--set-config', `${candidate.path}=${original}`], 30000);
    report.phases.write = {
      path: candidate.path, from: original, to: target,
      accepted: set.ok, readBack, confirmed: readBack === target, setMs, restored: original,
    };
    say(`  ${candidate.label}: ${original} -> ${target} in ${setMs} ms; read back ${readBack}` +
        `${readBack === target ? ' (confirmed)' : ' (NOT confirmed)'}; restored to ${original}`);
  } else {
    report.phases.write = { skipped: 'no safe writable setting with alternatives in the current mode' };
    say('  skipped — nothing safely writable in this mode');
  }

  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  /* Focus control rides on live view, so report the two together. */
  const focusPaths = Object.keys(baseline).filter((p) => /manualfocusdrive|focusmode|viewfinder|zoomratio|starlight/i.test(p));
  report.phases.focus = {
    manualFocusDrive: focusPaths.some((p) => /manualfocusdrive/i.test(p)),
    liveViewZoom: focusPaths.some((p) => /zoomratio/i.test(p)),
    starlightView: focusPaths.some((p) => /starlight/i.test(p)),
    paths: focusPaths,
  };
  say(`\nFocus control: manual drive ${report.phases.focus.manualFocusDrive ? 'yes' : 'no'}` +
      `, live view zoom ${report.phases.focus.liveViewZoom ? 'yes' : 'no'}`);

  const lv = report.phases.liveview;
  const sweep = report.phases.modeSweep;
  const summaryMd = `# Probe report

- Camera: ${cameras.join(', ')}
- gphoto2: ${report.gphoto2}
- Settings exposed: **${report.phases.config.count}** (${report.phases.config.writable} writable)
- Full read takes: **${report.phases.config.readMs} ms**
- Live view: **${lv.ok ? `yes, ${lv.width}x${lv.height} at ~${lv.fps ?? '?'} fps` : 'no'}**
- Dial changes writability of: **${sweep ? sweep.writability.length : 'not measured'}** settings
- Dial changes legal values of: **${sweep ? sweep.choices.length : 'not measured'}** settings
- Events on a hand-turned dial: **${report.phases.events.matched.length}** lines
- Write round trip: **${report.phases.write.setMs ?? 'n/a'} ms**${report.phases.write.confirmed ? ' (confirmed)' : ''}
- Manual focus drive: **${report.phases.focus.manualFocusDrive ? 'yes' : 'no'}** · live view zoom: **${report.phases.focus.liveViewZoom ? 'yes' : 'no'}** · starlight view: **${report.phases.focus.starlightView ? 'yes' : 'no'}**

Raw dumps are beside this file. \`report.json\` has everything.
`;
  await writeFile(join(OUT, 'REPORT.md'), summaryMd);

  say(`\n${'-'.repeat(60)}`);
  say(summaryMd);
  say(`Everything is in ${OUT} — send me REPORT.md and report.json.`);
  rl.close();
}

/* Importable for tests; only probes when run directly. */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => { console.error(e); rl.close(); process.exitCode = 1; });
} else {
  rl.close();
}
