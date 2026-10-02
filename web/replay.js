(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.PulseReplay = factory(root.PulseEngine);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Engine) {
  'use strict';
  const US = 1000000, EPSILON = 0.000001;
  const STATUS = ['running', 'failed', 'won', 'finished'];
  const MODES = ['normal', 'mirror', 'rush', 'mirrorRush'];
  const LIMITS = Object.freeze({ seconds: 120, frames: 256, trackChars: 12000, archiveChars: 24000, tracks: 6, clipSeconds: 6, liveFrames: 192, rows: 64 });
  function micros(value) { return Math.round(value * US); }
  function seconds(value) { return micros(value) / US; }
  function integer(value, low, high) { return Number.isInteger(value) && value >= low && value <= high; }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const y = Number(value.slice(0, 4)), m = Number(value.slice(5, 7)), d = Number(value.slice(8, 10));
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function validKey(key) {
    if (typeof key !== 'string' || key.length > 64) return false;
    if (/^(campaign|trial):([1-9]|1[0-5])$/.test(key)) return true;
    if (/^level:([1-9]|1[0-5]):(normal|mirror|rush|mirrorRush)$/.test(key)) return true;
    if (/^endless:[0-9A-F]{8}$/.test(key)) return true;
    const daily = /^daily:(\d{4}-\d{2}-\d{2}):([1-9]|1[0-5]):(mirror|rush|mirrorRush)$/.exec(key);
    return !!daily && validDate(daily[1]);
  }
  function keyFor(level) {
    if (!level || typeof level !== 'object') return null;
    const id = level.baseId === undefined ? level.id : level.baseId;
    if (!integer(id, 1, 15)) return null;
    const kind = level.challengeKind;
    if (kind === 'endless') {
      if (!level.endless || !integer(level.seed, 0, 4294967295)) return null;
      let hex = level.seed.toString(16).toUpperCase(); while (hex.length < 8) hex = '0' + hex;
      return 'endless:' + hex;
    }
    if (kind === 'trial') return 'trial:' + id;
    if (kind === 'level' && MODES.indexOf(level.challengeMode) >= 0 && level.challengeKey === id + '-' + level.challengeMode) return 'level:' + id + ':' + level.challengeMode;
    if (kind === 'daily' && validDate(level.dailyDate) && MODES.indexOf(level.challengeMode) > 0) return 'daily:' + level.dailyDate + ':' + id + ':' + level.challengeMode;
    return !kind && !level.endless ? 'campaign:' + id : null;
  }
  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      const result = {}; Object.keys(value).forEach(key => { if (typeof value[key] !== 'function') result[key] = clone(value[key]); }); return result;
    }
    return value;
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.keys(value).forEach(key => freeze(value[key])); Object.freeze(value);
    }
    return value;
  }
  // Frames preserve state changes, not rendered pixels or simulated inputs.
  // t, lane, previousLane, movedAt, jumpedAt, score, gems, combo, bonus,
  // perfectJumps, status, absoluteNextRow, passed. Times are microseconds.
  function frameFor(run, time) {
    return [micros(time === undefined ? run.time : time), run.lane, run.previousLane, micros(run.movedAt), micros(run.jumpedAt),
      run.score, run.gems, run.combo, run.bonusGems, run.perfectJumps, STATUS.indexOf(run.status),
      run.nextRow + (run._rowOffset || 0), run.passed];
  }
  function sameState(a, b) { return !!a && a.slice(1).every((value, index) => value === b[index + 1]); }
  function pushFrame(frames, frame) {
    if (frames.length && frames[frames.length - 1][0] === frame[0]) frames[frames.length - 1] = frame;
    else if (!sameState(frames[frames.length - 1], frame)) frames.push(frame);
  }
  function stateAt(frames, time) {
    if (!Array.isArray(frames) || !frames.length) return null;
    let low = 0, high = frames.length - 1, found = -1;
    const at = time * US + .500001;
    while (low <= high) {
      const middle = (low + high) >> 1, frame = frames[middle];
      if (!Array.isArray(frame) || frame.length !== 13 || !Number.isFinite(frame[0])) return null;
      if (frame[0] <= at) { found = middle; low = middle + 1; } else high = middle - 1;
    }
    if (found < 0) return null;
    const frame = frames[found];
    for (let field = 0; field < 13; field++) if (!Number.isFinite(frame[field])) return null;
    if (!integer(frame[1], 0, 2) || !integer(frame[2], 0, 2) || !integer(frame[10], 0, 3)) return null;
    const elapsed = time - frame[4] / US;
    return { time: time, lane: frame[1], previousLane: frame[2], movedAt: frame[3] / US, jumpedAt: frame[4] / US,
      score: frame[5], gems: frame[6], combo: frame[7], bonusGems: frame[8], perfectJumps: frame[9],
      status: STATUS[frame[10]], nextRow: frame[11], passed: frame[12],
      jumpHeight: elapsed >= 0 && elapsed <= Engine.JUMP_DURATION ? Math.sin(Math.PI * elapsed / Engine.JUMP_DURATION) : 0 };
  }
  function sample(track, time) {
    if (!track || !Number.isFinite(time) || !Number.isFinite(track.start) || !Number.isFinite(track.end) ||
      time < track.start - EPSILON || time > track.end + EPSILON) return null;
    const state = stateAt(track.frames, Math.max(track.start, Math.min(track.end, time)));
    return state ? freeze(state) : null;
  }
  function levelInfo(level) {
    const info = {};
    ['id', 'baseId', 'name', 'subtitle', 'chapter', 'difficulty', 'duration', 'lookAhead', 'endless', 'challengeKind', 'challengeMode', 'challengeKey', 'dailyDate', 'seed'].forEach(key => {
      if (level[key] !== undefined) info[key] = level[key];
    });
    return info;
  }
  class Recorder {
    constructor(key) {
      if (!validKey(key)) throw new RangeError('无效的回放路线');
      this.key = key; this._frames = []; this._rows = []; this._prefix = [];
      this._start = null; this._time = -1; this._end = 0; this._prefixStopped = false;
      this._eligible = false; this._level = null;
    }
    observe(run) {
      if (!run || keyFor(run.level) !== this.key || !Number.isFinite(run.time) || run.time < 0 || run.time < this._time - EPSILON) return false;
      if (this._start === null) { this._start = run.time; this._eligible = !run.practice && run.time === 0; }
      this._time = run.time; this._level = levelInfo(run.level);
      const frame = frameFor(run);
      pushFrame(this._frames, frame);
      const cutoff = micros(run.time - LIMITS.clipSeconds - .25);
      while (this._frames.length > 1 && this._frames[1][0] <= cutoff) this._frames.shift();
      while (this._frames.length > LIMITS.liveFrames) this._frames.shift();
      if (this._eligible && !this._prefixStopped) {
        if (run.time > LIMITS.seconds) { this._end = LIMITS.seconds; this._prefixStopped = true; }
        else {
          const next = this._prefix.slice(); pushFrame(next, frame.slice());
          if (next.length <= LIMITS.frames && JSON.stringify(next).length <= LIMITS.trackChars - 512) {
            this._prefix = next; this._end = run.time;
          } else {
            // A same-time replacement cannot leave an obsolete pose advertised
            // as the newest state; fall back to the preceding covered instant.
            if (this._prefix.length && this._prefix[this._prefix.length - 1][0] === frame[0]) {
              this._prefix.pop(); this._end = this._prefix.length ? this._prefix[this._prefix.length - 1][0] / US : 0;
            }
            this._prefixStopped = true;
          }
        }
      }
      const minimum = run.time - LIMITS.clipSeconds - .4, maximum = run.time + Math.max(3, run.level.lookAhead) + .4;
      const base = run._rowOffset || 0;
      run.level.rows.forEach((row, index) => {
        if (row.t < minimum || row.t > maximum || (!run.level.endless && index < run.practiceStartRow)) return;
        const absolute = base + index;
        if (this._rows.some(cached => cached._replayIndex === absolute)) return;
        const cached = clone(row); cached._replayIndex = absolute; this._rows.push(cached);
      });
      this._rows = this._rows.filter(row => row.t >= minimum && row.t <= maximum).sort((a, b) => a.t - b.t);
      if (this._rows.length > LIMITS.rows) this._rows = this._rows.slice(-LIMITS.rows);
      return true;
    }
    clip(run) {
      if (!this.observe(run) || !this._frames.length) return null;
      const end = seconds(run.time), start = seconds(Math.max(this._start, end - LIMITS.clipSeconds, this._frames[0][0] / US));
      const initial = stateAt(this._frames, start); if (!initial) return null;
      const frames = [frameFor(initial, start)].concat(this._frames.filter(frame => frame[0] > micros(start)).map(frame => frame.slice()));
      const level = clone(this._level);
      level.rows = this._rows.filter(row => row.t >= start - .2 && row.t <= end + Math.max(3, level.lookAhead) + .2).map(clone);
      return freeze({ version: 1, key: this.key, start: start, end: end, frames: frames, level: level,
        failure: clone(run.failure), practice: !!run.practice, totalGems: run.totalGems, score: run.score, status: run.status });
    }
    track(run) {
      if (!this.observe(run) || !this._eligible || run.practice || STATUS.indexOf(run.status) < 1 || !this._prefix.length) return null;
      return sanitizeTrack({ version: 1, key: this.key, start: 0, end: seconds(this._end), totalTime: seconds(run.time),
        score: run.score, status: run.status, frames: this._prefix });
    }
    stats() { return { liveFrames: this._frames.length, rows: this._rows.length, prefixFrames: this._prefix.length, prefixChars: JSON.stringify(this._prefix).length }; }
  }
  function distanceAt(time, endless) {
    if (!endless) return Math.floor(time * 12);
    const complete = Math.min(7, Math.floor(time / 25));
    return Math.floor(25 * (12 * complete + complete * (complete - 1)) + (time - complete * 25) * (12 + complete * 2));
  }
  function view(clip, time) {
    const state = sample(clip, time); if (!state || !clip.level || !Array.isArray(clip.level.rows)) return null;
    const stage = Math.floor(state.time / 25) + 1, tier = Math.min(8, stage);
    const level = Object.assign({}, clip.level);
    if (level.endless) { level.lookAhead = Math.max(1.9, 2.9 - (tier - 1) * .14); level.difficulty = tier; }
    let nextRow = level.rows.findIndex(row => row._replayIndex >= state.nextRow);
    if (nextRow < 0) nextRow = level.rows.length;
    return freeze(Object.assign({}, state, { level: level, nextRow: nextRow, practice: clip.practice, practiceStartRow: 0,
      failure: state.status === 'failed' ? clip.failure : null, totalGems: clip.totalGems, bufferedJump: false,
      distance: distanceAt(state.time, !!level.endless), stage: stage, tier: tier, progress: level.endless ? 0 : Math.min(1, state.time / level.duration),
      jumpHeight: function (at) {
        const elapsed = (at === undefined ? state.time : at) - state.jumpedAt;
        return elapsed >= 0 && elapsed <= Engine.JUMP_DURATION ? Math.sin(Math.PI * elapsed / Engine.JUMP_DURATION) : 0;
      } }));
  }
  function sanitizeTrack(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== 1 || raw.practice || !validKey(raw.key) || raw.start !== 0 ||
      !Number.isFinite(raw.end) || raw.end < 0 || raw.end > LIMITS.seconds ||
      !Number.isFinite(raw.totalTime) || raw.totalTime < raw.end || raw.totalTime > 1000000000 ||
      !integer(raw.score, 0, 1000000000) || STATUS.indexOf(raw.status) < 1 ||
      !Array.isArray(raw.frames) || !raw.frames.length || raw.frames.length > LIMITS.frames) return null;
    const frames = [], end = micros(raw.end);
    let previous = null;
    for (const source of raw.frames) {
      if (!Array.isArray(source) || source.length !== 13) return null;
      for (let field = 0; field < 13; field++) if (!Number.isInteger(source[field])) return null;
      const f = source.slice();
      if (!integer(f[0], 0, end) || !integer(f[1], 0, 2) || !integer(f[2], 0, 2) ||
        !integer(f[3], -10000000, f[0]) || !integer(f[4], -10000000, f[0]) ||
        !f.slice(5, 10).every(value => integer(value, 0, 1000000000)) ||
        !integer(f[10], 0, 3) || !integer(f[11], 0, 1000000000) || !integer(f[12], 0, 1000000000) ||
        f[7] > f[6] || f[8] > f[6] || f[9] > f[12] || f[11] !== f[12] || f[5] > raw.score) return null;
      if (previous && (f[0] <= previous[0] || previous[10] !== 0 || [5, 6, 8, 9, 11, 12].some(index => f[index] < previous[index]))) return null;
      frames.push(f); previous = f;
    }
    if (frames[0][0] !== 0) return null;
    const last = frames[frames.length - 1], terminal = STATUS[last[10]];
    if (last[10] !== 0 && (Math.abs(last[0] / US - raw.totalTime) > EPSILON || Math.abs(raw.end - raw.totalTime) > EPSILON || terminal !== raw.status)) return null;
    if (Math.abs(raw.end - raw.totalTime) <= EPSILON && terminal !== raw.status) return null;
    const result = { version: 1, key: raw.key, start: 0, end: seconds(raw.end), totalTime: seconds(raw.totalTime), score: raw.score, status: raw.status, frames: frames };
    return JSON.stringify(result).length <= LIMITS.trackChars ? freeze(result) : null;
  }
  function capArchive(entries) {
    while (entries.length > LIMITS.tracks || JSON.stringify(entries).length > LIMITS.archiveChars) entries.shift();
    return freeze(entries);
  }
  function cleanArchive(raw) {
    const entries = [];
    if (!Array.isArray(raw)) return freeze(entries);
    // Corrupt arrays cannot cause unbounded parsing or allocation here.
    raw.slice(-64).forEach(candidate => {
      const track = sanitizeTrack(candidate); if (!track) return;
      const index = entries.findIndex(entry => entry.key === track.key);
      if (index >= 0) {
        if (entries[index].score > track.score) return;
        entries.splice(index, 1);
      }
      entries.push(track);
    });
    return capArchive(entries);
  }
  function getGhost(archive, key) {
    if (!validKey(key)) return null;
    return cleanArchive(archive).find(entry => entry.key === key) || null;
  }
  function store(archive, candidate) {
    const existing = cleanArchive(archive), track = sanitizeTrack(candidate);
    if (!track) return existing;
    const current = existing.find(entry => entry.key === track.key);
    if (current && current.score > track.score) return existing;
    const entries = existing.filter(entry => entry.key !== track.key); entries.push(track);
    return capArchive(entries);
  }
  return { Recorder: Recorder, keyFor: keyFor, sample: sample, view: view, cleanArchive: cleanArchive,
    getGhost: getGhost, store: store, LIMITS: LIMITS };
});
