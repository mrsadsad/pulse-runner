'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const E = require('../web/engine.js');
const X = require('../web/expedition.js');
const C = require('../web/challenges.js');
const levels = require('../web/levels.js');
const authored = JSON.stringify(levels);

function basic(rows, duration = 4) { return { id: 1, rows, duration, lookAhead: 2.8 }; }
function solveTrial(id, risk, steps = [1 / 60], offset = 0, practice = false) {
  const level = X.makeTrial(id), run = new E.Run(level, { practice });
  const solution = risk ? level.riskSolution : level.solution;
  let next = 0, frame = 0;
  while (run.status === 'running' && frame < 20000) {
    while (next < solution.length && solution[next].t + offset <= run.time + 1e-8) {
      const action = solution[next++];
      assert.equal(run.action(action.action), true, `trial ${id} rejected ${action.action} at ${run.time}`);
    }
    run.step(steps[frame++ % steps.length]);
  }
  assert.equal(run.status, 'won', `trial ${id}: ${JSON.stringify(run.failure)}`);
  assert.equal(run.gems, level.maxGems);
  assert.equal(run.maxCombo, level.maxGems);
  assert.equal(run.stars, practice ? 0 : 3);
  assert.equal(run.bonusGems, risk ? level.bonusTotal : 0);
  return run;
}

function solveEndless(seed, risk, until = 260, steps = [1 / 60], offset = 0, practice = false) {
  const run = new E.Run(X.makeEndless(seed), { practice });
  let lastAction = -Infinity, frame = 0;
  while (run.status === 'running' && run.time < until - 1e-8 && frame < 200000) {
    const solution = risk ? run.level.riskSolution : run.level.solution;
    for (const instruction of solution) {
      if (instruction.t <= lastAction + 1e-8) continue;
      if (instruction.t + offset > run.time + 1e-8) break;
      assert.equal(run.action(instruction.action), true, `seed ${seed} rejected ${instruction.action} at ${run.time}`);
      lastAction = instruction.t;
    }
    run.step(Math.min(steps[frame++ % steps.length], until - run.time));
    assert.ok(run.level.rows.length <= 18, 'live rows must stay bounded');
    assert.ok(run.level.solution.length <= 54 && run.level.riskSolution.length <= 54, 'solution history must be pruned too');
    run.drainEvents();
  }
  assert.equal(run.status, 'running', `seed ${seed}: ${JSON.stringify(run.failure)}`);
  assert.ok(Math.abs(run.time - until) < 1e-7);
  assert.equal(run.gems, run.passed, 'one crystal is collected per safely crossed row');
  assert.equal(run.maxCombo, run.passed);
  assert.equal(run.stars, 0);
  assert.equal(run.progress, 0);
  return run;
}

test('rowState is non-mutating and ordinary rows retain their original collision shape', () => {
  const row = { t: 2, type: ['wall', null, 'hurdle'], gem: 1 }, before = JSON.stringify(row);
  assert.deepEqual(E.rowState(row, 1), { type: ['wall', null, 'hurdle'], movingLane: null, gateClosed: null, gateLocked: false });
  E.rowState(row, 1).type[0] = null;
  assert.equal(JSON.stringify(row), before);
});

test('moving walls interpolate at their exact boundaries and stay at the settled destination', () => {
  const row = { t: 4, type: [null, null, null], gem: 1, motion: { from: 0, to: 2, moveStart: 1, moveEnd: 2 } };
  for (const [time, lane] of [[0, 0], [1, 0], [1.25, .5], [1.5, 1], [1.75, 1.5], [2, 2], [10, 2]]) {
    const state = E.rowState(row, time);
    assert.equal(state.movingLane, lane);
    assert.equal(state.type[Math.round(lane)], 'wall');
    assert.equal(state.type.filter(type => type === 'wall').length, 1);
  }
  assert.deepEqual(row.type, [null, null, null]);
});

