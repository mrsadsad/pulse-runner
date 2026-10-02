'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../web/backup.js');
const P = require('../web/profile.js');
const E = require('../web/engine.js');
const C = require('../web/challenges.js');
const R = require('../web/replay.js');
const Rewards = require('../web/rewards.js');
const levels = require('../web/levels.js');
const DATE = '2026-09-22T08:12:34.567Z';
const clone = value => JSON.parse(JSON.stringify(value));
const record = (changes = {}) => Object.assign({ stars: 0, gems: 0, progress: 0, attempts: 0, wins: 0, bestScore: 0, bestCombo: 0, bestBonus: 0 }, changes);
function save() { return P.cleanSave(E.emptySave()); }
function daily(date, changes = {}) {
  const route = C.makeDaily(date);
  return Object.assign(record(changes), { baseId: route.baseId, mode: route.mode });
}
function day(offset) { return new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10); }
function trace(id, gem = false) {
  const level = { id, chapter: 1, name: '备份测试', duration: 2, lookAhead: 2.8,
    rows: gem ? [{ t: 1, type: [null, null, null], gem: 1 }] : [] };
  const recorder = new R.Recorder(R.keyFor(level));
  const run = new E.Run(level, { onUpdate: state => recorder.observe(state) });
  run.step(2);
  return recorder.track(run);
}
function richSave() {
  const raw = save();
  raw.records[1] = record({ stars: 3, gems: 15, progress: 1, attempts: 5, bestScore: 7500, bestCombo: 15 });
  raw.records[2] = record({ stars: 2, gems: 16, progress: 1, attempts: 8, bestScore: 7800, bestCombo: 20 });
  raw.challengeRecords['5-mirror'] = Object.assign(record({ wins: 1, attempts: 2, stars: 3, bestScore: 8200 }), { baseId: 5, mode: 'mirror' });
  raw.dailyRecords['2026-09-22'] = daily('2026-09-22', { wins: 1, stars: 3, attempts: 1, bestScore: 6000 });
  raw.trialRecords[4] = record({ wins: 2, stars: 3, attempts: 4, bestScore: 10200, bestBonus: 5 });
  raw.endlessRecord = { attempts: 6, bestScore: 12400, bestDistance: 2500, bestTime: 175.32, bestCombo: 55, bestBonus: 8, bestStage: 8 };
  raw.goalProgress = { firstwin: 1, combo50: 50, daily3: 3 };
  raw.attempts = 13;
  raw.sound = false; raw.music = false; raw.effects = false; raw.vibration = false; raw.ghostEnabled = false;
  raw.equipped = { skin: 'spark', trail: 'comet' };
  raw.replays = [trace(1, true), trace(2)];
  return P.cleanSave(raw);
}
function withChecksum(envelope) {
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  const source = canonical({ app: envelope.app, formatVersion: envelope.formatVersion, createdAt: envelope.createdAt, payload: envelope.payload });
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash = Math.imul(hash ^ (source.charCodeAt(i) & 255), 16777619) >>> 0;
    hash = Math.imul(hash ^ (source.charCodeAt(i) >>> 8), 16777619) >>> 0;
  }
  envelope.checksum = 'fnv1a32:' + hash.toString(16).toUpperCase().padStart(8, '0');
  return JSON.stringify(envelope);
}

test('versioned backup round-trips all record buckets, rewards, settings and real operation traces', () => {
  const source = richSave(), before = JSON.stringify(source);
  const text = B.exportSave(source, DATE), envelope = JSON.parse(text), result = B.inspect(text);
  assert.equal(envelope.app, 'pulse-runner'); assert.equal(envelope.formatVersion, 1);
  assert.equal(envelope.createdAt, DATE); assert.match(envelope.checksum, /^fnv1a32:[0-9A-F]{8}$/);
  assert.equal(result.legacy, false); assert.equal(result.createdAt, DATE); assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.save.records, source.records); assert.deepEqual(result.save.challengeRecords, source.challengeRecords);
  assert.deepEqual(result.save.dailyRecords, source.dailyRecords); assert.deepEqual(result.save.trialRecords, source.trialRecords);
  assert.deepEqual(result.save.endlessRecord, source.endlessRecord); assert.deepEqual(result.save.replays, source.replays);
  assert.deepEqual(result.save.equipped, source.equipped);
  for (const field of ['sound', 'music', 'effects', 'vibration', 'ghostEnabled', 'attempts']) assert.equal(result.save[field], source[field]);
  assert.equal(result.save.goalProgress.combo50, 50); assert.equal(result.save.goalProgress.daily3, 3);
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(result.summary, { completed: 2, stars: 5, unlocked: 3, goalCount: 4, replayCount: 2 });
  assert.deepEqual(B.inspect(B.exportSave(result.save, DATE)), result);
});

