'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { Run } = require('../web/engine.js');
const levels = require('../web/levels.js');
const C = require('../web/challenges.js');
const originalLevels = JSON.stringify(levels);
const modeIds = ['normal', 'mirror', 'rush', 'mirrorRush'];

function goal(save, id) { return C.getGoals(save).find(item => item.id === id); }

test('four challenge modes expose frozen metadata and an explicit offline notice', () => {
  assert.deepEqual(C.MODES.map(mode => mode.id), modeIds);
  assert.deepEqual(C.MODES.map(mode => mode.name), ['原版', '镜像', '疾速', '镜像疾速']);
  assert.deepEqual(C.MODES.map(mode => mode.code), ['N', 'M', 'R', 'X']);
  assert.ok(C.MODES.every(mode => Object.isFrozen(mode) && mode.description));
  assert.ok(Object.isFrozen(C.MODES));
  assert.match(C.OFFLINE_NOTICE, /无需联网/);
  assert.match(C.OFFLINE_NOTICE, /不提供在线排行榜/);
});

test('browser classic-script global works without Node or String.padStart', () => {
  const sandbox = vm.createContext({ PulseLevels: levels });
  vm.runInContext('String.prototype.padStart = undefined;', sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../web/challenges.js'), 'utf8'), sandbox);
  assert.equal(sandbox.PulseChallenges.makeLevel(5, 'mirrorRush').challengeKey, '5-mirrorRush');
  assert.equal(sandbox.PulseChallenges.encodeLevelCode(5, 'mirror'), 'PR2-L05-M');
  assert.equal(sandbox.PulseChallenges.encodeDailyCode('2026-09-22'), 'PR2-20260922');
});

test('normal challenge is a fully separate clone with the original playable route', () => {
  const first = C.makeLevel(5), second = C.makeLevel(5);
  assert.deepEqual(first.rows, levels[4].rows);
  assert.deepEqual(first.solution, levels[4].solution);
  assert.equal(first.challengeMode, 'normal');
  assert.equal(first.challengeKind, 'level');
  assert.equal(first.challengeKey, '5-normal');
  assert.equal(first.baseId, 5);
  assert.equal(first.id, 5);
  assert.equal(first.chapter, levels[4].chapter);
  first.rows[0].type[0] = 'corrupted'; first.rows[0].gem = -1;
  first.solution[0].action = 'invalid'; first.name = 'modified';
  assert.deepEqual(second.rows, levels[4].rows);
  assert.deepEqual(second.solution, levels[4].solution);
  assert.equal(JSON.stringify(levels), originalLevels);
});

for (const base of levels) {
  test(`level ${base.id}: mirror and rush transformations preserve authored structure`, () => {
    for (const modeId of modeIds) {
      const settings = C.MODES.find(mode => mode.id === modeId), variant = C.makeLevel(base.id, modeId);
      assert.equal(variant.id, base.id);
      assert.equal(variant.name, base.name);
      assert.equal(variant.chapter, base.chapter);
      assert.equal(variant.difficulty, base.difficulty);
      assert.equal(variant.duration, base.duration / settings.speedFactor);
      assert.equal(variant.lookAhead, base.lookAhead / settings.speedFactor);
      assert.equal(variant.rows.length, base.rows.length);
      assert.equal(variant.maxGems, base.maxGems);
      assert.equal(variant.isMirrored, settings.mirror);
      for (let i = 0; i < base.rows.length; i++) {
        const expected = base.rows[i], actual = variant.rows[i];
        assert.equal(actual.t, expected.t / settings.speedFactor);
        assert.deepEqual(actual.type, settings.mirror ? expected.type.slice().reverse() : expected.type);
        assert.equal(actual.gem, settings.mirror && expected.gem >= 0 ? 2 - expected.gem : expected.gem);
      }
      for (let i = 0; i < base.solution.length; i++) {
        const expected = base.solution[i], actual = variant.solution[i];
        assert.equal(actual.t, expected.t / settings.speedFactor);
        assert.equal(actual.action, settings.mirror && expected.action !== 'jump'
          ? expected.action === 'left' ? 'right' : 'left' : expected.action);
      }
    }
  });
}

test('invalid base IDs and modes fail explicitly without mutating campaign data', () => {
  for (const id of [0, 16, -1, 1.1, '1', undefined, NaN, Infinity]) {
    assert.throws(() => C.makeLevel(id, 'mirror'), RangeError);
    assert.throws(() => C.encodeLevelCode(id, 'mirror'), RangeError);
  }
  for (const mode of [null, '', 'M', 'MIRROR', 'mirror-rush', {}, 2]) {
    assert.throws(() => C.makeLevel(1, mode), RangeError);
    assert.throws(() => C.encodeLevelCode(1, mode), RangeError);
  }
  assert.equal(JSON.stringify(levels), originalLevels);
});

test('daily challenge is deterministic, independent of lock state and uses a non-normal mode', () => {
  const first = C.makeDaily('2026-09-22'), second = C.makeDaily('2026-09-22');
  assert.deepEqual(first, second);
  assert.deepEqual(C.parseCode(first.code), { kind: 'daily', dateKey: '2026-09-22', baseId: 4, mode: 'mirror', code: 'PR2-20260922' });
  assert.equal(first.level.id, 4, 'daily construction does not require campaign unlocks');
  assert.equal(first.level.dailyDate, first.dateKey);
  assert.equal(first.level.dailyCode, first.code);
  assert.equal(first.level.challengeKind, 'daily');
  first.level.rows[0].gem = -1;
  assert.deepEqual(second, C.makeDaily('2026-09-22'));
  const observed = new Set();
  for (let day = 1; day <= 28; day++) {
    const daily = C.makeDaily(`2026-09-${String(day).padStart(2, '0')}`);
    assert.ok(daily.baseId >= 1 && daily.baseId <= 15);
    assert.ok(['mirror', 'rush', 'mirrorRush'].includes(daily.mode));
    observed.add(daily.baseId + ':' + daily.mode);
  }
  assert.ok(observed.size >= 10, 'nearby dates should offer varied existing routes');
});

test('date validation rejects rollover dates and handles Gregorian leap-year rules', () => {
  for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31', '2026-04-30']) {
    assert.equal(C.validDateKey(date), true);
    assert.equal(C.parseCode(C.encodeDailyCode(date)).dateKey, date);
  }
  for (const date of ['2026-02-29', '1900-02-29', '2100-02-29', '2026-04-31', '2026-00-12', '2026-13-01', '2026-01-00', '0000-01-01', '2026-9-22', ' 2026-09-22', null, 20260922]) {
    assert.equal(C.validDateKey(date), false);
    assert.throws(() => C.makeDaily(date), RangeError);
    assert.throws(() => C.encodeDailyCode(date), RangeError);
  }
});