test('periodic gate changes at the half-period boundary then latches its advertised final state', () => {
  const row = { t: 5, type: [null, null, null], gem: 1, gate: { lane: 0, period: 2, phase: 0, lockAt: 2.25, closed: false } };
  assert.equal(E.rowState(row, 0).gateClosed, true);
  assert.equal(E.rowState(row, .999999).gateClosed, true);
  assert.equal(E.rowState(row, 1).gateClosed, false);
  assert.equal(E.rowState(row, 2).gateClosed, true);
  assert.equal(E.rowState(row, 2.249999).gateLocked, false);
  assert.equal(E.rowState(row, 2.25).gateLocked, true);
  assert.equal(E.rowState(row, 2.25).gateClosed, false);
  assert.equal(E.rowState(row, 100).gateClosed, false);
  assert.equal(E.rowState(row, -1).gateClosed, false, 'negative phases use positive modulo');
  row.gate.closed = true;
  assert.equal(E.rowState(row, 100).type[0], 'wall');
});

for (const mechanism of ['moving', 'gate']) {
  test(`${mechanism} collision is resolved at row time and remains unjumpable`, () => {
    const row = { t: 3, type: [null, null, null], gem: 0 };
    if (mechanism === 'moving') row.motion = { from: 2, to: 1, moveStart: .5, moveEnd: 2 };
    else row.gate = { lane: 1, period: .7, phase: .2, lockAt: 2, closed: true };
    const run = new E.Run(basic([row]));
    run.step(2.59); run.action('jump'); run.step(100);
    assert.equal(run.status, 'failed');
    assert.equal(run.time, 3);
    assert.equal(run.failure.type, 'wall');
    assert.equal(run.failure.mechanism, mechanism);
    assert.ok(run.failure.height > .99);
    const avoid = new E.Run(basic([row]));
    avoid.action('left'); avoid.step(100);
    assert.equal(avoid.status, 'won');
  });
}

test('an open latched gate is passable even if its earlier cycle was closed', () => {
  const row = { t: 3, type: [null, null, null], gem: 1, gate: { lane: 1, period: 1, phase: 0, lockAt: 2, closed: false } };
  const run = new E.Run(basic([row])); run.step(4);
  assert.equal(run.status, 'won');
  assert.equal(run.gems, 1);
});

test('bonus crystal substitutes one normal gem and combo, grants exactly 200 extra points', () => {
  const row = { t: .41, type: ['hurdle', null, 'wall'], gem: 1, bonusGem: 0 };
  const safe = new E.Run(basic([row])); safe.step(4);
  const risk = new E.Run(basic([row])); risk.action('left'); risk.action('jump'); risk.step(4);
  assert.equal(safe.gems, 1); assert.equal(risk.gems, 1);
  assert.equal(safe.combo, 1); assert.equal(risk.combo, 1);
  assert.equal(safe.totalGems, 1); assert.equal(risk.totalGems, 1);
  assert.equal(risk.bonusGems, 1); assert.equal(safe.bonusGems, 0);
  assert.equal(risk.score - safe.score, 200);
  assert.deepEqual(risk.drainEvents()[0], { type: 'gem', lane: 0, combo: 1, perfectJump: true, bonusPoints: 200 });
  assert.equal(risk.stars, 3);
  const crashed = new E.Run(basic([row])); crashed.action('left'); crashed.step(4);
  assert.equal(crashed.status, 'failed'); assert.equal(crashed.gems, 0); assert.equal(crashed.bonusGems, 0); assert.equal(crashed.score, 0);
});

test('normal and bonus crystal on the same lane still count only once without duplicate bonus', () => {
  const run = new E.Run(basic([{ t: 1, type: [null, null, null], gem: 1, bonusGem: 1 }]));
  run.step(4);
  assert.equal(run.gems, 1); assert.equal(run.combo, 1); assert.equal(run.bonusGems, 0); assert.equal(run.score, 1125);
});

