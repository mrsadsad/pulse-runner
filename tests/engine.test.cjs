'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Run, JUMP_DURATION, MOVE_COOLDOWN, INPUT_BUFFER, emptySave, cleanSave, recordRun } = require('../web/engine.js');
const levels = require('../web/levels.js');

function level(rows = [], duration = 3, id = 1) {
  return { id, duration, lookAhead: 2, rows };
}
function row(t, center = null, gem = -1) {
  return { t, type: [null, center, null], gem };
}
function advance(run, duration, dt = 1 / 60) {
  const target = Math.min(run.level.duration, run.time + duration);
  while (run.status === 'running' && run.time < target - 1e-10) run.step(Math.min(dt, target - run.time));
}

test('starts centered, grounded, and running', () => {
  const run = new Run(level([row(1, null, 1)]));
  assert.equal(run.lane, 1);
  assert.equal(run.status, 'running');
  assert.equal(run.jumpHeight(), 0);
  assert.equal(run.progress, 0);
  assert.equal(run.stars, 0);
  assert.equal(run.totalGems, 1);
});

test('left and right obey lane bounds and independent movement cooldown', () => {
  const run = new Run(level());
  assert.equal(run.action('left'), true);
  assert.equal(run.lane, 0);
  assert.equal(run.previousLane, 1);
  assert.equal(run.action('left'), false);
  assert.equal(run.action('right'), false);
  run.step(MOVE_COOLDOWN / 2);
  assert.equal(run.action('right'), false);
  run.step(MOVE_COOLDOWN / 2);
  assert.equal(run.action('right'), true);
  run.step(MOVE_COOLDOWN);
  assert.equal(run.action('right'), true);
  assert.equal(run.lane, 2);
  run.step(MOVE_COOLDOWN);
  assert.equal(run.action('right'), false);
  assert.equal(run.action('left'), true, 'a rejected edge input must not consume cooldown');
  assert.equal(run.action('invalid'), false);
});

test('jump follows one arc and cannot be retriggered while airborne', () => {
  const run = new Run(level());
  assert.equal(run.action('jump'), true);
  assert.equal(run.jumpHeight(), 0);
  run.step(JUMP_DURATION / 2);
  assert.ok(Math.abs(run.jumpHeight() - 1) < 1e-12);
  assert.equal(run.action('jump'), false);
  assert.equal(run.action('left'), true, 'movement remains available during jump');
  run.step(JUMP_DURATION / 2 - .001);
  assert.equal(run.action('jump'), false);
  run.step(.001);
  assert.equal(run.action('jump'), true);
  run.step(JUMP_DURATION + .1);
  assert.equal(run.jumpHeight(), 0);
});

for (const obstacle of ['wall', 'hurdle', 'gap']) {
  test(`${obstacle} is fatal on the ground`, () => {
    const run = new Run(level([row(.4, obstacle, 1)]));
    run.step(1);
    assert.equal(run.status, 'failed');
    assert.equal(run.time, .4, 'collision is evaluated at crossing time, not frame end');
    assert.deepEqual(run.failure, { type: obstacle, row: 0, lane: 1, height: 0, lastJumpAgo: null });
    assert.equal(run.gems, 0, 'collision occurs before gem pickup');
    assert.equal(run.stars, 0);
    assert.deepEqual(run.drainEvents(), [{ type: 'crash', obstacle }]);
    assert.deepEqual(run.drainEvents(), []);
    const snapshot = [run.time, run.lane, run.gems, run.passed];
    for (const action of ['left', 'right', 'jump']) assert.equal(run.action(action), false);
    run.step(10);
    assert.deepEqual([run.time, run.lane, run.gems, run.passed], snapshot);
  });
}

test('walls remain fatal at the highest point of a jump', () => {
  const run = new Run(level([row(JUMP_DURATION / 2, 'wall')]));
  run.action('jump');
  run.step(1);
  assert.equal(run.status, 'failed');
});