test('localDateKey uses the local calendar across UTC midnight boundaries', () => {
  const modulePath = path.resolve(__dirname, '../web/challenges.js');
  const program = "const c=require(process.argv[1]);process.stdout.write(c.localDateKey(new Date('2026-09-21T18:00:00.000Z')));";
  for (const [zone, expected] of [['Asia/Shanghai', '2026-09-22'], ['America/Los_Angeles', '2026-09-21'], ['UTC', '2026-09-21']]) {
    assert.equal(execFileSync(process.execPath, ['-e', program, modulePath], { encoding: 'utf8', env: { ...process.env, TZ: zone } }), expected);
  }
  assert.equal(C.localDateKey(new Date(2026, 8, 22, 0, 1)), '2026-09-22');
  for (const date of [new Date(NaN), null, '2026-09-22', {}, 0]) assert.equal(C.localDateKey(date), null);
  assert.ok(C.validDateKey(C.localDateKey()));
});

test('every mode and level code roundtrips and is ASCII case insensitive', () => {
  for (const base of levels) for (const mode of C.MODES) {
    const code = C.encodeLevelCode(base.id, mode.id);
    const expected = { kind: 'level', baseId: base.id, mode: mode.id, code };
    assert.deepEqual(C.parseCode(code), expected);
    assert.deepEqual(C.parseCode(' \t' + code.toLowerCase() + '\r\n'), expected);
  }
  assert.equal(C.encodeLevelCode(1), 'PR2-L01-N');
  assert.equal(C.parseCode(' pr2-20240229 ').dateKey, '2024-02-29');
});