test('exports are deterministic for an explicit time and default to a valid current ISO timestamp', () => {
  const source = richSave();
  assert.equal(B.exportSave(source, DATE), B.exportSave(source, DATE));
  assert.ok(Number.isFinite(Date.parse(B.inspect(B.exportSave(source)).createdAt)));
  for (const time of ['', null, 123, '2026-09-22', '2026-02-30T00:00:00.000Z', '2026-09-22T08:12:34Z']) {
    assert.throws(() => B.exportSave(source, time), /时间/);
  }
});

test('checksum ignores whitespace and object key order but protects payload and date changes', () => {
  const envelope = JSON.parse(B.exportSave(richSave(), DATE));
  const reversed = Object.fromEntries(Object.entries(envelope).reverse());
  reversed.payload = Object.fromEntries(Object.entries(envelope.payload).reverse());
  assert.equal(B.inspect(' \n' + JSON.stringify(reversed, null, 4) + '\t').save.records[1].bestScore, 7500);
  for (const edit of [raw => { raw.payload.records[1].bestScore++; }, raw => { raw.createdAt = '2026-09-23T08:12:34.567Z'; }, raw => { raw.payload.sound = true; }]) {
    const raw = clone(envelope); edit(raw); assert.throws(() => B.inspect(JSON.stringify(raw)), /校验失败/);
  }
});

test('format 1 keeps accepting a pinned checksum fixture independently of later profile defaults', () => {
  const fixture = { app: 'pulse-runner', formatVersion: 1, createdAt: DATE,
    payload: { version: 1, unlocked: 1, records: {}, attempts: 0, sound: true, vibration: true },
    checksum: 'fnv1a32:39729FF6' };
  const result = B.inspect(JSON.stringify(fixture));
  assert.equal(result.legacy, false); assert.equal(result.summary.completed, 0);
  assert.equal(result.save.sound, true);
});

test('complete original raw v1 saves import with an explicit missing-checksum warning', () => {
  const old = { version: 1, unlocked: 2, records: { 1: { stars: 3, gems: 15, progress: 1, attempts: 8 } }, sound: false, vibration: true, attempts: 8 };
  const result = B.inspect(JSON.stringify(old));
  assert.equal(result.legacy, true); assert.equal(result.createdAt, null);
  assert.match(result.warnings[0], /未带校验和/);
  assert.equal(result.save.records[1].stars, 3); assert.equal(result.save.unlocked, 2);
  assert.equal(result.save.sound, false); assert.equal(result.save.music, true);
  assert.deepEqual(result.save.equipped, { skin: 'pulse', trail: 'classic' });
});

test('unrelated JSON, fragments and falsely labelled raw saves cannot become empty progress', () => {
  const invalid = [null, [], 12, 'save', {}, { records: {} }, { version: 1 }, { version: 1, unlocked: 1, records: {}, attempts: 0 }];
  for (const raw of invalid) assert.throws(() => B.inspect(JSON.stringify(raw)), /存档|备份/);
  const valid = E.emptySave();
  for (const key of ['version', 'unlocked', 'records', 'attempts', 'sound', 'vibration']) {
    const raw = clone(valid); delete raw[key]; assert.throws(() => B.inspect(JSON.stringify(raw)), /识别字段/);
  }
  for (const [key, value] of [['version', 2], ['unlocked', 16], ['unlocked', 1.5], ['records', []], ['attempts', -1], ['sound', 1], ['vibration', 'false']]) {
    const raw = clone(valid); raw[key] = value; assert.throws(() => B.inspect(JSON.stringify(raw)));
  }
});