for (const obstacle of ['hurdle', 'gap']) {
  test(`${obstacle} can be jumped with correct timing`, () => {
    const run = new Run(level([row(JUMP_DURATION / 2, obstacle, 1)]));
    run.action('jump');
    run.step(run.level.duration);
    assert.equal(run.status, 'won');
    assert.equal(run.gems, 1);
    assert.equal(run.stars, 3);
  });
  for (const crossing of [.01, JUMP_DURATION + .01]) {
    test(`${obstacle} rejects ${crossing < .1 ? 'too-late' : 'too-early'} jumps`, () => {
      const run = new Run(level([row(crossing, obstacle)]));
      run.action('jump');
      run.step(2);
      assert.equal(run.status, 'failed');
    });
  }
}

test('changing lane avoids a wall and collects only the chosen lane gem', () => {
  const run = new Run(level([{ t: 1, type: [null, 'wall', null], gem: 0 }, row(2, null, 2)]));
  run.action('left');
  run.step(3);
  assert.equal(run.status, 'won');
  assert.equal(run.gems, 1);
  assert.equal(run.passed, 2);
  assert.deepEqual(run.drainEvents(), [{ type: 'gem', lane: 0, combo: 1, perfectJump: false }, { type: 'pass', perfectJump: false }, { type: 'win' }]);
});

test('large frames process every row in order and cannot tunnel through a wall', () => {
  const run = new Run(level([row(.1, null, 1), row(.2, 'wall'), row(.3, null, 1)]));
  run.step(100);
  assert.equal(run.status, 'failed');
  assert.equal(run.gems, 1);
  assert.equal(run.passed, 1);
  assert.equal(run.time, .2);
});

test('invalid frame deltas are ignored and completed runs stop at duration', () => {
  const run = new Run(level());
  for (const dt of [0, -1, NaN, Infinity, undefined, null]) run.step(dt);
  assert.equal(run.time, 0);
  run.step(100);
  assert.equal(run.status, 'won');
  assert.equal(run.time, run.level.duration);
  assert.equal(run.progress, 1);
  assert.equal(run.action('jump'), false);
  assert.equal(run.action('left'), false);
  run.step(1);
  assert.deepEqual(run.drainEvents(), [{ type: 'win' }]);
});

test('stars award one for completion, two for 70 percent gems, three for all', () => {
  for (const [gems, expected] of [[0, 1], [6, 1], [7, 2], [9, 2], [10, 3]]) {
    const run = new Run(level(Array.from({ length: 10 }, (_, i) => row((i + 1) / 10, null, i < gems ? 1 : 0))));
    run.step(3);
    assert.equal(run.gems, gems);
    assert.equal(run.stars, expected);
  }
});

test('save defaults are independent and malformed storage is sanitized', () => {
  const pristine = { version: 1, unlocked: 1, records: {}, sound: true, music: true, vibration: true, effects: true, attempts: 0, challengeRecords: {}, dailyRecords: {}, goalProgress: {}, trialRecords: {}, endlessRecord: { attempts: 0, bestScore: 0, bestDistance: 0, bestTime: 0, bestCombo: 0, bestBonus: 0, bestStage: 0 } };
  for (const malformed of [undefined, null, false, 42, 'invalid']) assert.deepEqual(cleanSave(malformed), pristine);
  const first = emptySave();
  first.records[1] = { stars: 3 };
  assert.deepEqual(emptySave(), pristine);
  const cleaned = cleanSave({
    version: 100, unlocked: 999, sound: false, music: false, vibration: false, effects: false, attempts: -4,
    records: {
      1: { stars: 999, gems: -2, progress: Infinity, attempts: 2.9, bestScore: -3, bestCombo: Infinity },
      2: { stars: 2.8, gems: 4.8, progress: 99, attempts: -1, bestScore: 400.9, bestCombo: 4.8 },
      3: { stars: NaN, gems: Infinity, progress: -.8, attempts: '8', bestScore: '500', bestCombo: NaN },
      4: 'broken', 16: { stars: 3 },
    },
  });
  assert.deepEqual(cleaned, {
    version: 1, unlocked: 3, sound: false, music: false, vibration: false, effects: false, attempts: 0, challengeRecords: {}, dailyRecords: {}, goalProgress: {}, trialRecords: {}, endlessRecord: { attempts: 0, bestScore: 0, bestDistance: 0, bestTime: 0, bestCombo: 0, bestBonus: 0, bestStage: 0 },
    records: {
      1: { stars: 3, gems: 0, progress: 0, attempts: 2, bestScore: 0, bestCombo: 0 },
      2: { stars: 2, gems: 4, progress: 1, attempts: 0, bestScore: 400, bestCombo: 4 },
      3: { stars: 0, gems: 0, progress: 0, attempts: 0, bestScore: 0, bestCombo: 0 },
    },
  });
  assert.equal(cleanSave({ unlocked: 15 }).unlocked, 1);
  assert.equal(cleanSave({ records: { 2: { stars: 3 } } }).unlocked, 1, 'unlocks require a contiguous chain of wins');
});

