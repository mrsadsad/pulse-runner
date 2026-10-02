(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./levels.js'));
  else root.PulseExpedition = factory(root.PulseLevels);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (levels) {
  'use strict';

  const STAGE_SECONDS = 25;
  const MAX_TIER = 8;
  function pad(value, width) { let text = String(value); while (text.length < width) text = '0' + text; return text; }
  function round(value) { return Math.round(value * 1000000) / 1000000; }
  function modulo(value, period) { return ((value % period) + period) % period; }
  function validId(id) { return Number.isInteger(id) && id >= 1 && id <= 15; }
  function validSeed(seed) { return Number.isInteger(seed) && seed >= 0 && seed <= 4294967295; }
  function hash(seed, index) {
    let value = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  }

  function mechanicRow(t, safeLane, index, variant, lookAhead) {
    const other = [0, 1, 2].filter(lane => lane !== safeLane);
    const row = { t: round(t), type: ['wall', 'wall', 'wall'], gem: safeLane, index: index };
    row.type[safeLane] = null;
    // The safer crystal remains available on every encounter. Taking the
    // optional crystal counts once and exchanges a jump for 200 extra points.
    if (index % 6 === 4) {
      row.bonusGem = other[(variant + Math.floor(index / 6)) % 2];
      row.type[row.bonusGem] = (Math.floor(index / 6) + variant) % 2 ? 'hurdle' : 'gap';
    }
    const hazardLane = row.bonusGem === undefined ? other[(variant + index) % 2] : other.find(lane => lane !== row.bonusGem);
    const mechanic = (index + variant) % 3;
    if (mechanic === 1) {
      row.type[hazardLane] = null;
      row.motion = { from: other.find(lane => lane !== hazardLane), to: hazardLane,
        moveStart: round(t - Math.min(1.75, lookAhead - .15)), moveEnd: round(t - .90) };
      if (row.type[row.motion.from] === 'wall') row.type[row.motion.from] = null;
    } else if (mechanic === 2) {
      row.type[hazardLane] = null;
      const period = 1.25 + variant % 3 * .15, lockAt = round(t - .90), closed = (index + variant) % 4 !== 0;
      row.gate = { lane: hazardLane, period: period,
        phase: modulo(period * (closed ? .25 : .75) - lockAt, period), lockAt: lockAt, closed: closed };
    }
    return row;
  }

  function appendInstructions(target, row, lane, risk) {
    const destination = risk && row.bonusGem !== undefined ? row.bonusGem : row.gem;
    const distance = Math.abs(destination - lane), direction = destination < lane ? 'left' : 'right';
    const actions = [];
    if (distance) actions.push({ t: round(row.t - .45), action: direction });
    if (distance === 2) actions.push({ t: round(row.t - .30), action: direction });
    if (row.type[destination] === 'hurdle' || row.type[destination] === 'gap') actions.push({ t: round(row.t - .41), action: 'jump' });
    actions.sort((a, b) => a.t - b.t);
    actions.forEach(action => target.push(action));
    return destination;
  }

  function encodeTrialCode(id) {
    if (!validId(id)) throw new RangeError('机关试炼编号必须为 1 至 15');
    return 'PR3-T-' + pad(id, 2);
  }
  function encodeEndlessCode(seed) {
    if (!validSeed(seed)) throw new RangeError('无尽路线种子必须是 32 位无符号整数');
    return 'PR3-E-' + pad(seed.toString(16).toUpperCase(), 8);
  }
  function parseCode(input) {
    if (typeof input !== 'string' || input.length > 64 || !/^[\x00-\x7f]*$/.test(input)) return null;
    const code = input.trim().toUpperCase(), trial = /^PR3-T-(0[1-9]|1[0-5])$/.exec(code);
    if (trial) return { kind: 'trial', baseId: Number(trial[1]), mode: 'normal', code: code };
    const endless = /^PR3-E-([0-9A-F]{8})$/.exec(code);
    return endless ? { kind: 'endless', baseId: 1, mode: 'normal', seed: parseInt(endless[1], 16), code: code } : null;
  }

  function makeTrial(baseId) {
    if (!validId(baseId)) throw new RangeError('机关试炼编号必须为 1 至 15');
    const base = levels.find(level => level.id === baseId), level = JSON.parse(JSON.stringify(base));
    level.challengeKind = 'trial'; level.baseId = baseId; level.challengeMode = 'normal';
    level.challengeKey = String(baseId); level.code = encodeTrialCode(baseId);
    level.subtitle = '移动高墙 · 周期闸门 · 风险晶体';
    level.tutorial = '移动高墙会提前停在箭头标出的轨道。闸门靠近前会锁定开闭状态。普通晶体在安全通道；跳过矮栏或断层收集风险晶体，额外获得 200 分。';
    level.description = '同一条路线，两种选择：稳稳通关，或冒险跳跃追求更高分。机关试炼独立记录，不解锁主线。';
    level.rows = base.rows.map((row, index) => mechanicRow(row.t, row.gem, index, baseId, base.lookAhead));
    level.solution = []; level.riskSolution = [];
    let safeLane = 1, riskLane = 1;
    level.rows.forEach(row => {
      safeLane = appendInstructions(level.solution, row, safeLane, false);
      riskLane = appendInstructions(level.riskSolution, row, riskLane, true);
    });
    level.bonusTotal = level.rows.filter(row => row.bonusGem !== undefined).length;
    return level;
  }

  function makeEndless(seed) {
    if (!validSeed(seed)) throw new RangeError('无尽路线种子必须是 32 位无符号整数');
    const level = { id: 1, baseId: 1, name: '无尽穿行', subtitle: '每 25 秒升级，挑战自己的极限', chapter: 1,
      difficulty: 1, duration: Infinity, lookAhead: 2.9, endless: true, challengeKind: 'endless', challengeMode: 'normal',
      seed: seed, code: encodeEndlessCode(seed), rows: [], solution: [], riskSolution: [], maxGems: Infinity,
      tutorial: '没有终点，碰撞结束。每 25 秒节奏升级，八档之后保持最高难度。暂停时可结算本次成绩。安全路线与风险晶体由你选择。',
      description: '同一种子始终生成相同路线。独立记录最高得分与最远距离，不改变主线进度。' };
    const motifs = [
      [1, 0, 1, 2, 0, 1, 2, 1], [1, 2, 0, 1, 2, 0, 2, 1],
      [0, 1, 2, 1, 0, 2, 1, 0], [2, 0, 1, 0, 2, 1, 0, 2],
      [1, 0, 2, 0, 1, 2, 0, 1], [0, 2, 1, 2, 0, 1, 2, 0]
    ];
    let nextIndex = 0, nextTime = 3.5, safeLane = 1, riskLane = 1;
    level.ensureRows = function (until) {
      if (!Number.isFinite(until) || until < 0) return;
      while (nextTime <= until + 1e-8) {
        const block = Math.floor(nextIndex / 8), choice = hash(seed, block);
        const motif = motifs[choice % motifs.length];
        const lane = (choice & 256) ? 2 - motif[nextIndex % 8] : motif[nextIndex % 8];
        const tier = Math.min(MAX_TIER, Math.floor(nextTime / STAGE_SECONDS) + 1);
        const row = mechanicRow(nextTime, lane, nextIndex, hash(seed, Math.floor(nextIndex / 6)) % 15, Math.max(1.9, 2.9 - (tier - 1) * .14));
        row.tier = tier;
        level.rows.push(row);
        safeLane = appendInstructions(level.solution, row, safeLane, false);
        riskLane = appendInstructions(level.riskSolution, row, riskLane, true);
        nextIndex++;
        nextTime = round(nextTime + Math.max(.95, 1.6 - (tier - 1) * .1));
      }
    };
    level.pruneRows = function (count) {
      count = Math.max(0, Math.min(level.rows.length, Math.floor(count)));
      if (!count) return;
      level.rows.splice(0, count);
      const from = level.rows.length ? level.rows[0].t - .5 : nextTime - .5;
      while (level.solution.length && level.solution[0].t < from) level.solution.shift();
      while (level.riskSolution.length && level.riskSolution[0].t < from) level.riskSolution.shift();
    };
    level.ensureRows(8);
    return level;
  }

  return { makeTrial: makeTrial, makeEndless: makeEndless, encodeTrialCode: encodeTrialCode,
    encodeEndlessCode: encodeEndlessCode, parseCode: parseCode, STAGE_SECONDS: STAGE_SECONDS, MAX_TIER: MAX_TIER };
});