test('foreign app, future formats, malformed timestamps and broken envelopes are rejected', () => {
  const base = JSON.parse(B.exportSave(save(), DATE));
  for (const [key, value, message] of [
    ['app', 'another-game', /不属于/], ['formatVersion', 2, /格式版本/], ['formatVersion', '1', /格式版本/],
    ['createdAt', '2026-02-30T00:00:00.000Z', /时间/], ['checksum', null, /校验和/], ['checksum', 'fnv1a32:xyz', /校验和/]
  ]) { const raw = clone(base); raw[key] = value; assert.throws(() => B.inspect(JSON.stringify(raw)), message); }
  const future = clone(base); future.payload.version = 2;
  assert.throws(() => B.inspect(withChecksum(future)), /存档版本/);
  const extra = clone(base); extra.formatVersion2 = 2;
  assert.throws(() => B.inspect(JSON.stringify(extra)), /未知字段/);
  for (const key of ['app', 'formatVersion', 'createdAt', 'payload', 'checksum']) {
    const raw = clone(base); delete raw[key]; assert.throws(() => B.inspect(JSON.stringify(raw)));
  }
});

test('text, payload, numeric overflow and nesting limits reject malformed input before sanitation', () => {
  for (const text of ['', '   ', '{"version":', undefined, 5]) assert.throws(() => B.inspect(text));
  assert.throws(() => B.inspect(' '.repeat(B.LIMITS.textChars + 1)), /200000/);
  const raw = E.emptySave(); raw.extra = 'a'.repeat(B.LIMITS.saveChars);
  assert.throws(() => B.inspect(JSON.stringify(raw)), /65536/);
  assert.throws(() => B.inspect('{"n":1e999}'), /无效数值/);
  assert.throws(() => B.inspect('{"x":' + '['.repeat(50) + '0' + ']'.repeat(50) + '}'), /嵌套/);
});

test('profile sanitation applies to damaged optional fields and reports cleanup', () => {
  const raw = richSave();
  raw.records[1].stars = 99; raw.records[1].bestScore = -3;
  raw.ghostEnabled = 'false'; raw.replays = raw.replays.concat({ key: 'campaign:99', score: 999999 });
  raw.equipped = { skin: 'crown', trail: 'no-such-item' }; raw.goalProgress.unknown = 999;
  raw.challengeRecords.bad = record({ wins: 1 });
  const result = B.inspect(JSON.stringify(raw));
  assert.equal(result.save.records[1].stars, 3); assert.equal(result.save.records[1].bestScore, 0);
  assert.equal(result.save.ghostEnabled, true); assert.equal(result.save.replays.length, 2);
  assert.deepEqual(result.save.equipped, { skin: 'pulse', trail: 'classic' });
  assert.equal(result.save.goalProgress.unknown, undefined); assert.equal(result.save.challengeRecords.bad, undefined);
  assert.ok(result.warnings.some(value => /无效/.test(value)));
});

test('checksum-valid optional fields still pass through current Profile sanitation', () => {
  const envelope = JSON.parse(B.exportSave(save(), DATE));
  envelope.payload.replays = [{ key: 'campaign:1', frames: 'bad' }];
  envelope.payload.music = 'false'; envelope.payload.records[1] = record({ stars: 8, progress: 9 });
  const result = B.inspect(withChecksum(envelope));
  assert.equal(result.save.records[1].stars, 3); assert.equal(result.save.records[1].progress, 1);
  assert.deepEqual(result.save.replays, []); assert.equal(result.save.music, true);
});

test('prototype-looking JSON properties do not mutate built-ins or survive sanitized saves', () => {
  const raw = E.emptySave();
  const text = JSON.stringify(raw).replace('"records":{}', '"records":{"__proto__":{"polluted":true},"constructor":{"stars":3}}');
  const result = B.inspect(text);
  assert.equal({}.polluted, undefined); assert.deepEqual(result.save.records, {});
});

