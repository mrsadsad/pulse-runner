(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./levels.js'));
  else root.PulseChallenges = factory(root.PulseLevels);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (levels) {
  'use strict';

  const MODES = [
    { id: 'normal', name: '原版', code: 'N', mirror: false, speedFactor: 1, description: '原版路线，单独记录挑战成绩。' },
    { id: 'mirror', name: '镜像', code: 'M', mirror: true, speedFactor: 1, description: '整条路线左右翻转，跳跃节奏保持不变。' },
    { id: 'rush', name: '疾速', code: 'R', mirror: false, speedFactor: 1.15, description: '以原版 1.15 倍速度穿行，跳跃与换道冷却保持不变。' },
    { id: 'mirrorRush', name: '镜像疾速', code: 'X', mirror: true, speedFactor: 1.15, description: '左右镜像与 1.15 倍速度同时开启。' }
  ].map(mode => Object.freeze(mode));
  Object.freeze(MODES);

  function zeroPad(value, length) {
    let text = String(value);
    while (text.length < length) text = '0' + text;
    return text;
  }

  function getMode(mode) {
    const found = MODES.find(item => item.id === mode);
    if (!found) throw new RangeError('无效的挑战模式');
    return found;
  }

  function getBase(baseId) {
    if (!Number.isInteger(baseId) || baseId < 1 || baseId > 15) throw new RangeError('关卡编号必须为 1 至 15');
    const base = levels.find(item => item.id === baseId);
    if (!base) throw new RangeError('关卡不存在');
    return base;
  }

  function validDateKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }

  function localDateKey(date) {
    if (date === undefined) date = new Date();
    if (Object.prototype.toString.call(date) !== '[object Date]' || !Number.isFinite(date.getTime())) return null;
    const year = date.getFullYear();
    if (year < 1 || year > 9999) return null;
    return zeroPad(year, 4) + '-' + zeroPad(date.getMonth() + 1, 2) + '-' + zeroPad(date.getDate(), 2);
  }

  function makeLevel(baseId, mode) {
    const base = getBase(baseId), settings = getMode(mode === undefined ? 'normal' : mode);
    // Each invocation owns its nested data; challenge previews and retries can
    // never mutate the authored campaign or one another.
    const level = JSON.parse(JSON.stringify(base));
    const factor = settings.speedFactor;
    level.duration /= factor;
    level.lookAhead /= factor;
    level.rows = level.rows.map(row => ({
      t: row.t / factor,
      type: settings.mirror ? row.type.slice().reverse() : row.type.slice(),
      gem: settings.mirror && row.gem >= 0 ? 2 - row.gem : row.gem
    }));
    level.solution = level.solution.map(instruction => ({
      t: instruction.t / factor,
      action: settings.mirror && instruction.action !== 'jump'
        ? instruction.action === 'left' ? 'right' : 'left'
        : instruction.action
    }));
    level.baseId = baseId;
    level.challengeMode = settings.id;
    level.challengeKey = baseId + '-' + settings.id;
    level.challengeKind = 'level';
    level.speedFactor = factor;
    level.isMirrored = settings.mirror;
    return level;
  }

  function encodeLevelCode(baseId, mode) {
    getBase(baseId);
    return 'PR2-L' + zeroPad(baseId, 2) + '-' + getMode(mode === undefined ? 'normal' : mode).code;
  }

  function encodeDailyCode(dateKey) {
    if (!validDateKey(dateKey)) throw new RangeError('日期必须是真实有效的 YYYY-MM-DD');
    return 'PR2-' + dateKey.replace(/-/g, '');
  }

  function dailyDescriptor(dateKey) {
    const code = encodeDailyCode(dateKey);
    // The date and versioned code fully determine the route, offline. This hash
    // does not read the clock, progress, locale, network, or random state.
    let hash = 2166136261;
    for (let i = 0; i < dateKey.length; i++) hash = Math.imul(hash ^ dateKey.charCodeAt(i), 16777619) >>> 0;
    return { kind: 'daily', dateKey: dateKey, baseId: hash % 15 + 1,
      mode: ['mirror', 'rush', 'mirrorRush'][(hash >>> 8) % 3], code: code };
  }

  function makeDaily(dateKey) {
    const descriptor = dailyDescriptor(dateKey);
    const level = makeLevel(descriptor.baseId, descriptor.mode);
    level.challengeKind = 'daily';
    level.dailyDate = descriptor.dateKey;
    level.dailyCode = descriptor.code;
    return Object.assign({}, descriptor, { level: level });
  }

  function parseCode(input) {
    if (typeof input !== 'string' || input.length > 64 || !/^[\x00-\x7f]*$/.test(input)) return null;
    const code = input.trim().toUpperCase();
    const daily = /^PR2-(\d{4})(\d{2})(\d{2})$/.exec(code);
    if (daily) {
      const dateKey = daily[1] + '-' + daily[2] + '-' + daily[3];
      return validDateKey(dateKey) ? dailyDescriptor(dateKey) : null;
    }
    const challenge = /^PR2-L(0[1-9]|1[0-5])-([NMRX])$/.exec(code);
    if (!challenge) return null;
    const mode = MODES.find(item => item.code === challenge[2]);
    return { kind: 'level', baseId: Number(challenge[1]), mode: mode.id, code: code };
  }

  function nonNegative(value) { return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }

  function getGoals(save) {
    save = save && typeof save === 'object' ? save : {};
    let campaignWins = 0, totalStars = 0, bestCombo = 0, anyWin = false, dailyWins = 0;
    const mirrored = new Set(), rushed = new Set();
    const records = save.records && typeof save.records === 'object' ? save.records : {};
    for (let id = 1; id <= 15; id++) {
      const record = records[id];
      if (!record || typeof record !== 'object') continue;
      const stars = Math.min(3, nonNegative(record.stars));
      if (stars > 0) { campaignWins++; anyWin = true; }
      totalStars += stars;
      bestCombo = Math.max(bestCombo, nonNegative(record.bestCombo));
    }
    function modeWin(baseId, mode) {
      anyWin = true;
      if (mode === 'mirror' || mode === 'mirrorRush') mirrored.add(baseId);
      if (mode === 'rush' || mode === 'mirrorRush') rushed.add(baseId);
    }
    const challenges = save.challengeRecords && typeof save.challengeRecords === 'object' ? save.challengeRecords : {};
    for (const key of Object.keys(challenges)) {
      const match = /^([1-9]|1[0-5])-(normal|mirror|rush|mirrorRush)$/.exec(key), record = challenges[key];
      if (!match || !record || typeof record !== 'object') continue;
      bestCombo = Math.max(bestCombo, nonNegative(record.bestCombo));
      if (nonNegative(record.wins) > 0) modeWin(Number(match[1]), match[2]);
    }
    const dailyRecords = save.dailyRecords && typeof save.dailyRecords === 'object' ? save.dailyRecords : {};
    for (const dateKey of Object.keys(dailyRecords)) {
      const record = dailyRecords[dateKey];
      if (!validDateKey(dateKey) || !record || typeof record !== 'object') continue;
      bestCombo = Math.max(bestCombo, nonNegative(record.bestCombo));
      if (nonNegative(record.wins) > 0) {
        dailyWins++;
        const descriptor = dailyDescriptor(dateKey);
        modeWin(descriptor.baseId, descriptor.mode);
      }
    }
    const trials=save.trialRecords&&typeof save.trialRecords==='object'?save.trialRecords:{};
    for(let id=1;id<=15;id++){
      const record=trials[id];
      if(!record||typeof record!=='object')continue;
      bestCombo=Math.max(bestCombo,nonNegative(record.bestCombo));
      if(nonNegative(record.wins)>0)anyWin=true;
    }
    if(save.endlessRecord&&typeof save.endlessRecord==='object')bestCombo=Math.max(bestCombo,nonNegative(save.endlessRecord.bestCombo));
    const goals = [
      ['firstwin', '首战告捷', '完成一次主线、变式、每日或机关试炼。', anyWin ? 1 : 0, 1],
      ['fivewins', '初醒突破', '通关原版主线的 5 个不同关卡。', campaignWins, 5],
      ['allwins', '穿过极限', '通关原版主线全部 15 关。', campaignWins, 15],
      ['stars15', '星光初聚', '主线累计获得 15 颗星。', totalStars, 15],
      ['stars45', '完美穿行', '主线全部关卡三星，集齐 45 颗星。', totalStars, 45],
      ['combo20', '连成一道光', '任意正式挑战中达到 20 连击。', bestCombo, 20],
      ['combo50', '不间断脉冲', '任意正式挑战中达到 50 连击。', bestCombo, 50],
      ['mirror5', '镜像掌控', '以镜像或镜像疾速通关 5 个不同基础关卡，包含每日挑战。', mirrored.size, 5],
      ['rush5', '疾速掌控', '以疾速或镜像疾速通关 5 个不同基础关卡，包含每日挑战。', rushed.size, 5],
      ['daily3', '三日穿行', '完成 3 个不同日期的每日挑战，无需连续。', dailyWins, 3]
    ];
    const savedGoals = save.goalProgress && typeof save.goalProgress === 'object' ? save.goalProgress : {};
    return goals.map(goal => {
      const current = Math.min(Math.max(goal[3], nonNegative(savedGoals[goal[0]])), goal[4]);
      return { id: goal[0], title: goal[1], description: goal[2],
        current: current, target: goal[4], unlocked: current >= goal[4] };
    });
  }

  return { MODES: MODES, makeLevel: makeLevel, makeDaily: makeDaily, localDateKey: localDateKey,
    encodeLevelCode: encodeLevelCode, encodeDailyCode: encodeDailyCode, parseCode: parseCode, getGoals: getGoals,
    validDateKey: validDateKey, OFFLINE_NOTICE: '挑战码在本机还原固定路线，无需联网，不提供在线排行榜。' };
});