test('all 15 trials include both new mechanisms, a clear route, bonus spacing and reaction warning', () => {
  for (let id = 1; id <= 15; id++) {
    const trial = X.makeTrial(id);
    assert.equal(trial.id, id); assert.equal(trial.baseId, id); assert.equal(trial.challengeKind, 'trial');
    assert.equal(trial.chapter, levels[id - 1].chapter);
    assert.equal(trial.name, levels[id - 1].name);
    assert.equal(trial.duration, levels[id - 1].duration);
    assert.deepEqual(trial.rows.map(row => row.t), levels[id - 1].rows.map(row => row.t));
    assert.ok(trial.rows.some(row => row.motion)); assert.ok(trial.rows.some(row => row.gate));
    let previousBonus = -Infinity;
    for (const row of trial.rows) {
      assert.equal(E.rowState(row, row.t).type[row.gem], null);
      if (row.motion) {
        assert.ok(row.motion.moveEnd <= row.t - .85 + 1e-8);
        assert.ok(row.motion.moveStart >= row.t - trial.lookAhead);
        assert.equal(row.type[row.motion.to], null);
        assert.notEqual(row.type[row.motion.from], 'wall', 'a departing wall must not leave a duplicate behind');
      }
      if (row.gate) assert.ok(row.gate.lockAt <= row.t - .85 + 1e-8);
      if (row.bonusGem !== undefined) {
        assert.ok(row.t - previousBonus >= 1.3);
        assert.notEqual(row.bonusGem, row.gem);
        assert.ok(['hurdle', 'gap'].includes(E.rowState(row, row.t).type[row.bonusGem]));
        previousBonus = row.t;
      }
    }
    assert.equal(trial.bonusTotal, trial.rows.filter(row => row.bonusGem !== undefined).length);
  }
});

for (let id = 1; id <= 15; id++) {
  for (const risk of [false, true]) for (const [name, steps, offset] of [
    ['60 Hz', [1 / 60], 0], ['30 Hz', [1 / 30], 0],
    ['irregular frames', [1 / 60, 1 / 38, 1 / 24, 1 / 55, 1 / 47], 0],
    ['100 ms early', [1 / 30], -.1], ['100 ms late', [1 / 30], .1]
  ]) test(`trial ${id} ${risk ? 'risk' : 'safe'} route: ${name}`, () => solveTrial(id, risk, steps, offset));
  test(`trial ${id}: risk and safe routes have equal collection and the advertised bonus difference`, () => {
    const safe = solveTrial(id, false), risk = solveTrial(id, true);
    assert.equal(risk.score - safe.score, risk.level.bonusTotal * 200);
    assert.equal(safe.perfectJumps, 0);
    assert.equal(risk.perfectJumps, risk.level.bonusTotal);
  });
}

test('endless generation is seed deterministic across arbitrary chunk boundaries', () => {
  for (const seed of [0, 1, 42, 20260922, 4294967295]) {
    const large = X.makeEndless(seed), small = X.makeEndless(seed);
    large.ensureRows(280);
    for (let time = 8; time < 280; time += .37) small.ensureRows(time);
    small.ensureRows(280);
    assert.deepEqual(small.rows, large.rows);
    assert.deepEqual(small.solution, large.solution);
    assert.deepEqual(small.riskSolution, large.riskSolution);
    assert.equal(large.duration, Infinity);
    assert.equal(large.endless, true);
    assert.equal(large.rows[0].t, 3.5);
    assert.ok(large.rows.some(row => row.tier === 8));
    let previous = 0, bonus = -Infinity;
    for (const row of large.rows) {
      assert.ok(row.tier >= 1 && row.tier <= 8);
      assert.ok(row.t - previous >= .95 - 1e-8); previous = row.t;
      assert.equal(E.rowState(row, row.t).type[row.gem], null);
      if (row.bonusGem !== undefined) { assert.ok(row.t - bonus >= 1.3); bonus = row.t; }
      if (row.motion) assert.ok(row.t - row.motion.moveEnd >= .85);
      if (row.gate) assert.ok(row.t - row.gate.lockAt >= .85);
    }
  }
  assert.notDeepEqual(X.makeEndless(1).rows, X.makeEndless(2).rows);
});

