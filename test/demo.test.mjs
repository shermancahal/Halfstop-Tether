/*
 * The camera made of a file, and every intent run against it.
 *
 * The fixture is a real Z 5 captured by the probe, so this suite is the
 * closest thing to a camera that CI will ever have. It is also the sweep that
 * catches an intent that throws on one combination of its own options — the
 * kind of thing nobody finds by clicking, because nobody clicks all of them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { fixtureSession } from '../src/camera/fixture-session.mjs';
import { readCameraState, toPlannerContext, lensFrom } from '../src/camera/live.mjs';
import { applyPlan, confirm } from '../src/camera/apply.mjs';
import { INTENTS, planFor } from '../src/plan/index.mjs';

const fixture = JSON.parse(await readFile(new URL('../fixtures/nikon-z5.json', import.meta.url), 'utf8'));

async function connected(mode = 'M') {
  const session = fixtureSession(fixture, { mode });
  const state = await readCameraState(session);
  const camera = toPlannerContext(state, { model: 'Nikon Z 5', pixelPitchUm: 5.94, widthPx: 6016 });
  return { session, state, camera, lens: lensFrom(state) };
}

test('the demo camera reports the writability the probe measured', async () => {
  for (const [mode, expected] of Object.entries(fixture.writableByMode)) {
    const { camera } = await connected(mode);
    assert.deepEqual(camera.writableByMode[mode], expected,
      `${mode} should leave ${expected.join(', ') || 'nothing'} to the app`);
  }
});

test('a write lands on the nearest value the camera offers, not the one asked for', async () => {
  /* Real bodies do this, and applyPlan's confirmation step exists for it. */
  const { session, state } = await connected('M');
  const rows = await applyPlan({ session, state, plan: { settings: { aperture: 6.9 } } });
  assert.equal(rows[0].outcome, 'wrote');

  const after = await readCameraState(session);
  assert.ok(fixture.axes.aperture.legal.includes(after.axes.aperture.value),
    `landed on f/${after.axes.aperture.value}, which is a value this lens offers`);
  assert.notEqual(after.axes.aperture.value, 6.9);
});

test('the dial refuses what it cannot set, in the mode the probe found it', async () => {
  const { session, state } = await connected('S');
  const rows = confirm(
    await applyPlan({ session, state, plan: { settings: { shutter: 1 / 250, aperture: 11, iso: 400 } } }),
    await readCameraState(session),
  );
  const by = Object.fromEntries(rows.map((r) => [r.axis, r.outcome]));
  assert.equal(by.aperture, 'refused', 'S leaves aperture to the camera');
  assert.equal(by.shutter, 'set');
  assert.equal(by.iso, 'set');
});

test('every intent solves in every mode, for every combination of its options', async () => {
  /*
   * Seven intents, four dial positions, and each intent's own options crossed
   * together. Nothing here checks that an answer is *good* — only that asking
   * never throws and never produces a setting that is not a number.
   */
  let combinations = 0;

  for (const mode of Object.keys(fixture.writableByMode)) {
    const { camera, lens } = await connected(mode);

    for (const intent of Object.values(INTENTS)) {
      const options = intent.options ?? [];
      /* The cartesian product of every choice of every option. */
      const wants = options.reduce(
        (acc, option) => acc.flatMap((want) => option.choices.map((c) => ({ ...want, [option.id]: c.id }))),
        [{}],
      );

      for (const want of wants) {
        combinations += 1;
        const plan = planFor(intent.id, { camera, lens, site: { bortle: 3 }, want });

        assert.ok(plan.title, `${intent.id} produced a plan with no title`);
        for (const [axis, value] of Object.entries(plan.settings)) {
          assert.ok(Number.isFinite(value) && value > 0,
            `${intent.id} in ${mode} with ${JSON.stringify(want)}: ${axis} is ${value}`);
          assert.ok(plan.reasons[axis], `${intent.id}: ${axis} has a value but no reason`);
        }
        if (plan.sequence) {
          assert.ok(Number.isFinite(plan.sequence.frames) && plan.sequence.frames > 0,
            `${intent.id} in ${mode}: ${plan.sequence.frames} frames`);
        }
      }
    }
  }

  assert.ok(combinations > 100, `swept ${combinations} combinations`);
});

test('an intent that pins what the mode will not give says so, in every such mode', async () => {
  for (const mode of ['A', 'S', 'P']) {
    const { camera, lens } = await connected(mode);
    const plan = planFor('milky-way', { camera, lens, site: { bortle: 3 }, want: {} });
    const dial = plan.checks.find((c) => c.kind === 'mode-dial');
    assert.ok(dial, `${mode} should have produced a mode-dial check`);
    assert.match(dial.says, new RegExp(`dial is on ${mode}`));
    assert.equal(dial.appCanFix, false, 'and it is not the app that can fix it');
  }
});
