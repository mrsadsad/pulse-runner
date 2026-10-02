'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('../web/engine.js');
const R = require('../web/replay.js');
const C = require('../web/challenges.js');
const X = require('../web/expedition.js');
const levels = require('../web/levels.js');

function basic(rows = [], duration = 4) { return { id: 1, chapter: 1, name: '测试赛道', rows, duration, lookAhead: 2.8 }; }
function attach(level, options) {
  const recorder = new R.Recorder(R.keyFor(level));
  const updates = [];
  const run = new E.Run(level, Object.assign({}, options, { onUpdate(state) {
    recorder.observe(state);
    updates.push(snapshot(state));
  } }));
  return { run, recorder, updates };
}
function snapshot(run) {
  return { time: run.time, lane: run.lane, previousLane: run.previousLane, movedAt: run.movedAt,
    jumpedAt: run.jumpedAt, score: run.score, gems: run.gems, combo: run.combo, bonusGems: run.bonusGems,
    perfectJumps: run.perfectJumps, status: run.status, nextRow: run.nextRow + (run._rowOffset || 0),
    passed: run.passed, jumpHeight: run.jumpHeight() };
}
function samePose(actual, expected) {
  assert.ok(actual, 'a covered state must be sampled');
  for (const key of ['lane', 'previousLane', 'score', 'gems', 'combo', 'bonusGems', 'perfectJumps', 'status', 'nextRow', 'passed']) assert.equal(actual[key], expected[key], key);
  for (const key of ['time', 'movedAt', 'jumpedAt']) assert.ok(Math.abs(actual[key] - expected[key]) <= .00000101, `${key}: ${actual[key]} vs ${expected[key]}`);
  assert.ok(Math.abs(actual.jumpHeight - expected.jumpHeight) <= .00001, `jump height ${actual.jumpHeight} vs ${expected.jumpHeight}`);
}
function terminalTrack(id = 1, side = null) {
  const level = basic([], 2); level.id = id;
  return finishFixture(attach(level), side);
}
function finishFixture(fixture, side) {
  if (side) fixture.run.action(side);
  fixture.run.step(fixture.run.level.duration);
  return fixture.recorder.track(fixture.run);
}
function play(level, risk = false, options) {
  const fixture = attach(level, options), solution = risk ? level.riskSolution : level.solution;
  for (const action of solution) {
    if (action.t < fixture.run.time - 1e-8) continue;
    fixture.run.step(action.t - fixture.run.time);
    assert.equal(fixture.run.action(action.action), true);
  }
  fixture.run.step(level.duration - fixture.run.time);
  assert.equal(fixture.run.status, 'won');
  return fixture;
}
function endless(seconds = 260, seed = 42, recorderOn = true, options) {
  const level = X.makeEndless(seed), fixture = recorderOn ? attach(level, options) : { run: new E.Run(level, options) };
  let lastAction = -Infinity;
  while (fixture.run.status === 'running' && fixture.run.time < seconds - 1e-8) {
    for (const action of level.riskSolution) {
      if (action.t <= lastAction + 1e-8) continue;
      if (action.t > fixture.run.time + 1e-8) break;
      assert.equal(fixture.run.action(action.action), true);
      lastAction = action.t;
    }
    fixture.run.step(Math.min(1 / 30, seconds - fixture.run.time));
    fixture.run.drainEvents();
  }
  assert.equal(fixture.run.status, 'running');
  return fixture;
}

test('observer sees initialized state, successful immediate actions, row scores and terminal state', () => {
  const fixture = attach(basic([{ t: .4, type: [null, null, null], gem: 0 }]));
  assert.equal(fixture.updates.length, 1);
  assert.equal(fixture.updates[0].time, 0); assert.equal(fixture.updates[0].lane, 1);
  fixture.run.action('left');
  const count = fixture.updates.length;
  assert.equal(fixture.run.action('left'), false);
  assert.equal(fixture.run.action('right'), false);
  fixture.run.step(.2);
  assert.equal(fixture.updates.length, count, 'clock-only steps and rejected inputs do not create operation frames');
  fixture.run.step(.3);
  assert.equal(fixture.updates[fixture.updates.length - 1].score, 125);
  assert.equal(fixture.updates[fixture.updates.length - 1].nextRow, 1);
  fixture.run.step(4);
  assert.equal(fixture.updates[fixture.updates.length - 1].status, 'won');
  assert.equal(fixture.updates[fixture.updates.length - 1].score, 1125);
});