test('PR3-E-0000002A has a pinned route prefix so shared codes cannot silently change', () => {
  const route = X.makeEndless(42); route.ensureRows(24);
  assert.deepEqual(route.rows.slice(0, 8).map(row => [row.t, row.gem, row.bonusGem === undefined ? -1 : row.bonusGem,
    row.motion ? 'moving' : row.gate ? 'gate' : 'static']), [
    [3.5, 0, -1, 'gate'], [5.1, 1, -1, 'static'], [6.7, 2, -1, 'moving'], [8.3, 1, -1, 'gate'],
    [9.9, 0, 1, 'static'], [11.5, 2, -1, 'moving'], [13.1, 1, -1, 'gate'], [14.7, 0, -1, 'static']
  ]);
  // Includes every motion/gate time, phase, hazard type and optional crystal.
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(route.rows.slice(0, 12))).digest('hex'),
    'd8e5381dff2a082d2d52100eddd6d66d8f41b4aff2bd7ac6a4427f44f947116e');
});

for (const seed of [0, 1, 42, 20260922, 2147483647, 4294967295]) {
  for (const risk of [false, true]) for (const [name, steps, offset] of [
    ['60 Hz', [1 / 60], 0], ['30 Hz', [1 / 30], 0],
    ['irregular frames', [1 / 60, 1 / 38, 1 / 24, 1 / 55, 1 / 47], 0],
    ['100 ms early', [1 / 30], -.1], ['100 ms late', [1 / 30], .1]
  ]) test(`endless ${seed} ${risk ? 'risk' : 'safe'} route remains fair through tier 8 at ${name}`, () => {
    const run = solveEndless(seed, risk, 260, steps, offset);
    assert.equal(run.stage, 11); assert.equal(run.tier, 8);
    assert.ok(run.level.lookAhead >= 1.9);
    assert.equal(run.level.difficulty, 8);
    assert.equal(run.bonusGems > 0, risk);
  });
}

test('long endless run bounds both live rows and instructions without changing future generation', () => {
  const run = solveEndless(42, true, 1200, [1 / 30]);
  const reference = X.makeEndless(42); reference.ensureRows(1210);
  assert.ok(run._rowOffset > 1000);
  assert.equal(run.nextRow, 4);
  for (const row of run.level.rows) assert.deepEqual(row, reference.rows[row.index]);
  assert.ok(run.level.rows.length <= 18);
  assert.equal(run.status, 'running');
});

test('large simulation steps stream and prune encounters instead of allocating the entire elapsed route', () => {
  let next = 1;
  const level = { id: 1, duration: Infinity, endless: true, lookAhead: 2.9, rows: [], ensureRows(until) {
    while (next <= until) { this.rows.push({ t: next, type: [null, null, null], gem: 1 }); next++; }
  } };
  const run = new E.Run(level); run.step(500);
  assert.equal(run.status, 'running'); assert.equal(run.passed, 500);
  assert.equal(run.nextRow, 4); assert.ok(level.rows.length <= 12);
  assert.equal(run.drainEvents().some(event => event.type === 'win'), false);
});

test('distance integrates tier speed and difficulty caps while stages continue', () => {
  const run = new E.Run({ id: 1, duration: Infinity, endless: true, lookAhead: 2.9, rows: [] });
  for (const [time, distance, stage, tier] of [[25, 300, 2, 2], [50, 650, 3, 3], [175, 3150, 8, 8], [200, 3800, 9, 8], [1000, 24600, 41, 8]]) {
    run.step(time - run.time);
    assert.equal(run.distance, distance); assert.equal(run.stage, stage); assert.equal(run.tier, tier);
    assert.equal(run.progress, 0); assert.equal(run.stars, 0); assert.equal(run.status, 'running');
  }
  const score = run.score;
  assert.equal(run.finishEndless(), true);
  assert.equal(run.status, 'finished'); assert.equal(run.score, score);
  assert.equal(run.finishEndless(), false);
  assert.equal(run.action('jump'), false);
  run.step(10); assert.equal(run.time, 1000);
  assert.deepEqual(run.drainEvents(), [{ type: 'finish' }]);
  assert.equal(new E.Run(basic([])).finishEndless(), false);
});

