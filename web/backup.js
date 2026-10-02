(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./profile.js'), require('./challenges.js'), require('./replay.js'));
  else root.PulseBackup = factory(root.PulseProfile, root.PulseChallenges, root.PulseReplay);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Profile, Challenges, Replay) {
  'use strict';

  const APP = 'pulse-runner', FORMAT = 1;
  const LIMITS = Object.freeze({ textChars: 200000, saveChars: 65536 });
  const RECORD_BUCKETS = ['records', 'challengeRecords', 'dailyRecords', 'trialRecords'];
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function fail(message) { throw new Error(message); }

  // A canonical representation makes whitespace and object-key ordering harmless.
  // The checksum detects accidental edits; it is deliberately not authentication.
  function canonical(value, depth) {
    depth = depth || 0;
    if (depth > 48) fail('备份内容嵌套过深，无法读取。');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('备份中存在无效数值。');
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      const items = [];
      for (let i = 0; i < value.length; i++) {
        if (!own(value, i)) fail('备份数组不完整。');
        items.push(canonical(value[i], depth + 1));
      }
      return '[' + items.join(',') + ']';
    }
    if (!object(value)) fail('备份包含不支持的数据。');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
  }
  function checksum(value) {
    const text = canonical(value);
    let hash = 2166136261;
    // Hash both bytes of each UTF-16 code unit so all JSON characters participate.
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      hash = Math.imul(hash ^ (code & 255), 16777619) >>> 0;
      hash = Math.imul(hash ^ (code >>> 8), 16777619) >>> 0;
    }
    let hex = hash.toString(16).toUpperCase();
    while (hex.length < 8) hex = '0' + hex;
    return 'fnv1a32:' + hex;
  }
  function validTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }
  function recognizeSave(raw) {
    if (!object(raw)) fail('这不是有效的脉冲穿行存档。');
    if (own(raw, 'version') && raw.version !== 1) fail('存档版本不受支持，请使用兼容的游戏版本。');
    if (raw.version !== 1 || !Number.isInteger(raw.unlocked) || raw.unlocked < 1 || raw.unlocked > 15 ||
        !object(raw.records) || !Number.isFinite(raw.attempts) || raw.attempts < 0 ||
        typeof raw.sound !== 'boolean' || typeof raw.vibration !== 'boolean') {
      fail('缺少存档识别字段；请导入脉冲穿行导出的备份或完整旧存档。');
    }
  }
  function checkSaveSize(save) {
    if (JSON.stringify(save).length > LIMITS.saveChars) fail('存档内容超过 65536 字符，无法安全保存。');
    return save;
  }

  function snapshotGoals(save, source) {
    Challenges.getGoals(source || save).forEach(goal => {
      if (goal.current > 0) save.goalProgress[goal.id] = goal.current;
    });
  }
  function cleanWithGoals(raw) {
    // Profile intentionally caps daily history. Derive sticky achievements from
    // individually sanitized history before that cap, including a merged history.
    const save = Profile.cleanSave(raw);
    const daily = object(raw.dailyRecords) ? raw.dailyRecords : {};
    const allDaily = {}, keys = Object.keys(daily).filter(Challenges.validDateKey);
    for (let i = 0; i < keys.length; i += 60) {
      const batch = {};
      keys.slice(i, i + 60).forEach(key => { batch[key] = daily[key]; });
      const cleaned = Profile.cleanSave({ dailyRecords: batch }).dailyRecords;
      Object.keys(cleaned).forEach(key => { allDaily[key] = cleaned[key]; });
    }
    snapshotGoals(save, Object.assign({}, save, { dailyRecords: allDaily }));
    // Newly recovered achievements can validate an earned item in a replacement.
    save.equipped = raw.equipped;
    return checkSaveSize(Profile.cleanSave(save));
  }
  function summarize(save) {
    save = cleanWithGoals(object(save) ? save : {});
    let completed = 0, stars = 0;
    for (let id = 1; id <= 15; id++) {
      const record = save.records[id];
      if (record) { stars += record.stars; if (record.stars > 0) completed++; }
    }
    return { completed: completed, stars: stars, unlocked: save.unlocked,
      goalCount: Challenges.getGoals(save).filter(goal => goal.unlocked).length, replayCount: save.replays.length };
  }
  function exportSave(save, nowISOString) {
    recognizeSave(save);
    const createdAt = nowISOString === undefined ? new Date().toISOString() : nowISOString;
    if (!validTimestamp(createdAt)) fail('备份时间必须是有效的 ISO 时间。');
    const payload = cleanWithGoals(save);
    const envelope = { app: APP, formatVersion: FORMAT, createdAt: createdAt, payload: payload };
    envelope.checksum = checksum(envelope);
    // Keep large operation traces compact so a complete valid profile always fits.
    const text = JSON.stringify(envelope);
    if (text.length > LIMITS.textChars) fail('备份文本过大，无法导出。');
    return text;
  }
  function inspect(text) {
    if (typeof text !== 'string') fail('请先选择备份文件或粘贴备份文本。');
    if (text.length > LIMITS.textChars) fail('备份文本超过 200000 字符，无法读取。');
    if (!text.trim()) fail('请先选择备份文件或粘贴备份文本。');
    let raw;
    try { raw = JSON.parse(text.trim()); } catch (error) { fail('备份不是完整有效的 JSON 文本。'); }
    if (!object(raw)) fail('这不是有效的脉冲穿行备份。');
    // Bound depth and reject JSON numeric overflow before any cleaning can hide it.
    canonical(raw);
    let payload = raw, createdAt = null, legacy = true;
    const warnings = [];
    if (own(raw, 'app') || own(raw, 'formatVersion') || own(raw, 'payload') || own(raw, 'checksum')) {
      legacy = false;
      if (raw.app !== APP) fail('备份不属于脉冲穿行，无法导入。');
      if (raw.formatVersion !== FORMAT) fail('备份格式版本不受支持，请使用兼容的游戏版本。');
      if (Object.keys(raw).some(key => !['app', 'formatVersion', 'createdAt', 'payload', 'checksum'].includes(key))) fail('备份封装包含未知字段，无法读取。');
      if (!validTimestamp(raw.createdAt)) fail('备份时间无效，文件可能已损坏。');
      if (typeof raw.checksum !== 'string' || !/^fnv1a32:[0-9A-F]{8}$/.test(raw.checksum)) fail('备份缺少有效校验和。');
      const signed = { app: raw.app, formatVersion: raw.formatVersion, createdAt: raw.createdAt, payload: raw.payload };
      if (checksum(signed) !== raw.checksum) fail('备份校验失败，内容可能被误改或损坏。');
      payload = raw.payload;
      createdAt = raw.createdAt;
    } else {
      warnings.push('这是旧版原始存档，未带校验和，无法检查传输中的误改。');
    }
    recognizeSave(payload);
    checkSaveSize(payload);
    const save = cleanWithGoals(payload);
    if (canonical(payload) !== canonical(save)) warnings.push('已按当前版本校验存档字段，并补齐设置、保留已达成成就；无效或超出容量的数据已整理。');
    return { save: save, summary: summarize(save), warnings: warnings, createdAt: createdAt, legacy: legacy };
  }
  function mergeRecord(left, right) {
    const result = Object.assign({}, left || {});
    Object.keys(right || {}).forEach(key => {
      if (typeof right[key] === 'number' && key !== 'baseId') result[key] = Math.max(typeof result[key] === 'number' ? result[key] : 0, right[key]);
      else if (!own(result, key)) result[key] = right[key];
    });
    return result;
  }
  function merge(current, incoming) {
    recognizeSave(current); recognizeSave(incoming);
    const local = cleanWithGoals(current), imported = cleanWithGoals(incoming);
    // Begin with the local profile so every current/future sanitized preference
    // (including controls), equipped item and ghost switch remains on this device.
    const result = Object.assign({}, local);
    RECORD_BUCKETS.forEach(bucket => {
      result[bucket] = {};
      const keys = Object.keys(local[bucket]).concat(Object.keys(imported[bucket]));
      keys.forEach(key => { result[bucket][key] = mergeRecord(local[bucket][key], imported[bucket][key]); });
    });
    result.attempts = Math.max(local.attempts, imported.attempts);
    result.unlocked = Math.max(local.unlocked, imported.unlocked);
    result.goalProgress = mergeRecord(local.goalProgress, imported.goalProgress);
    result.endlessRecord = mergeRecord(local.endlessRecord, imported.endlessRecord);
    result.replays = Replay.cleanArchive(local.replays.concat(imported.replays));
    snapshotGoals(result);
    return cleanWithGoals(result);
  }

  return Object.freeze({ exportSave: exportSave, inspect: inspect, merge: merge, summarize: summarize, LIMITS: LIMITS });
});