test('malformed or overlong challenge codes are rejected without permissive date parsing', () => {
  for (const code of [null, undefined, 123, {}, '', 'PR2-L00-M', 'PR2-L16-X', 'PR2-L5-M', 'PR2-L05-A', 'PR1-L05-M', 'PR2-L05-M-extra', 'PR2-20260229', 'PR2-19000229', 'PR2-00000101', 'PR2-2026-09-22', 'PR2-L０５-M', 'ＰＲ２-L05-M', '\u00a0PR2-L05-M', 'PR2- L05-M', 'PR2-L05-M\0', ' '.repeat(65), ' '.repeat(56) + 'PR2-L05-M']) {
    assert.equal(C.parseCode(code), null, `must reject ${JSON.stringify(code)}`);
  }
  const code = 'PR2-L05-M';
  assert.equal(C.parseCode(' '.repeat(64 - code.length) + code).mode, 'mirror');
  assert.equal(C.parseCode(' '.repeat(65 - code.length) + code), null);
});

test('daily codes restore the same route across local dates and time zones', () => {
  const modulePath = path.resolve(__dirname, '../web/challenges.js');
  const program = "const c=require(process.argv[1]);const d=c.parseCode('pr2-20260922');process.stdout.write(JSON.stringify(c.makeDaily(d.dateKey)));";
  const expected = JSON.stringify(C.makeDaily('2026-09-22'));
  for (const zone of ['Asia/Shanghai', 'America/Los_Angeles']) {
    assert.equal(execFileSync(process.execPath, ['-e', program, modulePath], { encoding: 'utf8', env: { ...process.env, TZ: zone } }), expected);
  }
});

test('ten goals derive old campaign achievements without fabricated hidden counters', () => {
  const save = { unlocked: 15, records: {} };
  assert.equal(C.getGoals(save).length, 10);
  assert.equal(new Set(C.getGoals(save).map(item => item.id)).size, 10);
  assert.ok(C.getGoals(save).every(item => item.current === 0 && !item.unlocked));
  for (let id = 1; id <= 5; id++) save.records[id] = { stars: 3, attempts: 100 };
  assert.equal(goal(save, 'firstwin').unlocked, true);
  assert.equal(goal(save, 'fivewins').unlocked, true);
  assert.equal(goal(save, 'stars15').unlocked, true);
  assert.equal(goal(save, 'allwins').current, 5);
  assert.equal(goal(save, 'stars45').current, 15);
  assert.equal(goal(save, 'combo20').current, 0, 'legacy collection counts are not invented combo history');
  for (let id = 6; id <= 15; id++) save.records[id] = { stars: 3 };
  assert.equal(goal(save, 'allwins').unlocked, true);
  assert.equal(goal(save, 'stars45').unlocked, true);
});

test('mode achievements count unique base levels and mirrorRush qualifies for both', () => {
  const save = { challengeRecords: {
    '1-mirror': { wins: 50 }, '1-mirrorRush': { wins: 3 }, '2-mirrorRush': { wins: 1 },
    '3-mirror': { wins: 1 }, '4-mirror': { wins: 1 }, '5-mirror': { wins: 1 },
    '6-rush': { wins: 0, attempts: 100 }, '7-normal': { wins: 2 }
  } };
  assert.equal(goal(save, 'mirror5').current, 5);
  assert.equal(goal(save, 'mirror5').unlocked, true);
  assert.equal(goal(save, 'rush5').current, 2);
  assert.equal(goal(save, 'firstwin').unlocked, true);
  assert.equal(goal(save, 'fivewins').current, 0);
  assert.equal(goal(save, 'stars15').current, 0);
});

test('daily achievements count distinct valid dates and also credit their derived modes', () => {
  const save = { dailyRecords: {
    '2026-09-22': { wins: 20 }, '2024-02-29': { wins: 1 }, '2000-02-29': { wins: 1 },
    '2026-09-23': { wins: 0 }, '2026-02-29': { wins: 999 }
  } };
  assert.equal(goal(save, 'daily3').current, 3);
  assert.equal(goal(save, 'daily3').unlocked, true);
  assert.equal(goal(save, 'mirror5').current, 2);
  assert.equal(goal(save, 'rush5').current, 2);
  assert.equal(goal(save, 'firstwin').unlocked, true);
});