test('endless risk route gains only its bonus count difference and settling grants no win bonus', () => {
  const safe = solveEndless(20260922, false, 80), risk = solveEndless(20260922, true, 80);
  assert.equal(safe.gems, risk.gems);
  assert.equal(risk.score - safe.score, risk.bonusGems * 200);
  const before = risk.score;
  risk.finishEndless(); assert.equal(risk.score, before); assert.equal(risk.stars, 0);
});

test('PR3 codes roundtrip the entire trial range and uint32 seed boundaries without changing PR2', () => {
  for (let id = 1; id <= 15; id++) {
    const code = X.encodeTrialCode(id);
    assert.deepEqual(X.parseCode(' \t' + code.toLowerCase() + '\n'), { kind: 'trial', baseId: id, mode: 'normal', code });
  }
  for (const seed of [0, 1, 42, 2147483648, 4294967295]) {
    const code = X.encodeEndlessCode(seed);
    assert.deepEqual(X.parseCode(code.toLowerCase()), { kind: 'endless', baseId: 1, mode: 'normal', seed, code });
    assert.deepEqual(X.makeEndless(X.parseCode(code).seed).rows, X.makeEndless(seed).rows);
  }
  assert.equal(X.encodeEndlessCode(0), 'PR3-E-00000000');
  assert.equal(X.encodeEndlessCode(4294967295), 'PR3-E-FFFFFFFF');
  assert.equal(C.parseCode('PR2-L05-M').baseId, 5);
  assert.equal(X.parseCode('PR2-L05-M'), null);
  for (const code of ['', null, 12, 'PR3-T-00', 'PR3-T-16', 'PR3-T-1', 'PR3-E-42', 'PR3-E-100000000', 'PR3-E-G0000000', 'PR3-T-０１', '\u00a0PR3-T-01', 'PR3-T-01 trailing', ' '.repeat(65) + 'PR3-T-01']) assert.equal(X.parseCode(code), null);
  for (const id of [0, 16, '1', NaN, 1.2]) { assert.throws(() => X.makeTrial(id), RangeError); assert.throws(() => X.encodeTrialCode(id), RangeError); }
  for (const seed of [-1, 4294967296, Infinity, NaN, .2, '42', undefined]) { assert.throws(() => X.makeEndless(seed), RangeError); assert.throws(() => X.encodeEndlessCode(seed), RangeError); }
});