test('throwing or reentrant observer callbacks cannot interrupt physics or recurse indefinitely', () => {
  let calls = 0;
  const level = basic([{ t: .4, type: [null, null, null], gem: 1 }]);
  const throwing = new E.Run(level, { onUpdate() { calls++; throw new Error('observer failed'); } });
  throwing.action('jump'); throwing.step(4);
  const ordinary = new E.Run(level); ordinary.action('jump'); ordinary.step(4);
  assert.ok(calls >= 4);
  assert.deepEqual(snapshot(throwing), snapshot(ordinary));
  assert.deepEqual(throwing.drainEvents(), ordinary.drainEvents());
  let recursive = 0;
  const guarded = new E.Run(basic(), { onUpdate(run) { recursive++; run._notify(); } });
  guarded.action('left');
  assert.equal(recursive, 2);
});

test('buffered actions are captured only when they execute, at their actual ready time', () => {
  const fixture = attach(basic([{ t: 1.23, type: [null, 'hurdle', null], gem: 1 }]));
  fixture.run.input('jump'); fixture.run.step(.75); fixture.run.input('left');
  const beforeQueue = fixture.updates.length;
  fixture.run.input('right'); fixture.run.input('jump');
  assert.equal(fixture.updates.length, beforeQueue);
  fixture.run.step(.6);
  assert.ok(fixture.updates.some(state => Math.abs(state.time - .82) < 1e-9 && state.jumpedAt === .82));
  assert.ok(fixture.updates.some(state => Math.abs(state.time - .85) < 1e-9 && state.lane === 1));
  fixture.run.step(4);
  const track = fixture.recorder.track(fixture.run);
  assert.equal(R.sample(track, .80).lane, 0);
  assert.equal(R.sample(track, .83).lane, 0);
  assert.equal(R.sample(track, .83).jumpedAt, .82);
  assert.equal(R.sample(track, .86).lane, 1);
  assert.ok(R.sample(track, 1.23).jumpHeight > .99999);
  assert.equal(R.sample(track, 1.23).perfectJumps, 1);
});

test('microsecond times preserve arbitrary movement and jump poses between events', () => {
  const fixture = attach(basic([], 3));
  fixture.run.step(.123456789); fixture.run.action('left');
  fixture.run.step(.222222222); fixture.run.action('jump');
  const observations = [];
  for (let i = 0; i < 30; i++) { fixture.run.step(.02); observations.push(snapshot(fixture.run)); }
  fixture.run.step(3);
  const track = fixture.recorder.track(fixture.run);
  for (const expected of observations) samePose(R.sample(track, expected.time), expected);
  assert.ok(Object.isFrozen(R.sample(track, .5)));
});

test('same-timestamp updates retain the final actual pose and updated row score', () => {
  const fixture = attach(basic([{ t: .1, type: ['wall', null, 'wall'], gem: 1 }]));
  fixture.run.input('left'); fixture.run.input('right');
  fixture.run.step(.1); fixture.run.action('jump'); fixture.run.step(4);
  const track = fixture.recorder.track(fixture.run), state = R.sample(track, .1);
  assert.equal(state.lane, 1); assert.equal(state.score, 125); assert.equal(state.jumpedAt, .1);
  assert.equal(track.frames.filter(frame => frame[0] === 100000).length, 1);
  assert.equal(state.jumpHeight, 0);
});

test('failure clip is the last six seconds, independent and frozen, with the real collision state', () => {
  const fixture = attach(levels[0]); fixture.run.step(30);
  const clip = fixture.recorder.clip(fixture.run), before = snapshot(fixture.run);
  assert.equal(clip.end, fixture.run.time);
  assert.equal(clip.end - clip.start, 6);
  assert.equal(clip.status, 'failed');
  const replay = R.view(clip, clip.end);
  assert.equal(replay.status, 'failed'); assert.deepEqual(replay.failure, fixture.run.failure);
  assert.equal(replay.score, fixture.run.score); assert.equal(replay.gems, fixture.run.gems);
  assert.equal(replay.level.rows[replay.nextRow].t, fixture.run.time);
  assert.equal(replay.jumpHeight(), fixture.run.jumpHeight());
  for (let time = clip.start; time < clip.end; time += .1) assert.ok(R.view(clip, time));
  assert.deepEqual(snapshot(fixture.run), before);
  assert.ok(Object.isFrozen(clip) && Object.isFrozen(clip.level.rows) && Object.isFrozen(clip.frames[0]));
  assert.ok(Object.isFrozen(replay) && Object.isFrozen(replay.level));
  assert.throws(() => { clip.frames[0][1] = 9; }, TypeError);
  assert.throws(() => { replay.level.rows[0].gem = 9; }, TypeError);
  assert.equal(R.view(clip, clip.start - .01), null);
  assert.equal(R.view(clip, clip.end + .01), null);
  assert.equal(R.view(clip, NaN), null);
});