test('completed runs unlock next level and retries never downgrade records', () => {
  const save = emptySave();
  const won = new Run(level([row(1, null, 1)]));
  won.step(3);
  recordRun(save, won);
  assert.equal(save.unlocked, 2);
  assert.deepEqual(save.records[1], { stars: 3, gems: 1, progress: 1, attempts: 1, bestScore: 1125, bestCombo: 1 });
  const lost = new Run(level([row(1, 'wall')]));
  lost.step(3);
  recordRun(save, lost);
  assert.equal(save.unlocked, 2);
  assert.deepEqual(save.records[1], { stars: 3, gems: 1, progress: 1, attempts: 2, bestScore: 1125, bestCombo: 1 });
  assert.equal(save.attempts, 2);
  assert.deepEqual(cleanSave(JSON.parse(JSON.stringify(save))), save);
});

test('failing records best distance without unlocking and final unlock is capped at 15', () => {
  const save = emptySave();
  const failed = new Run(level([row(.75, 'wall')]));
  failed.step(3);
  recordRun(save, failed);
  assert.equal(save.unlocked, 1);
  assert.equal(save.records[1].progress, .25);
  for (let id = 1; id <= 15; id++) {
    const won = new Run(level([], 1, id));
    won.step(1);
    recordRun(save, won);
  }
  assert.equal(save.unlocked, 15);
  assert.equal(cleanSave(JSON.parse(JSON.stringify(save))).unlocked, 15);
});

test('input performs available actions immediately without emitting buffered events', () => {
  const run = new Run(level());
  assert.equal(run.input('jump'), 'performed');
  assert.equal(run.input('left'), 'performed');
  assert.equal(run.lane, 0);
  assert.equal(run.bufferedJump, false);
  assert.deepEqual(run.drainEvents(), []);
  assert.equal(run.input('invalid'), false);
  assert.equal(run.input('left'), false);
  run.step(3);
  for (const action of ['left', 'right', 'jump']) assert.equal(run.input(action), false);
});

test('jump buffer accepts only the last 120 ms and executes at the exact landing time', () => {
  const run = new Run(level());
  run.input('jump');
  run.step(JUMP_DURATION - INPUT_BUFFER - .00001);
  assert.equal(run.input('jump'), false);
  assert.equal(run.bufferedJump, false);
  run.step(.00001);
  assert.equal(run.input('jump'), 'queued');
  assert.equal(run.bufferedJump, true);
  run.step(INPUT_BUFFER - .00001);
  assert.equal(run.jumpedAt, 0);
  run.step(.00001);
  assert.ok(Math.abs(run.jumpedAt - JUMP_DURATION) < 1e-12);
  assert.equal(run.bufferedJump, false);
  assert.deepEqual(run.drainEvents(), [{ type: 'input', action: 'jump', buffered: true }]);
  run.step(.41);
  assert.ok(Math.abs(run.jumpHeight() - 1) < 1e-12);
});

test('repeated queued jumps occupy one slot and never become held auto-jump', () => {
  const run = new Run(level([], 5));
  run.input('jump');
  run.step(.75);
  for (let i = 0; i < 20; i++) assert.equal(run.input('jump'), 'queued');
  run.step(2);
  assert.equal(run.jumpedAt, JUMP_DURATION);
  assert.equal(run.jumpHeight(), 0);
  assert.equal(run.bufferedJump, false);
  assert.deepEqual(run.drainEvents(), [{ type: 'input', action: 'jump', buffered: true }]);
});