test('merge takes fieldwise best scores and counts without double-counting repeated imports', () => {
  const local = save(), imported = save();
  local.records[1] = record({ stars: 1, gems: 10, progress: 1, attempts: 7, bestScore: 5000, bestCombo: 20 });
  imported.records[1] = record({ stars: 3, gems: 15, progress: 1, attempts: 4, bestScore: 7000, bestCombo: 12 });
  imported.records[2] = record({ stars: 2, progress: 1, attempts: 8 });
  local.attempts = 7; imported.attempts = 12;
  const before = [JSON.stringify(local), JSON.stringify(imported)], merged = B.merge(local, imported);
  assert.deepEqual(merged.records[1], { stars: 3, gems: 15, progress: 1, attempts: 7, bestScore: 7000, bestCombo: 20 });
  assert.equal(merged.records[2].attempts, 8); assert.equal(merged.attempts, 12); assert.equal(merged.unlocked, 3);
  assert.deepEqual(B.merge(merged, imported), merged);
  assert.deepEqual([JSON.stringify(local), JSON.stringify(imported)], before);
  merged.records[1].stars = 0; assert.equal(local.records[1].stars, 1); assert.equal(imported.records[1].stars, 3);
});

test('campaign, challenge, daily, trial and endless stats merge in isolated buckets', () => {
  const local = save(), imported = save(), date = '2026-09-22';
  local.challengeRecords['4-rush'] = Object.assign(record({ attempts: 5, wins: 2, bestScore: 3000 }), { baseId: 4, mode: 'rush' });
  imported.challengeRecords['4-rush'] = Object.assign(record({ attempts: 3, wins: 3, bestScore: 2000, bestCombo: 21 }), { baseId: 4, mode: 'rush' });
  local.dailyRecords[date] = daily(date, { attempts: 3, wins: 1, bestScore: 800 });
  imported.dailyRecords[date] = daily(date, { attempts: 6, wins: 2, bestScore: 400 });
  local.trialRecords[4] = record({ attempts: 5, wins: 2, stars: 3, bestBonus: 4 });
  imported.trialRecords[4] = record({ attempts: 7, wins: 1, stars: 2, bestBonus: 6, bestScore: 9999 });
  local.endlessRecord = { attempts: 3, bestTime: 125.23, bestDistance: 1700, bestScore: 3000, bestCombo: 22, bestBonus: 3, bestStage: 6 };
  imported.endlessRecord = { attempts: 2, bestTime: 90.456, bestDistance: 2100, bestScore: 2000, bestCombo: 25, bestBonus: 4, bestStage: 5 };
  const merged = B.merge(local, imported);
  assert.deepEqual(merged.records, {}); assert.equal(merged.unlocked, 1); assert.equal(merged.attempts, 0);
  assert.equal(merged.challengeRecords['4-rush'].wins, 3); assert.equal(merged.challengeRecords['4-rush'].attempts, 5);
  assert.equal(merged.challengeRecords['4-rush'].bestScore, 3000); assert.equal(merged.challengeRecords['4-rush'].bestCombo, 21);
  assert.equal(merged.dailyRecords[date].attempts, 6); assert.equal(merged.dailyRecords[date].wins, 2); assert.equal(merged.dailyRecords[date].bestScore, 800);
  assert.equal(merged.trialRecords[4].bestBonus, 6); assert.equal(merged.trialRecords[4].wins, 2); assert.equal(merged.trialRecords[4].stars, 3);
  assert.deepEqual(merged.endlessRecord, { attempts: 3, bestTime: 125.23, bestDistance: 2100, bestScore: 3000, bestCombo: 25, bestBonus: 4, bestStage: 6 });
});

test('merge retains local preferences and equipment while imported achievements unlock optional rewards', () => {
  const local = save(), imported = richSave();
  local.sound = true; local.music = true; local.effects = true; local.vibration = true; local.ghostEnabled = true;
  const merged = B.merge(local, imported);
  for (const field of ['sound', 'music', 'effects', 'vibration', 'ghostEnabled']) assert.equal(merged[field], true);
  assert.deepEqual(merged.equipped, { skin: 'pulse', trail: 'classic' });
  assert.equal(Rewards.getItems(merged).find(item => item.id === 'comet').unlocked, true);
  assert.equal(Rewards.getItems(merged).find(item => item.id === 'spark').unlocked, true);
  // Replacement is the inspected profile, retaining its own preferences/equipment.
  const replacement = B.inspect(B.exportSave(imported, DATE)).save;
  assert.equal(replacement.sound, false); assert.deepEqual(replacement.equipped, imported.equipped);
});