test('practice clips start at available practice time and practice tracks never enter the archive', () => {
  const level = X.makeTrial(8), fixture = attach(level, { practice: true, startRow: 12 });
  const began = fixture.run.time;
  fixture.run.step(100);
  assert.equal(fixture.run.status, 'failed');
  const clip = fixture.recorder.clip(fixture.run);
  assert.ok(clip.start >= began - 1e-6);
  assert.ok(clip.end - clip.start <= 6 + 1e-6);
  assert.ok(clip.level.rows.every(row => row._replayIndex >= 12));
  assert.equal(clip.practice, true);
  assert.equal(fixture.recorder.track(fixture.run), null);
  const save = E.emptySave(), before = JSON.stringify(save);
  E.recordRun(save, fixture.run); assert.equal(JSON.stringify(save), before);
});

test('endless clips cache pruned rows and reproduce dynamic obstacle states without regeneration', () => {
  const fixture = endless(260), run = fixture.run;
  // Stop providing inputs: the next collision gives a real, late failure.
  run.step(20); assert.equal(run.status, 'failed');
  const clip = fixture.recorder.clip(run);
  assert.ok(run._rowOffset > 150);
  assert.ok(clip.level.rows.some(row => row._replayIndex < run._rowOffset), 'cache must retain rows no longer in the live engine window');
  const reference = X.makeEndless(42); reference.ensureRows(run.time + 4);
  for (const cached of clip.level.rows) {
    const source = reference.rows[cached._replayIndex];
    assert.deepEqual(cached.type, source.type); assert.deepEqual(cached.motion, source.motion); assert.deepEqual(cached.gate, source.gate);
    assert.deepEqual(E.rowState(cached, clip.start + 1), E.rowState(source, clip.start + 1));
  }
  const frozenBefore = JSON.stringify(clip.frames);
  reference.ensureRows(500);
  assert.equal(JSON.stringify(clip.frames), frozenBefore);
  const replay = R.view(clip, clip.end);
  assert.equal(replay.distance, run.distance); assert.equal(replay.stage, run.stage);
  assert.equal(replay.level.duration, Infinity); assert.equal(replay.progress, 0);
  assert.equal(replay.level.rows[replay.nextRow]._replayIndex, run.failure.row);
});

test('recording an endless run does not alter operations, score, events, distance or row pruning', () => {
  const observed = endless(260, 1, true), ordinary = endless(260, 1, false);
  assert.deepEqual(snapshot(observed.run), snapshot(ordinary.run));
  assert.equal(observed.run.distance, ordinary.run.distance);
  assert.deepEqual(observed.run.level.rows, ordinary.run.level.rows);
  assert.deepEqual(observed.run.drainEvents(), ordinary.run.drainEvents());
});

for (const [label, make, risk] of [
  ['campaign', () => levels[14], false], ['mirror', () => C.makeLevel(15, 'mirror'), false],
  ['rush', () => C.makeLevel(15, 'rush'), false], ['mirrorRush', () => C.makeLevel(15, 'mirrorRush'), false],
  ['daily', () => C.makeDaily('2026-09-22').level, false], ['trial', () => X.makeTrial(15), true]
]) test(`${label} traces reconstruct captured successful operations and scores`, () => {
  const fixture = play(make(), risk), track = fixture.recorder.track(fixture.run);
  assert.ok(track); assert.equal(track.status, 'won'); assert.equal(track.score, fixture.run.score);
  // More than one state can be emitted on the same instant; playback shows
  // the final state after all operations and scoring for that instant.
  const latest = new Map(); fixture.updates.forEach(state => latest.set(Math.round(state.time * 1e6), state));
  for (const expected of latest.values()) if (expected.time <= track.end + 1e-7) samePose(R.sample(track, expected.time), expected);
  assert.ok(track.end <= track.totalTime && track.end <= 120);
});