test('classic browser module uses no new padding API or implicit engine dependency', () => {
  const sandbox = vm.createContext({ PulseLevels: levels });
  vm.runInContext('String.prototype.padStart=undefined;', sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../web/expedition.js'), 'utf8'), sandbox);
  assert.equal(sandbox.PulseExpedition.encodeTrialCode(1), 'PR3-T-01');
  assert.equal(sandbox.PulseExpedition.encodeEndlessCode(42), 'PR3-E-0000002A');
  assert.equal(sandbox.PulseExpedition.makeTrial(1).challengeKind, 'trial');
});

test('trial results are isolated, retain maxima, and cannot be recorded before a terminal state', () => {
  const save = E.emptySave(), before = JSON.stringify(save);
  E.recordRun(save, new E.Run(X.makeTrial(5)));
  assert.equal(JSON.stringify(save), before);
  const risk = solveTrial(5, true); E.recordRun(save, risk);
  assert.equal(save.unlocked, 1); assert.equal(save.attempts, 0);
  assert.deepEqual(save.records, {}); assert.deepEqual(save.challengeRecords, {}); assert.deepEqual(save.dailyRecords, {});
  assert.equal(save.trialRecords[5].wins, 1); assert.equal(save.trialRecords[5].attempts, 1);
  assert.equal(save.trialRecords[5].bestBonus, risk.bonusGems);
  assert.equal(save.trialRecords[5].stars, 3);
  assert.equal(E.getRecord(save, risk.level), save.trialRecords[5]);
  const safe = solveTrial(5, false); E.recordRun(save, safe);
  assert.equal(save.trialRecords[5].wins, 2); assert.equal(save.trialRecords[5].bestScore, risk.score);
  const failed = new E.Run(X.makeTrial(5)); failed.step(100); assert.equal(failed.status, 'failed'); E.recordRun(save, failed);
  assert.equal(save.trialRecords[5].attempts, 3); assert.equal(save.trialRecords[5].wins, 2);
  assert.equal(save.trialRecords[5].bestScore, risk.score);
  assert.deepEqual(E.cleanSave(JSON.parse(JSON.stringify(save))), save);
});

test('endless settlements and failures update only endless maxima and attempts', () => {
  const save = E.emptySave(), run = solveEndless(42, true, 60);
  E.recordRun(save, run); assert.equal(save.endlessRecord.attempts, 0);
  run.finishEndless(); E.recordRun(save, run);
  assert.equal(save.endlessRecord.attempts, 1);
  assert.equal(save.endlessRecord.bestScore, run.score);
  assert.equal(save.endlessRecord.bestDistance, run.distance);
  assert.ok(Math.abs(save.endlessRecord.bestTime - 60) < 1e-7);
  assert.equal(save.endlessRecord.bestCombo, run.maxCombo);
  assert.equal(save.endlessRecord.bestBonus, run.bonusGems);
  assert.equal(save.endlessRecord.bestStage, 3);
  assert.equal(E.getRecord(save, run.level), save.endlessRecord);
  const failed = new E.Run(X.makeEndless(1)); failed.step(100); assert.equal(failed.status, 'failed'); E.recordRun(save, failed);
  assert.equal(save.endlessRecord.attempts, 2);
  assert.equal(save.endlessRecord.bestScore, run.score);
  assert.equal(save.unlocked, 1); assert.equal(save.attempts, 0);
  assert.deepEqual(save.records, {}); assert.deepEqual(save.trialRecords, {}); assert.deepEqual(save.challengeRecords, {}); assert.deepEqual(save.dailyRecords, {});
  assert.deepEqual(E.cleanSave(JSON.parse(JSON.stringify(save))), save);
});

test('practice trials and practice endless runs cannot modify any save field', () => {
  const save = E.cleanSave({ records: { 1: { stars: 3, attempts: 4 } }, attempts: 4, goalProgress: { firstwin: 1 } });
  const before = JSON.stringify(save), trial = solveTrial(15, true, [1 / 30], 0, true);
  E.recordRun(save, trial); assert.equal(JSON.stringify(save), before);
  const endless = solveEndless(1, true, 30, [1 / 30], 0, true); endless.finishEndless();
  E.recordRun(save, endless); assert.equal(JSON.stringify(save), before);
});

test('old saves migrate without changing campaign, daily, challenge or earned goals', () => {
  const old = { version: 1, sound: false, music: false, effects: false, vibration: false, attempts: 8,
    records: { 1: { stars: 3, gems: 15, progress: 1, attempts: 8, bestScore: 5000, bestCombo: 15 } },
    challengeRecords: { '5-mirror': { stars: 2, wins: 1, attempts: 3, bestScore: 6000 } },
    dailyRecords: { '2026-09-22': { baseId: 4, mode: 'mirror', wins: 2, attempts: 5 } }, goalProgress: { daily3: 3 } };
  const save = E.cleanSave(old);
  assert.deepEqual(save.records, old.records); assert.equal(save.unlocked, 2); assert.equal(save.attempts, 8);
  assert.equal(save.challengeRecords['5-mirror'].wins, 1); assert.equal(save.dailyRecords['2026-09-22'].wins, 2);
  assert.deepEqual(save.goalProgress, old.goalProgress);
  assert.deepEqual(save.trialRecords, {}); assert.deepEqual(save.endlessRecord, E.emptySave().endlessRecord);
  for (const key of ['sound', 'music', 'effects', 'vibration']) assert.equal(save[key], false);
});

test('new record sanitization bounds finite numeric values and discards invalid course IDs', () => {
  const save = E.cleanSave({ trialRecords: { 1: { stars: 9, gems: -1, progress: 2, attempts: Infinity, wins: '4', bestScore: NaN, bestCombo: 4.9, bestBonus: 2.9 }, 16: { wins: 1 }, 0: { wins: 1 } },
    endlessRecord: { attempts: 2.9, bestScore: Infinity, bestDistance: -9, bestTime: 12.345, bestCombo: '99', bestBonus: NaN, bestStage: 999999999999 } });
  assert.deepEqual(save.trialRecords[1], { stars: 3, gems: 0, progress: 1, attempts: 0, wins: 0, bestScore: 0, bestCombo: 4, bestBonus: 2 });
  assert.deepEqual(Object.keys(save.trialRecords), ['1']);
  assert.deepEqual(save.endlessRecord, { attempts: 2, bestScore: 0, bestDistance: 0, bestTime: 12.345, bestCombo: 0, bestBonus: 0, bestStage: 1000000000 });
  const fresh = E.emptySave(); fresh.endlessRecord.bestScore = 1; fresh.trialRecords[1] = {};
  assert.equal(E.emptySave().endlessRecord.bestScore, 0); assert.deepEqual(E.emptySave().trialRecords, {});
});

test('full campaign, trial, endless, daily and remix saves fit the native 65,536-character limit', t => {
  const save = E.emptySave();
  const stats = { stars: 3, gems: 1000000000, progress: 1, attempts: 1000000000, wins: 1000000000,
    bestScore: 1000000000, bestCombo: 1000000000, bestBonus: 1000000000 };
  for (let id = 1; id <= 15; id++) {
    save.records[id] = Object.assign({}, stats);
    save.trialRecords[id] = Object.assign({}, stats);
    for (const mode of ['normal', 'mirror', 'rush', 'mirrorRush']) save.challengeRecords[id + '-' + mode] = Object.assign({}, stats, { baseId: id, mode });
  }
  for (let day = 1; day <= 60; day++) {
    const key = C.localDateKey(new Date(2026, 0, day));
    const daily = C.makeDaily(key);
    save.dailyRecords[key] = Object.assign({}, stats, { baseId: daily.baseId, mode: daily.mode });
  }
  Object.keys(save.endlessRecord).forEach(key => { save.endlessRecord[key] = 1000000000; });
  for (const goal of C.getGoals(save)) save.goalProgress[goal.id] = goal.target;
  const cleaned = E.cleanSave(save), text = JSON.stringify(cleaned);
  assert.equal(Object.keys(cleaned.trialRecords).length, 15);
  assert.equal(Object.keys(cleaned.challengeRecords).length, 60);
  assert.equal(Object.keys(cleaned.dailyRecords).length, 60);
  assert.ok(text.length < 65536, `native save limit exceeded: ${text.length} characters`);
  assert.deepEqual(E.cleanSave(JSON.parse(text)), cleaned);
  t.diagnostic(`Maximal populated save: ${text.length} / 65536 characters`);
});

test('original 15 levels and PR2 routes remain byte-for-byte unchanged by expedition work', () => {
  assert.equal(JSON.stringify(levels), authored);
  for (let id = 1; id <= 15; id++) assert.deepEqual(C.makeLevel(id, 'normal').rows, levels[id - 1].rows);
});