test('queued input waits for simulation steps while the game is paused', async () => {
  const run = new Run(level());
  run.input('jump');
  run.step(.80);
  run.input('jump');
  const before = { time: run.time, jumpedAt: run.jumpedAt, height: run.jumpHeight() };
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual({ time: run.time, jumpedAt: run.jumpedAt, height: run.jumpHeight() }, before);
  assert.equal(run.bufferedJump, true);
  assert.deepEqual(run.drainEvents(), []);
  run.step(.02);
  assert.equal(run.bufferedJump, false);
  assert.equal(run.jumpedAt, .82);
});

test('a buffered move runs before an obstacle at the exact same timestamp', () => {
  const run = new Run(level([{ t: .1, type: ['wall', null, 'wall'], gem: 1 }]));
  assert.equal(run.input('left'), 'performed');
  assert.equal(run.input('right'), 'queued');
  run.step(1);
  assert.equal(run.status, 'running');
  assert.equal(run.lane, 1);
  assert.equal(run.movedAt, .1);
  assert.equal(run.gems, 1);
  assert.deepEqual(run.drainEvents(), [
    { type: 'input', action: 'right', buffered: true },
    { type: 'gem', lane: 1, combo: 1, perfectJump: false }
  ]);
});

test('a buffered jump at collision time has zero height and cannot bypass a hurdle', () => {
  const run = new Run(level([row(.82, 'hurdle')]));
  run.input('jump');
  run.step(.75);
  assert.equal(run.input('jump'), 'queued');
  run.step(.2);
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.height, 0);
  assert.equal(run.failure.lastJumpAgo, 0);
  assert.equal(run.bufferedJump, false);
  assert.deepEqual(run.drainEvents(), [
    { type: 'input', action: 'jump', buffered: true },
    { type: 'crash', obstacle: 'hurdle' }
  ]);
});

test('jump and movement buffers execute independently inside a large frame', () => {
  const run = new Run(level([row(1.23, 'hurdle', 1)]));
  run.input('jump');
  run.step(.75);
  run.input('left');
  assert.equal(run.input('right'), 'queued');
  assert.equal(run.input('jump'), 'queued');
  run.step(.6);
  assert.equal(run.status, 'running');
  assert.equal(run.lane, 1);
  assert.equal(run.jumpedAt, .82);
  assert.equal(run.movedAt, .85);
  assert.equal(run.perfectJumps, 1);
  assert.deepEqual(run.drainEvents(), [
    { type: 'input', action: 'jump', buffered: true },
    { type: 'input', action: 'right', buffered: true },
    { type: 'gem', lane: 1, combo: 1, perfectJump: true }
  ]);
});

test('edge input rejects without discarding the valid queued movement', () => {
  const run = new Run(level());
  run.input('left');
  assert.equal(run.input('right'), 'queued');
  assert.equal(run.input('left'), false);
  run.step(.2);
  assert.equal(run.lane, 1);
  assert.equal(run.drainEvents().length, 1);
});

test('latest valid movement replaces the same single buffer slot', () => {
  const run = new Run(level());
  run.action('right');
  run.step(.1);
  run.action('left');
  assert.equal(run.input('left'), 'queued');
  assert.equal(run.input('right'), 'queued');
  run.step(.5);
  assert.equal(run.lane, 2);
  assert.deepEqual(run.drainEvents(), [{ type: 'input', action: 'right', buffered: true }]);
});

test('legacy action stays immediate and never silently queues a rejected command', () => {
  const run = new Run(level());
  run.action('jump');
  run.action('left');
  assert.equal(run.action('right'), false);
  run.step(.75);
  assert.equal(run.action('jump'), false);
  assert.equal(run.bufferedJump, false);
  run.step(1);
  assert.equal(run.lane, 0);
  assert.equal(run.jumpedAt, 0);
  assert.deepEqual(run.drainEvents(), []);
});

