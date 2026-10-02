(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PulseEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const JUMP_DURATION = 0.82;
  const MOVE_COOLDOWN = 0.10;
  const INPUT_BUFFER = 0.12;
  const TIME_EPSILON = 1e-8;
  function rowState(row, time) {
    const type = row.type.slice();
    let movingLane = null, gateClosed = null, gateLocked = false;
    if (row.motion) {
      const motion = row.motion, span = motion.moveEnd - motion.moveStart;
      const fraction = span > 0 ? Math.max(0, Math.min(1, (time - motion.moveStart) / span)) : time >= motion.moveEnd ? 1 : 0;
      movingLane = motion.from + (motion.to - motion.from) * fraction;
      type[Math.max(0, Math.min(2, Math.round(movingLane)))] = 'wall';
    }
    if (row.gate) {
      const gate = row.gate;
      gateLocked = time >= gate.lockAt;
      const cycle = ((time + gate.phase) % gate.period + gate.period) % gate.period;
      gateClosed = gateLocked ? !!gate.closed : cycle < gate.period / 2;
      if (gateClosed) type[gate.lane] = 'wall';
    }
    return { type: type, movingLane: movingLane, gateClosed: gateClosed, gateLocked: gateLocked };
  }
  class Run {
    constructor(level, options) {
      options = options || {};
      this.level = level;
      this.practice = options.practice === true;
      this.practiceStartRow = this.practice && !level.endless && Number.isFinite(options.startRow)
        ? Math.max(0, Math.min(Math.max(0, level.rows.length - 1), Math.floor(options.startRow))) : 0;
      this.time = this.practiceStartRow > 0 ? Math.max(0, level.rows[this.practiceStartRow].t - 2.4) : 0;
      this.lane = 1;
      this.previousLane = 1;
      this.movedAt = -10;
      this.jumpedAt = -10;
      this.nextRow = this.practiceStartRow;
      this.gems = 0;
      this.bonusGems = 0;
      this.passed = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.score = 0;
      this.perfectJumps = 0;
      this.status = 'running';
      this.failure = null;
      this.events = [];
      this.totalGems = level.endless ? Infinity : level.rows.slice(this.nextRow).filter(r => r.gem >= 0 || Number.isInteger(r.bonusGem) && r.bonusGem >= 0 && r.bonusGem <= 2).length;
      this._moveBuffer = null;
      this._jumpBuffer = null;
      this._rowOffset = 0;
      this._onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
      this._notifying = false;
      this._maintainEndless();
      this._notify();
    }
    _notify() {
      if (!this._onUpdate || this._notifying) return;
      this._notifying = true;
      try { this._onUpdate(this); } catch (_) { /* An optional observer must never interrupt the game. */ }
      finally { this._notifying = false; }
    }
    jumpHeight(time) {
      const elapsed = (time === undefined ? this.time : time) - this.jumpedAt;
      return elapsed >= 0 && elapsed <= JUMP_DURATION ? Math.sin(Math.PI * elapsed / JUMP_DURATION) : 0;
    }
    action(action) {
      if (this.status !== 'running') return false;
      if (action === 'jump') {
        if (this.time - this.jumpedAt < JUMP_DURATION) return false;
        this.jumpedAt = this.time;
        this._jumpBuffer = null;
      } else if (action === 'left' || action === 'right') {
        if (this.time - this.movedAt < MOVE_COOLDOWN - 1e-7) return false;
        const lane = Math.max(0, Math.min(2, this.lane + (action === 'left' ? -1 : 1)));
        if (lane === this.lane) return false;
        this.previousLane = this.lane;
        this.lane = lane;
        this.movedAt = this.time;
        this._moveBuffer = null;
      } else return false;
      this._notify();
      return true;
    }
    input(action) {
      if (this.status !== 'running') return false;
      if (action !== 'jump' && action !== 'left' && action !== 'right') return false;
      // Reject an impossible edge move without replacing a pending valid move.
      if ((action === 'left' && this.lane === 0) || (action === 'right' && this.lane === 2)) return false;
      if (this.action(action)) return 'performed';
      const isJump = action === 'jump';
      const readyAt = isJump ? this.jumpedAt + JUMP_DURATION : this.movedAt + MOVE_COOLDOWN;
      const remaining = readyAt - this.time;
      if (remaining < -TIME_EPSILON || remaining > INPUT_BUFFER + TIME_EPSILON) return false;
      this[isJump ? '_jumpBuffer' : '_moveBuffer'] = { action: action, readyAt: readyAt };
      return 'queued';
    }
    _performBuffered(slot) {
      const buffered = this[slot];
      this[slot] = null;
      if (buffered.action === 'jump') {
        this.jumpedAt = this.time;
      } else {
        const lane = Math.max(0, Math.min(2, this.lane + (buffered.action === 'left' ? -1 : 1)));
        if (lane === this.lane) return;
        this.previousLane = this.lane;
        this.lane = lane;
        this.movedAt = this.time;
      }
      this.events.push({ type: 'input', action: buffered.action, buffered: true });
      this._notify();
    }
    _maintainEndless() {
      if (!this.level.endless) return;
      this.level.lookAhead = Math.max(1.9, 2.9 - (this.tier - 1) * .14);
      this.level.difficulty = this.tier;
      const remove = Math.max(0, this.nextRow - 4);
      if (remove) {
        if (this.level.pruneRows) this.level.pruneRows(remove);
        else this.level.rows.splice(0, remove);
        this.nextRow -= remove;
        this._rowOffset += remove;
      }
      if (this.level.ensureRows) this.level.ensureRows(this.time + this.level.lookAhead + 4);
    }
    finishEndless() {
      if (!this.level.endless || this.status !== 'running') return false;
      this.status = 'finished'; this._moveBuffer = null; this._jumpBuffer = null;
      this.events.push({ type: 'finish' });
      this._notify();
      return true;
    }
    step(dt) {
      if (this.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
      const until = Math.min(this.level.duration, this.time + dt);
      // Advance to the next encounter OR input-ready time, not just frame end.
      // A buffered move ready exactly on an encounter is applied before it.
      while (true) {
        this._maintainEndless();
        const nextRowTime = this.nextRow < this.level.rows.length ? this.level.rows[this.nextRow].t : Infinity;
        const moveTime = this._moveBuffer ? this._moveBuffer.readyAt : Infinity;
        const jumpTime = this._jumpBuffer ? this._jumpBuffer.readyAt : Infinity;
        const nextTime = Math.min(nextRowTime, moveTime, jumpTime);
        if (!Number.isFinite(nextTime) || nextTime > until + TIME_EPSILON) break;
        this.time = nextTime;
        if (this._moveBuffer && this._moveBuffer.readyAt <= this.time + TIME_EPSILON) this._performBuffered('_moveBuffer');
        if (this._jumpBuffer && this._jumpBuffer.readyAt <= this.time + TIME_EPSILON) this._performBuffered('_jumpBuffer');
        if (nextRowTime > this.time + TIME_EPSILON) continue;
        const row = this.level.rows[this.nextRow];
        this.time = row.t;
        const state = rowState(row, row.t), type = state.type[this.lane];
        const h = this.jumpHeight();
        if (type === 'wall' || (type === 'hurdle' && h <= 0.26) || (type === 'gap' && h <= 0.18)) {
          this.status = 'failed';
          this.failure = { type: type, row: this._rowOffset + this.nextRow, lane: this.lane, height: h, lastJumpAgo: this.jumpedAt >= 0 ? this.time - this.jumpedAt : null };
          if (type === 'wall' && row.motion && Math.round(state.movingLane) === this.lane) this.failure.mechanism = 'moving';
          else if (type === 'wall' && row.gate && state.gateClosed && row.gate.lane === this.lane) this.failure.mechanism = 'gate';
          this._moveBuffer = null;
          this._jumpBuffer = null;
          this.events.push({ type: 'crash', obstacle: type });
          this._notify();
          return;
        }
        this.passed++;
        this.score += 25;
        const perfectJump = (type === 'hurdle' || type === 'gap') && h >= 0.94;
        if (perfectJump) this.perfectJumps++;
        if (row.gem === this.lane || row.bonusGem === this.lane) {
          const bonus = row.gem !== this.lane && row.bonusGem === this.lane;
          this.gems++;
          this.combo++;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          this.score += 100 + 25 * Math.min(this.combo - 1, 8);
          const event = { type: 'gem', lane: this.lane, combo: this.combo, perfectJump: perfectJump };
          if (bonus) { this.bonusGems++; this.score += 200; event.bonusPoints = 200; }
          this.events.push(event);
        } else {
          if (row.gem >= 0 || Number.isInteger(row.bonusGem) && row.bonusGem >= 0) this.combo = 0;
          this.events.push({ type: 'pass', perfectJump: perfectJump });
        }
        this.nextRow++;
        this._notify();
      }
      this.time = until;
      this._maintainEndless();
      if (!this.level.endless && this.time >= this.level.duration) {
        this.status = 'won';
        this.score += 1000;
        this._moveBuffer = null;
        this._jumpBuffer = null;
        this.events.push({ type: 'win' });
        this._notify();
      }
    }
    drainEvents() { return this.events.splice(0); }
    get bufferedJump() { return this._jumpBuffer !== null; }
    get stage() { return Math.floor(this.time / 25) + 1; }
    get tier() { return Math.min(8, this.stage); }
    get distance() {
      if (!this.level.endless) return Math.floor(this.time * 12);
      const complete = Math.min(7, Math.floor(this.time / 25));
      return Math.floor(25 * (12 * complete + complete * (complete - 1)) + (this.time - complete * 25) * (12 + complete * 2));
    }
    get progress() { return this.level.endless ? 0 : Math.min(1, this.time / this.level.duration); }
    get stars() {
      if (this.practice || this.level.endless || this.status !== 'won') return 0;
      return this.gems >= this.totalGems ? 3 : this.gems >= Math.ceil(this.totalGems * .7) ? 2 : 1;
    }
  }
  const GOAL_LIMITS = { firstwin:1, fivewins:5, allwins:15, stars15:15, stars45:45, combo20:20, combo50:50, mirror5:5, rush5:5, daily3:3 };
  const MODES = ['normal', 'mirror', 'rush', 'mirrorRush'];
  function emptyEndlessRecord() { return { attempts: 0, bestScore: 0, bestDistance: 0, bestTime: 0, bestCombo: 0, bestBonus: 0, bestStage: 0 }; }
  function emptySave() { return { version: 1, unlocked: 1, records: {}, sound: true, music: true, vibration: true, effects: true, attempts: 0, challengeRecords: {}, dailyRecords: {}, goalProgress: {}, trialRecords: {}, endlessRecord: emptyEndlessRecord() }; }
  function nonNegative(value, maximum) { return Number.isFinite(value) ? Math.max(0, Math.min(maximum || 1000000000, Math.floor(value))) : 0; }
  function cleanTrialRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return { stars: nonNegative(raw.stars, 3), gems: nonNegative(raw.gems, 1000), progress: Number.isFinite(raw.progress) ? Math.max(0, Math.min(1, raw.progress)) : 0,
      attempts: nonNegative(raw.attempts), wins: nonNegative(raw.wins), bestScore: nonNegative(raw.bestScore), bestCombo: nonNegative(raw.bestCombo, 1000), bestBonus: nonNegative(raw.bestBonus, 1000) };
  }
  function cleanEndlessRecord(raw) {
    const record = emptyEndlessRecord();
    if (!raw || typeof raw !== 'object') return record;
    Object.keys(record).forEach(key => { record[key] = nonNegative(raw[key]); });
    // Preserve subsecond survival time; all other values are whole counters.
    record.bestTime = Number.isFinite(raw.bestTime) ? Math.max(0, Math.min(1000000000, raw.bestTime)) : 0;
    return record;
  }
  function validDay(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const y=Number(key.slice(0,4)),m=Number(key.slice(5,7)),d=Number(key.slice(8,10));
    const leap=y%4===0&&(y%100!==0||y%400===0);
    return y>=1 && m>=1 && m<=12 && d>=1 && d<=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1];
  }
  function cleanChallengeRecord(raw, baseId, mode) {
    if (!raw || typeof raw!=='object') return null;
    const integer=(n,max)=>Number.isFinite(n)?Math.max(0,Math.min(max,Math.floor(n))):0;
    return { baseId, mode, stars:integer(raw.stars,3), gems:integer(raw.gems,1000), progress:Number.isFinite(raw.progress)?Math.max(0,Math.min(1,raw.progress)):0,
      attempts:integer(raw.attempts,1000000000), wins:integer(raw.wins,1000000000), bestScore:integer(raw.bestScore,1000000000), bestCombo:integer(raw.bestCombo,1000) };
  }
  function cleanSave(raw) {
    const save = emptySave();
    if (!raw || typeof raw !== 'object') return save;
    if (typeof raw.sound === 'boolean') save.sound = raw.sound;
    if (typeof raw.music === 'boolean') save.music = raw.music;
    if (typeof raw.vibration === 'boolean') save.vibration = raw.vibration;
    if (typeof raw.effects === 'boolean') save.effects = raw.effects;
    save.attempts = Number.isFinite(raw.attempts) ? Math.max(0, Math.floor(raw.attempts)) : 0;
    if (raw.records && typeof raw.records === 'object') {
      for (let i = 1; i <= 15; i++) {
        const r = raw.records[i];
        if (!r || typeof r !== 'object') continue;
        save.records[i] = {
          stars: Number.isFinite(r.stars) ? Math.max(0, Math.min(3, Math.floor(r.stars))) : 0,
          gems: Number.isFinite(r.gems) ? Math.max(0, Math.floor(r.gems)) : 0,
          progress: Number.isFinite(r.progress) ? Math.max(0, Math.min(1, r.progress)) : 0,
          attempts: Number.isFinite(r.attempts) ? Math.max(0, Math.floor(r.attempts)) : 0,
          bestScore: Number.isFinite(r.bestScore) ? Math.max(0, Math.floor(r.bestScore)) : 0,
          bestCombo: Number.isFinite(r.bestCombo) ? Math.max(0, Math.floor(r.bestCombo)) : 0
        };
      }
    }
    if (raw.challengeRecords && typeof raw.challengeRecords==='object') {
      Object.keys(raw.challengeRecords).forEach(key=>{
        const match=/^([1-9]|1[0-5])-(normal|mirror|rush|mirrorRush)$/.exec(key);
        if (!match) return;
        const record=cleanChallengeRecord(raw.challengeRecords[key],Number(match[1]),match[2]);
        if(record)save.challengeRecords[key]=record;
      });
    }
    if (raw.dailyRecords && typeof raw.dailyRecords==='object') {
      Object.keys(raw.dailyRecords).filter(validDay).sort().slice(-60).forEach(key=>{
        const r=raw.dailyRecords[key];
        if(!r || !Number.isInteger(r.baseId) || r.baseId<1 || r.baseId>15 || !MODES.includes(r.mode))return;
        const record=cleanChallengeRecord(r,r.baseId,r.mode);
        if(record)save.dailyRecords[key]=record;
      });
    }
    if(raw.goalProgress && typeof raw.goalProgress==='object') {
      Object.keys(GOAL_LIMITS).forEach(key=>{
        const n=raw.goalProgress[key];
        if(Number.isFinite(n)&&n>0)save.goalProgress[key]=Math.min(GOAL_LIMITS[key],Math.floor(n));
      });
    }
    if (raw.trialRecords && typeof raw.trialRecords === 'object') {
      for (let id = 1; id <= 15; id++) {
        const record = cleanTrialRecord(raw.trialRecords[id]);
        if (record) save.trialRecords[id] = record;
      }
    }
    save.endlessRecord = cleanEndlessRecord(raw.endlessRecord);
    // Only campaign wins unlock the authored fifteen stages.
    while (save.unlocked < 15 && save.records[save.unlocked] && save.records[save.unlocked].stars > 0) save.unlocked++;
    return save;
  }
  function getRecord(save, level) {
    if (level.challengeKind === 'trial') return (save.trialRecords || {})[level.baseId] || null;
    if (level.challengeKind === 'endless') return save.endlessRecord || emptyEndlessRecord();
    if(level.challengeKind==='daily')return (save.dailyRecords||{})[level.dailyDate]||null;
    if(level.challengeKind==='level')return (save.challengeRecords||{})[level.challengeKey]||null;
    return save.records[level.id]||null;
  }
  function recordRun(save, run) {
    if (run.practice) return save;
    if (run.level.challengeKind === 'trial' || run.level.challengeKind === 'endless') {
      if (['failed', 'won', 'finished'].indexOf(run.status) < 0) return save;
      if (run.level.challengeKind === 'trial') {
        const id = run.level.baseId;
        if (!Number.isInteger(id) || id < 1 || id > 15) return save;
        if (!save.trialRecords) save.trialRecords = {};
        const old = cleanTrialRecord(save.trialRecords[id] || {});
        save.trialRecords[id] = { stars: Math.max(old.stars, run.stars), gems: Math.max(old.gems, run.gems), progress: Math.max(old.progress, run.progress),
          attempts: old.attempts + 1, wins: old.wins + (run.status === 'won' ? 1 : 0), bestScore: Math.max(old.bestScore, run.score),
          bestCombo: Math.max(old.bestCombo, run.maxCombo), bestBonus: Math.max(old.bestBonus, run.bonusGems) };
      } else {
        if (!run.level.endless) return save;
        const old = cleanEndlessRecord(save.endlessRecord);
        save.endlessRecord = { attempts: old.attempts + 1, bestScore: Math.max(old.bestScore, run.score), bestDistance: Math.max(old.bestDistance, run.distance),
          bestTime: Math.max(old.bestTime, run.time), bestCombo: Math.max(old.bestCombo, run.maxCombo), bestBonus: Math.max(old.bestBonus, run.bonusGems), bestStage: Math.max(old.bestStage, run.stage) };
      }
      return save;
    }
    if(run.level.challengeKind) {
      const level=run.level, id=level.baseId, mode=level.challengeMode;
      if(!Number.isInteger(id)||id<1||id>15||!MODES.includes(mode))return save;
      let bucket,key;
      if(level.challengeKind==='daily' && validDay(level.dailyDate||'')) { bucket='dailyRecords';key=level.dailyDate; }
      else if(level.challengeKind==='level' && level.challengeKey===id+'-'+mode) { bucket='challengeRecords';key=level.challengeKey; }
      else return save;
      if(!save[bucket])save[bucket]={};
      const old=cleanChallengeRecord(save[bucket][key]||{},id,mode);
      save[bucket][key]={ baseId:id,mode,stars:Math.max(old.stars,run.stars),gems:Math.max(old.gems,run.gems),progress:Math.max(old.progress,run.progress),
        attempts:old.attempts+1,wins:old.wins+(run.status==='won'?1:0),bestScore:Math.max(old.bestScore,run.score),bestCombo:Math.max(old.bestCombo,run.maxCombo) };
      return save;
    }
    const old = save.records[run.level.id] || { stars: 0, gems: 0, progress: 0, attempts: 0 };
    save.records[run.level.id] = {
      stars: Math.max(old.stars, run.stars),
      gems: Math.max(old.gems, run.gems),
      progress: Math.max(old.progress, run.progress),
      attempts: old.attempts + 1,
      bestScore: Math.max(Number.isFinite(old.bestScore) ? old.bestScore : 0, run.score),
      bestCombo: Math.max(Number.isFinite(old.bestCombo) ? old.bestCombo : 0, run.maxCombo)
    };
    if (run.status === 'won') save.unlocked = Math.min(15, Math.max(save.unlocked, run.level.id + 1));
    save.attempts++;
    return save;
  }
  return { Run, JUMP_DURATION, MOVE_COOLDOWN, INPUT_BUFFER, emptySave, cleanSave, recordRun, getRecord, rowState };
});