test('all actual mobile control preferences round-trip, replacement adopts them, and merging keeps local controls', () => {
  const local = save(), imported = save();
  local.controls = { layout: 'left', size: 'large', lift: 32, sensitivity: 'steady', gestures: false, tapJump: false };
  imported.controls = { layout: 'right', size: 'normal', lift: 16, sensitivity: 'sensitive', gestures: true, tapJump: true };
  const localBefore = clone(local.controls), importedBefore = clone(imported.controls);
  assert.deepEqual(B.inspect(B.exportSave(local, DATE)).save.controls, local.controls);
  assert.deepEqual(B.inspect(B.exportSave(imported, DATE)).save.controls, imported.controls);
  assert.deepEqual(B.merge(local, imported).controls, local.controls);
  assert.deepEqual(local.controls, localBefore); assert.deepEqual(imported.controls, importedBefore);
  const invalid = clone(local); invalid.controls = { layout: 'diagonal', size: 'tiny', lift: -20, sensitivity: 'turbo', gestures: 'false', tapJump: 1 };
  assert.deepEqual(B.inspect(JSON.stringify(invalid)).save.controls, require('../web/controls.js').DEFAULTS);
});

test('merged daily achievements snapshot before the newest-60 history limit', () => {
  const local = save(), imported = save();
  for (let i = 0; i < 60; i++) local.dailyRecords[day(i)] = daily(day(i), { wins: i < 2 ? 1 : 0 });
  for (let i = 60; i < 120; i++) imported.dailyRecords[day(i)] = daily(day(i), { wins: i === 60 ? 1 : 0 });
  const merged = B.merge(local, imported);
  assert.equal(Object.keys(merged.dailyRecords).length, 60); assert.equal(merged.dailyRecords[day(0)], undefined);
  assert.equal(merged.goalProgress.daily3, 3);
  assert.equal(C.getGoals(merged).find(goal => goal.id === 'daily3').unlocked, true);
  assert.equal(B.inspect(B.exportSave(merged, DATE)).save.goalProgress.daily3, 3);
});

test('import snapshots valid old daily wins before pruning oversized history and rejects invalid wins', () => {
  const raw = save();
  for (let i = 0; i < 64; i++) raw.dailyRecords[day(i)] = daily(day(i), { wins: i < 3 ? 1 : 0 });
  const result = B.inspect(JSON.stringify(raw));
  assert.equal(Object.keys(result.save.dailyRecords).length, 60); assert.equal(result.save.goalProgress.daily3, 3);
  const bad = save(); bad.dailyRecords[day(0)] = { wins: 1, baseId: 99, mode: 'rush' };
  bad.dailyRecords['2026-02-30'] = daily(day(1), { wins: 1 });
  const sanitized = B.inspect(JSON.stringify(bad)).save;
  assert.equal(sanitized.goalProgress.daily3, undefined); assert.equal(sanitized.goalProgress.firstwin, undefined);
});

test('daily mirror and rush achievements combine distinct routes before their history is dropped', () => {
  const local = save(), imported = save(), seen = new Set();
  for (let i = 0; i < 60; i++) {
    const route = C.makeDaily(day(i));
    const win = route.mode !== 'rush' && seen.size < 5 && !seen.has(route.baseId);
    if (win) seen.add(route.baseId);
    local.dailyRecords[day(i)] = daily(day(i), { wins: win ? 1 : 0 });
  }
  assert.equal(seen.size, 5);
  for (let i = 60; i < 120; i++) imported.dailyRecords[day(i)] = daily(day(i));
  const merged = B.merge(local, imported);
  assert.equal(merged.goalProgress.mirror5, 5);
  assert.equal(Rewards.getItems(merged).find(item => item.id === 'kite').unlocked, true);
});

test('replay merging retains the best recorded run per route without treating old score records as traces', () => {
  const local = save(), imported = save();
  local.replays = [trace(1, true), trace(2)]; imported.replays = [trace(1), trace(3)];
  local.records[1] = record({ bestScore: 99999 });
  const merged = B.merge(local, imported);
  assert.equal(R.getGhost(merged.replays, 'campaign:1').score, 1125);
  assert.equal(R.getGhost(merged.replays, 'campaign:2').score, 1000);
  assert.equal(R.getGhost(merged.replays, 'campaign:3').score, 1000);
  assert.equal(merged.records[1].bestScore, 99999);
  assert.deepEqual(B.merge(merged, imported), merged);
});