test('combo goals use the best recorded combo across campaign and standalone modes', () => {
  const save = { records: { 1: { bestCombo: 19 } }, challengeRecords: { '2-rush': { bestCombo: 20 } }, dailyRecords: { '2026-09-22': { bestCombo: 50 } } };
  assert.equal(goal(save, 'combo20').current, 20);
  assert.equal(goal(save, 'combo50').current, 50);
  assert.equal(goal(save, 'combo50').unlocked, true);
  assert.equal(goal(save, 'firstwin').unlocked, false);
});

test('saved goal progress preserves earned milestones when older records rotate out', () => {
  const save = { goalProgress: { daily3: 3, mirror5: 5, rush5: 4, combo20: 19 }, records: { 1: { bestCombo: 22 } } };
  assert.equal(goal(save, 'daily3').unlocked, true);
  assert.equal(goal(save, 'mirror5').unlocked, true);
  assert.equal(goal(save, 'rush5').current, 4);
  assert.equal(goal(save, 'rush5').unlocked, false);
  assert.equal(goal(save, 'combo20').unlocked, true);
  assert.equal(goal(save, 'combo50').current, 22);
});

test('malformed goal records are ignored and progress is finite, nonnegative and capped', () => {
  for (const malformed of [null, undefined, false, 42, 'invalid']) assert.ok(C.getGoals(malformed).every(item => item.current === 0));
  const save = { records: { 1: { stars: NaN, bestCombo: Infinity }, 16: { stars: 3, bestCombo: 100 } },
    challengeRecords: { '0-mirror': { wins: 20 }, '16-rush': { wins: 30 }, '1-fake': { wins: 20 }, '1-mirror': { wins: '9', bestCombo: NaN } },
    dailyRecords: { 'bad': { wins: 30 }, '2026-09-22': { wins: Infinity, bestCombo: -20 } },
    goalProgress: { firstwin: Infinity, fivewins: NaN, allwins: -2, stars15: '99', stars45: 999, combo20: 4.9, ghost: 1000 } };
  assert.equal(goal(save, 'firstwin').current, 0);
  assert.equal(goal(save, 'fivewins').current, 0);
  assert.equal(goal(save, 'allwins').current, 0);
  assert.equal(goal(save, 'stars15').current, 0);
  assert.equal(goal(save, 'stars45').current, 45);
  assert.equal(goal(save, 'combo20').current, 4);
  assert.equal(C.getGoals(save).some(item => item.id === 'ghost'), false);
});

function solve(spec, frameSteps, offset) {
  const run = new Run(spec);
  let next = 0, frame = 0;
  while (run.status === 'running' && frame < 20000) {
    while (next < spec.solution.length && spec.solution[next].t + offset <= run.time + 1e-9) {
      const input = spec.solution[next++];
      assert.equal(run.action(input.action), true, `${spec.challengeKey}: rejected ${input.action} at ${run.time}`);
    }
    run.step(frameSteps[frame++ % frameSteps.length]);
  }
  assert.equal(run.status, 'won', `${spec.challengeKey}: ${JSON.stringify(run.failure)}`);
  assert.equal(run.gems, spec.maxGems);
  assert.equal(run.stars, 3);
  assert.equal(run.maxCombo, spec.maxGems);
}

for (const base of levels) for (const mode of modeIds) {
  const spec = C.makeLevel(base.id, mode);
  for (const [name, steps, offset] of [
    ['60 Hz', [1 / 60], 0], ['30 Hz', [1 / 30], 0],
    ['irregular frames', [1 / 60, 1 / 38, 1 / 24, 1 / 55, 1 / 47], 0],
    ['100 ms early inputs', [1 / 30], -.1], ['100 ms late inputs', [1 / 30], .1]
  ]) test(`${spec.challengeKey}: full-gem route survives ${name}`, () => solve(spec, steps, offset));
}

test('creating and solving every challenge leaves the original 15 levels untouched', () => {
  assert.equal(JSON.stringify(levels), originalLevels);
});