test('prefix and rolling buffers stay bounded for a twenty-minute endless run', () => {
  const fixture = endless(1200), stats = fixture.recorder.stats();
  fixture.run.finishEndless();
  const track = fixture.recorder.track(fixture.run), clip = fixture.recorder.clip(fixture.run);
  assert.ok(track); assert.equal(track.status, 'finished');
  assert.ok(Math.abs(track.totalTime - 1200) < 1e-6);
  assert.ok(track.end > 1 && track.end <= 120);
  assert.ok(track.frames.length <= R.LIMITS.frames);
  assert.ok(JSON.stringify(track).length <= R.LIMITS.trackChars);
  assert.ok(stats.liveFrames <= R.LIMITS.liveFrames);
  assert.ok(stats.rows <= R.LIMITS.rows);
  assert.ok(stats.prefixFrames <= R.LIMITS.frames);
  assert.ok(clip.frames.length <= R.LIMITS.liveFrames + 1);
  assert.ok(clip.level.rows.length <= R.LIMITS.rows);
  assert.equal(R.sample(track, track.end + .01), null);
  assert.equal(R.sample(track, -1), null);
  assert.equal(R.sample(track, Infinity), null);
});

test('a quiet prefix covers exactly 120 seconds without inventing frames or recording later poses', () => {
  const level = { id: 1, baseId: 1, challengeKind: 'endless', endless: true, seed: 1, duration: Infinity, rows: [], lookAhead: 2.9 };
  const fixture = attach(level); fixture.run.step(200); fixture.run.action('left'); fixture.run.finishEndless();
  const track = fixture.recorder.track(fixture.run);
  assert.equal(track.end, 120); assert.equal(track.totalTime, 200);
  assert.equal(track.frames.length, 1);
  assert.equal(R.sample(track, 120).lane, 1);
  assert.equal(R.sample(track, 120).status, 'running');
  assert.equal(R.sample(track, 121), null);
});

test('unfinished or late-attached recorders cannot invent a complete operation ghost', () => {
  const fixture = attach(basic());
  assert.equal(fixture.recorder.track(fixture.run), null);
  const late = new E.Run(basic()); late.step(1);
  const recorder = new R.Recorder(R.keyFor(late.level)); recorder.observe(late); late.step(4);
  assert.equal(recorder.track(late), null);
  assert.ok(recorder.clip(late));
  const mismatch = new R.Recorder('campaign:2');
  assert.equal(mismatch.observe(late), false); assert.equal(mismatch.clip(late), null);
});

test('route identity separates all modes, daily dates, trial routes and endless seeds', () => {
  const routes = [levels[0], C.makeLevel(1, 'normal'), C.makeLevel(1, 'mirror'), C.makeLevel(1, 'rush'), C.makeLevel(1, 'mirrorRush'),
    C.makeDaily('2026-09-22').level, C.makeDaily('2026-09-23').level, X.makeTrial(1), X.makeEndless(0), X.makeEndless(1), X.makeEndless(4294967295)];
  const keys = routes.map(R.keyFor);
  assert.equal(new Set(keys).size, routes.length);
  assert.equal(keys[0], 'campaign:1'); assert.equal(keys[1], 'level:1:normal');
  assert.equal(keys[5], 'daily:2026-09-22:4:mirror');
  assert.equal(keys[7], 'trial:1'); assert.equal(keys[8], 'endless:00000000'); assert.equal(keys[10], 'endless:FFFFFFFF');
  for (const level of [null, {}, { id: 0 }, { id: 16 }, { id: 1, challengeKind: 'unknown' }, { id: 1, challengeKind: 'level', challengeMode: 'mirror', challengeKey: '2-mirror' },
    { id: 1, challengeKind: 'daily', dailyDate: '2026-02-29', challengeMode: 'mirror' }, { id: 1, challengeKind: 'endless', endless: true, seed: -1 }]) assert.equal(R.keyFor(level), null);
  assert.throws(() => new R.Recorder('campaign:99'), RangeError);
});

test('archive replacement keeps a better score, accepts equal recent traces, and never mutates inputs', () => {
  const left = terminalTrack(1, 'left'), right = terminalTrack(1, 'right');
  const archive = R.store([], left), original = JSON.stringify(archive);
  const equal = R.store(archive, right);
  assert.equal(R.getGhost(equal, right.key).frames[0][1], 2);
  assert.equal(JSON.stringify(archive), original);
  const failure = attach(levels[0]); failure.run.step(30);
  const worse = failure.recorder.track(failure.run);
  const unchanged = R.store(equal, worse);
  assert.equal(R.getGhost(unchanged, left.key).score, 1000);
  assert.equal(R.getGhost(unchanged, left.key).frames[0][1], 2);
  assert.ok(Object.isFrozen(unchanged) && Object.isFrozen(unchanged[0].frames));
  assert.equal(R.getGhost(unchanged, 'level:1:normal'), null);
  assert.equal(R.getGhost(unchanged, 'invalid'), null);
  assert.deepEqual(R.cleanArchive(JSON.parse(JSON.stringify(unchanged))), unchanged);
});