test('replay entry limits retain independent newest routes and never affect actual score records', () => {
  const local = save(), imported = save();
  local.replays = []; imported.replays = [];
  for (let id = 1; id <= 6; id++) { local.replays.push(trace(id)); local.records[id] = record({ bestScore: id * 100 }); }
  for (let id = 7; id <= 12; id++) { imported.replays.push(trace(id)); imported.records[id] = record({ bestScore: id * 100 }); }
  const merged = B.merge(local, imported);
  assert.equal(merged.replays.length, 6); assert.equal(Object.keys(merged.records).length, 12);
  assert.deepEqual(merged.replays.map(item => item.key), ['campaign:7', 'campaign:8', 'campaign:9', 'campaign:10', 'campaign:11', 'campaign:12']);
});

test('maximal saves with real archived traces stay below backup and native character budgets', () => {
  const raw = save(), max = record({ stars: 3, gems: 999999999, progress: 1, attempts: 999999999, wins: 999999999, bestScore: 999999999, bestCombo: 999999999, bestBonus: 999999999 });
  for (let id = 1; id <= 15; id++) {
    raw.records[id] = { ...max }; raw.trialRecords[id] = { ...max };
    for (const mode of C.MODES) raw.challengeRecords[id + '-' + mode.id] = Object.assign({}, max, { baseId: id, mode: mode.id });
  }
  for (let i = 0; i < 60; i++) raw.dailyRecords[day(i)] = daily(day(i), max);
  raw.endlessRecord = { attempts: 999999999, bestScore: 999999999, bestDistance: 999999999, bestTime: 999999999.123, bestCombo: 999999999, bestBonus: 999999999, bestStage: 999999999 };
  for (let id = 10; id <= 15; id++) {
    const level = levels[id - 1], recorder = new R.Recorder(R.keyFor(level));
    const run = new E.Run(level, { onUpdate: state => recorder.observe(state) });
    for (const action of level.solution) { run.step(action.t - run.time); run.action(action.action); }
    run.step(level.duration - run.time); assert.equal(run.status, 'won');
    raw.replays = R.store(raw.replays, recorder.track(run));
  }
  raw.equipped = { skin: 'crown', trail: 'comet' };
  const text = B.exportSave(raw, DATE), result = B.inspect(text);
  assert.ok(text.length <= B.LIMITS.textChars);
  assert.ok(JSON.stringify(result.save).length <= B.LIMITS.saveChars);
  assert.ok(JSON.stringify(result.save.replays).length > 15000);
  assert.ok(JSON.stringify(result.save.replays).length <= 24000);
  assert.equal(result.save.equipped.skin, 'crown'); assert.equal(result.summary.completed, 15);
  assert.equal(result.summary.stars, 45); assert.equal(result.summary.goalCount, 10);
  assert.deepEqual(B.inspect(B.exportSave(result.save, DATE)).save, result.save);
});

test('summary exposes only campaign totals and earned goals, with sensible empty defaults', () => {
  assert.deepEqual(B.summarize(null), { completed: 0, stars: 0, unlocked: 1, goalCount: 0, replayCount: 0 });
  const raw = save(); raw.trialRecords[15] = record({ wins: 1, stars: 3 }); raw.endlessRecord.bestCombo = 50;
  assert.deepEqual(B.summarize(raw), { completed: 0, stars: 0, unlocked: 1, goalCount: 3, replayCount: 0 });
});

test('UMD works with global modules without padStart and preserves sanitized future profile preferences', () => {
  const context = { PulseProfile: { cleanSave(raw) {
    const result = P.cleanSave(raw);
    result.controls = { side: raw && raw.controls && raw.controls.side === 'left' ? 'left' : 'right', size: raw && raw.controls && raw.controls.size === 'large' ? 'large' : 'normal' };
    return result;
  } }, PulseChallenges: C, PulseReplay: R };
  vm.createContext(context);
  vm.runInContext('String.prototype.padStart = undefined;', context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/backup.js'), 'utf8'), context);
  const api = context.PulseBackup;
  const local = save(), imported = richSave();
  local.controls = { side: 'left', size: 'large' }; imported.controls = { side: 'right', size: 'normal' };
  const exported = api.inspect(api.exportSave(local, DATE));
  assert.deepEqual(JSON.parse(JSON.stringify(exported.save.controls)), local.controls);
  assert.deepEqual(JSON.parse(JSON.stringify(api.merge(local, imported).controls)), local.controls);
});