test('queued commands are cleared by an earlier fatal collision', () => {
  const run = new Run(level([row(.80, 'wall')]));
  run.input('jump');
  run.step(.75);
  run.input('jump');
  run.step(1);
  assert.equal(run.status, 'failed');
  assert.equal(run.bufferedJump, false);
  assert.equal(run.jumpedAt, 0);
  assert.deepEqual(run.drainEvents(), [{ type: 'crash', obstacle: 'wall' }]);
});

test('combo score caps its per-gem bonus after the ninth consecutive gem', () => {
  const run = new Run(level(Array.from({ length: 10 }, (_, i) => row((i + 1) / 10, null, 1))));
  run.step(3);
  assert.equal(run.combo, 10);
  assert.equal(run.maxCombo, 10);
  // 250 safe-row points + 1,000 gem points + 1,100 combo + 1,000 completion.
  assert.equal(run.score, 3350);
  assert.deepEqual(run.drainEvents().filter(event => event.type === 'gem').map(event => event.combo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  run.step(10);
  assert.equal(run.score, 3350, 'the completion bonus is granted only once');
});

test('missing a gem resets combo while a row with no gem preserves it', () => {
  const run = new Run(level([
    row(.2, null, 1), row(.4, null, 1), row(.6, null, -1),
    row(.8, null, 1), row(1.0, null, 0), row(1.2, null, 1)
  ]));
  run.step(3);
  assert.equal(run.combo, 1);
  assert.equal(run.maxCombo, 3);
  assert.equal(run.score, 1625); // 150 rows + 400 gems + 75 combo + 1,000 win.
  assert.equal(run.gems, 4);
});

test('crashing gives no safe-row, gem, or completion points for the fatal row', () => {
  const run = new Run(level([row(.2, null, 1), row(.4, 'wall', 1)]));
  run.step(3);
  assert.equal(run.score, 125);
  assert.equal(run.maxCombo, 1);
});

for (const obstacle of ['hurdle', 'gap']) {
  test(`perfect ${obstacle} jumps are counted with and without a gem`, () => {
    for (const gemLane of [1, -1]) {
      const run = new Run(level([row(.41, obstacle, gemLane)]));
      run.action('jump');
      run.step(3);
      assert.equal(run.perfectJumps, 1);
      assert.equal(run.drainEvents()[0].perfectJump, true);
    }
  });
}

test('successful low jumps and jumps over empty track are not perfect obstacle jumps', () => {
  const run = new Run(level([row(.15, 'hurdle'), row(.41)]));
  run.action('jump');
  run.step(3);
  assert.equal(run.status, 'won');
  assert.equal(run.perfectJumps, 0);
  assert.ok(run.drainEvents().filter(event => event.type === 'pass').every(event => !event.perfectJump));
});

test('failure timing distinguishes no jump from a late or early jump', () => {
  for (const crossing of [.01, .83]) {
    const run = new Run(level([row(crossing, 'gap')]));
    run.action('jump');
    run.step(3);
    assert.equal(run.failure.lastJumpAgo, crossing);
    assert.equal(run.failure.height, run.jumpHeight(crossing));
  }
});

test('version 1 storage migration preserves progress and adds effect and score defaults', () => {
  const old = {
    version: 1, unlocked: 3, sound: false, vibration: true, attempts: 17,
    records: {
      1: { stars: 3, gems: 15, progress: 1, attempts: 5 },
      2: { stars: 1, gems: 4, progress: 1, attempts: 7 },
      3: { stars: 0, gems: 8, progress: .65, attempts: 5 }
    }
  };
  const upgraded = cleanSave(old);
  assert.equal(upgraded.version, 1);
  assert.equal(upgraded.unlocked, 3);
  assert.equal(upgraded.effects, true);
  assert.equal(upgraded.music, true);
  assert.equal(upgraded.attempts, 17);
  assert.equal(upgraded.sound, false);
  for (const id of [1, 2, 3]) {
    assert.deepEqual(upgraded.records[id], { ...old.records[id], bestScore: 0, bestCombo: 0 });
  }
  assert.deepEqual(cleanSave(JSON.parse(JSON.stringify(upgraded))), upgraded);
  assert.equal(cleanSave({ effects: 'false' }).effects, true);
  assert.equal(cleanSave({ music: 'false' }).music, true);
});

test('best score and combo upgrade a legacy record and never decrease', () => {
  const save = emptySave();
  save.records[1] = { stars: 2, gems: 8, progress: 1, attempts: 4 };
  const won = new Run(level([row(.2, null, 1), row(.4, null, 1)]));
  won.step(3);
  recordRun(save, won);
  assert.equal(save.records[1].bestScore, 1275);
  assert.equal(save.records[1].bestCombo, 2);
  assert.equal(save.records[1].attempts, 5);
  const failed = new Run(level([row(.2, 'wall')]));
  failed.step(3);
  recordRun(save, failed);
  assert.equal(save.records[1].bestScore, 1275);
  assert.equal(save.records[1].bestCombo, 2);
  assert.equal(save.records[1].gems, 8);
  assert.equal(save.records[1].attempts, 6);
});

test('practice starts at a chosen row with a fresh lane and an unobstructed approach', () => {
  const spec = levels[14];
  const startRow = 20;
  const run = new Run(spec, { practice: true, startRow });
  assert.equal(run.practice, true);
  assert.equal(run.practiceStartRow, startRow);
  assert.equal(run.nextRow, startRow);
  assert.equal(run.time, spec.rows[startRow].t - 2.4);
  assert.equal(run.lane, 1);
  assert.equal(run.jumpHeight(), 0);
  assert.equal(run.totalGems, spec.rows.slice(startRow).filter(r => r.gem >= 0).length);
  run.step(2.399);
  assert.equal(run.status, 'running');
  assert.equal(run.nextRow, startRow, 'earlier rows are excluded even if their time is after the practice clock start');
  assert.equal(run.passed, 0);
  assert.equal(run.score, 0);
});

test('practice row options clamp safely and never affect a standard run', () => {
  const spec = levels[0];
  for (const option of [-5, NaN, Infinity, undefined]) {
    const run = new Run(spec, { practice: true, startRow: option });
    assert.equal(run.practiceStartRow, 0);
    assert.equal(run.time, 0);
  }
  assert.equal(new Run(spec, { practice: true, startRow: 1000 }).practiceStartRow, spec.rows.length - 1);
  assert.equal(new Run(spec, { practice: true, startRow: 2.9 }).practiceStartRow, 2);
  const standard = new Run(spec, { startRow: 8 });
  assert.equal(standard.practice, false);
  assert.equal(standard.practiceStartRow, 0);
  assert.equal(standard.time, 0);
  assert.equal(standard.totalGems, spec.maxGems);
  const empty = new Run(level(), { practice: true, startRow: 5 });
  assert.equal(empty.time, 0);
  assert.equal(empty.nextRow, 0);
});

test('practice wins and losses never unlock, overwrite records, or count attempts', () => {
  const save = cleanSave({ attempts: 3, records: { 1: { stars: 1, gems: 0, progress: 1, attempts: 3 } } });
  const before = JSON.stringify(save);
  const won = new Run(level([row(.2, null, 1), row(.4, null, 1)], 3, 2), { practice: true });
  won.step(3);
  assert.equal(won.status, 'won');
  assert.equal(won.stars, 0);
  assert.equal(won.score, 1275);
  assert.equal(recordRun(save, won), save);
  assert.equal(JSON.stringify(save), before);
  const failed = new Run(level([row(.2, 'wall')]), { practice: true });
  failed.step(3);
  assert.equal(failed.status, 'failed');
  recordRun(save, failed);
  assert.equal(JSON.stringify(save), before);
  const freshSave = emptySave();
  recordRun(freshSave, won);
  assert.deepEqual(freshSave, emptySave());
});

for (const spec of levels) {
  test(`level ${spec.id}: practice can finish from a fresh lane without granting stars`, () => {
    const firstRow = Math.floor(spec.rows.length / 2);
    const run = new Run(spec, { practice: true, startRow: firstRow });
    assert.ok(spec.rows[firstRow].t - run.time >= 2.4 - 1e-9);
    const instructions = [];
    let lane = 1;
    for (const encounter of spec.rows.slice(firstRow)) {
      const target = encounter.gem;
      const direction = target < lane ? 'left' : 'right';
      if (lane !== target) instructions.push({ t: encounter.t - .45, action: direction });
      if (Math.abs(lane - target) === 2) instructions.push({ t: encounter.t - .30, action: direction });
      if (['hurdle', 'gap'].includes(encounter.type[target])) instructions.push({ t: encounter.t - .41, action: 'jump' });
      lane = target;
    }
    instructions.sort((a, b) => a.t - b.t);
    for (const instruction of instructions) {
      run.step(instruction.t - run.time);
      assert.equal(run.input(instruction.action), 'performed');
    }
    run.step(spec.duration - run.time);
    assert.equal(run.status, 'won');
    assert.equal(run.stars, 0);
    assert.equal(run.gems, run.totalGems);
    assert.equal(run.passed, spec.rows.length - firstRow);
  });
}

function playSolution(spec, frameSteps, offset = 0) {
  const run = new Run(spec);
  let actionIndex = 0;
  let frame = 0;
  while (run.status === 'running' && frame < 100000) {
    while (actionIndex < spec.solution.length && spec.solution[actionIndex].t + offset <= run.time + 1e-9) {
      const instruction = spec.solution[actionIndex++];
      assert.equal(run.action(instruction.action), true, `level ${spec.id}: ${instruction.action} rejected at ${run.time.toFixed(3)} s (scheduled ${instruction.t.toFixed(3)} s)`);
    }
    run.step(frameSteps[frame % frameSteps.length]);
    frame++;
  }
  assert.equal(run.status, 'won', `level ${spec.id}: failed at ${run.time.toFixed(3)} s, ${JSON.stringify(run.failure)}`);
  assert.equal(run.gems, run.totalGems, `level ${spec.id}: solution missed gems`);
  assert.equal(run.stars, 3);
  return run;
}

{
  test('exactly 15 unique, ordered, well-formed levels and documented solutions', () => {
    assert.equal(levels.length, 15);
    assert.deepEqual(levels.map(item => item.id), Array.from({ length: 15 }, (_, index) => index + 1));
    for (const spec of levels) {
      assert.ok(Number.isFinite(spec.duration) && spec.duration > 0);
      assert.ok(Number.isFinite(spec.lookAhead) && spec.lookAhead > 0);
      assert.ok(spec.rows.length > 0);
      assert.ok(spec.solution.length > 0);
      let previous = 0;
      for (const obstacleRow of spec.rows) {
        assert.ok(obstacleRow.t > previous && obstacleRow.t < spec.duration, `level ${spec.id}: invalid row time ${obstacleRow.t}`);
        assert.equal(obstacleRow.type.length, 3);
        assert.ok(obstacleRow.type.every(type => [null, 'wall', 'hurdle', 'gap'].includes(type)));
        assert.ok([-1, 0, 1, 2].includes(obstacleRow.gem));
        assert.ok(obstacleRow.type.some(type => type !== 'wall'), `level ${spec.id}: impossible solid wall`);
        previous = obstacleRow.t;
      }
      previous = -Infinity;
      for (const instruction of spec.solution) {
        assert.ok(instruction.t >= previous && instruction.t >= 0 && instruction.t < spec.duration);
        assert.ok(['left', 'right', 'jump'].includes(instruction.action));
        previous = instruction.t;
      }
    }
  });
  const rates = [
    ['60 Hz', [1 / 60]],
    ['30 Hz', [1 / 30]],
    ['irregular frames', [1 / 60, 1 / 38, 1 / 24, 1 / 55, 1 / 47]],
  ];
  for (const spec of levels) {
    for (const [name, steps] of rates) test(`level ${spec.id}: full-gem solution at ${name}`, () => playSolution(spec, steps));
    for (const offset of [-.10, .10]) test(`level ${spec.id}: solution remains fair with ${offset > 0 ? '+' : ''}${offset * 1000} ms input offset`, () => playSolution(spec, [1 / 30], offset));
    test(`level ${spec.id}: idle player fails`, () => {
      const run = new Run(spec);
      advance(run, spec.duration, 1 / 30);
      assert.equal(run.status, 'failed', `level ${spec.id}: no-input strategy must not win`);
    });
  }
}