test('archives cap entry count and serialized bytes by dropping oldest ghost traces only', () => {
  let archive = [];
  for (let id = 1; id <= 10; id++) archive = R.store(archive, terminalTrack(id));
  assert.equal(archive.length, 6);
  assert.equal(R.getGhost(archive, 'campaign:1'), null);
  assert.equal(archive[0].key, 'campaign:5');
  const long = endless(260); long.run.finishEndless(); const track = long.recorder.track(long.run);
  for (let seed = 1; seed <= 6; seed++) {
    const candidate = JSON.parse(JSON.stringify(track)); candidate.key = 'endless:0000000' + seed;
    archive = R.store(archive, candidate);
    assert.ok(archive.length <= 6); assert.ok(JSON.stringify(archive).length <= 24000);
  }
  assert.ok(archive.length < 6, 'large traces must also honor the byte budget');
  assert.equal(archive[archive.length - 1].key, 'endless:00000006');
});

test('malformed archive identities, metadata and numeric frame data are rejected', () => {
  const base = JSON.parse(JSON.stringify(terminalTrack()));
  const cases = [];
  function bad(change) { const value = JSON.parse(JSON.stringify(base)); change(value); cases.push(value); }
  bad(t => { t.key = '__proto__'; }); bad(t => { t.key = 'daily:1900-02-29:1:mirror'; });
  bad(t => { t.version = 2; }); bad(t => { t.practice = true; }); bad(t => { t.start = 1; });
  bad(t => { t.end = Infinity; }); bad(t => { t.end = 121; }); bad(t => { t.end = -1; });
  bad(t => { t.totalTime = t.end - .1; }); bad(t => { t.score = NaN; }); bad(t => { t.score = '1000'; });
  bad(t => { t.status = 'running'; }); bad(t => { t.frames = []; }); bad(t => { t.frames = new Array(257).fill(base.frames[0]); });
  bad(t => { t.frames[0][0] = 1; }); bad(t => { t.frames[0][1] = 3; }); bad(t => { t.frames[0][2] = -1; });
  bad(t => { t.frames[0][3] = 1; }); bad(t => { t.frames[0][4] = Infinity; }); bad(t => { t.frames[0][5] = -1; });
  bad(t => { delete t.frames[0][5]; }); bad(t => { t.frames[0][6] = .5; }); bad(t => { t.frames[0][7] = 99; });
  bad(t => { t.frames[0][8] = 1; }); bad(t => { t.frames[0][9] = 1; }); bad(t => { t.frames[0][10] = 8; });
  bad(t => { t.frames[0][11] = 10; }); bad(t => { t.frames[0][12] = NaN; });
  bad(t => { t.frames.reverse(); }); bad(t => { t.frames.push(t.frames[t.frames.length - 1]); });
  bad(t => { t.frames[t.frames.length - 1][10] = 1; });
  for (const malformed of [undefined, null, false, 42, '[]', {}, [null], cases]) assert.deepEqual(R.cleanArchive(malformed), []);
  for (const candidate of cases) assert.deepEqual(R.store([], candidate), []);
  assert.equal(R.sample({ start: 0, end: 1, frames: [[0]] }, .5), null);
  assert.equal(R.sample({ start: 0, end: 1, frames: [new Array(13)] }, .5), null);
});

test('legacy game save fields are unchanged and ghost storage never changes progress or scores', () => {
  const save = E.emptySave(), before = JSON.stringify(save), candidate = terminalTrack();
  const archive = R.store([], candidate);
  const sample = R.sample(R.getGhost(archive, 'campaign:1'), 1);
  assert.equal(sample.score, 0);
  assert.equal(JSON.stringify(save), before);
  assert.equal(Object.prototype.hasOwnProperty.call(save, 'replays'), false);
  assert.deepEqual(E.cleanSave(Object.assign({}, save, { replays: archive })), save);
});

test('browser UMD replay module works with legacy padding APIs absent', () => {
  const sandbox = vm.createContext({ PulseEngine: E });
  vm.runInContext('String.prototype.padStart=undefined;', sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../web/replay.js'), 'utf8'), sandbox);
  assert.equal(sandbox.PulseReplay.keyFor(X.makeEndless(42)), 'endless:0000002A');
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.PulseReplay.cleanArchive([]))), []);
});
