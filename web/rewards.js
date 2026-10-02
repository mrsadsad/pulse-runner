(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./challenges.js'));
  else root.PulseRewards = factory(root.PulseChallenges);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Challenges) {
  'use strict';

  const CATALOG = Object.freeze([
    { id: 'pulse', kind: 'skin', name: '原初脉冲', goal: null, color: '#c2f5a2', shape: 'pulse', description: '最初的穿行器，随章节变换颜色。' },
    { id: 'classic', kind: 'trail', name: '经典光束', goal: null, color: '#c2f5a2', style: 'classic', description: '沿用穿行器颜色的经典光束。' },
    { id: 'spark', kind: 'skin', name: '初燃', goal: 'firstwin', color: '#ffad73', shape: 'spark', description: '完成第一次正式通关，点亮橙色双翼。' },
    { id: 'twin', kind: 'trail', name: '双轨', goal: 'fivewins', color: '#89e3ff', style: 'twin', description: '两束平行的光，纪念五次主线突破。' },
    { id: 'aurora', kind: 'skin', name: '极光梭', goal: 'allwins', color: '#90e8f3', shape: 'aurora', description: '穿过全部主线关卡，收藏修长的极光机翼。' },
    { id: 'prism', kind: 'skin', name: '星棱', goal: 'stars15', color: '#c4afff', shape: 'prism', description: '汇集十五颗星，凝成紫色棱晶。' },
    { id: 'crown', kind: 'skin', name: '星冠', goal: 'stars45', color: '#ffdb85', shape: 'crown', description: '四十五颗星的纪念，三道金色尖峰。' },
    { id: 'dots', kind: 'trail', name: '星点', goal: 'combo20', color: '#dfb4ff', style: 'dots', description: '二十连击留下的点点星光。' },
    { id: 'comet', kind: 'trail', name: '彗尾', goal: 'combo50', color: '#ffc99b', style: 'comet', description: '五十次不间断的节奏，汇成一道彗尾。' },
    { id: 'kite', kind: 'skin', name: '镜翼', goal: 'mirror5', color: '#f3a5d6', shape: 'kite', description: '征服五条镜像路线，展开对称的菱形机翼。' },
    { id: 'ribbon', kind: 'trail', name: '疾风带', goal: 'rush5', color: '#90f0cc', style: 'ribbon', description: '五条疾速路线的纪念，流动的薄光带。' },
    { id: 'echo', kind: 'trail', name: '回声环', goal: 'daily3', color: '#97c5ff', style: 'echo', description: '三日穿行留下的环形回声。' }
  ].map(item => Object.freeze(item)));
  const defaults = Object.freeze({ skin: 'pulse', trail: 'classic' });
  function goalMap(save) {
    const map = Object.create(null);
    Challenges.getGoals(save || {}).forEach(goal => { map[goal.id] = goal; });
    return map;
  }
  function cleanEquipped(raw, save) {
    const goals = goalMap(save), equipped = { skin: defaults.skin, trail: defaults.trail };
    if (!raw || typeof raw !== 'object') return equipped;
    ['skin', 'trail'].forEach(kind => {
      const item = CATALOG.find(entry => entry.kind === kind && entry.id === raw[kind]);
      if (item && (!item.goal || goals[item.goal] && goals[item.goal].unlocked)) equipped[kind] = item.id;
    });
    return equipped;
  }
  function getItems(save) {
    save = save || {};
    const goals = goalMap(save), equipped = cleanEquipped(save.equipped, save);
    return CATALOG.map(item => {
      const goal = item.goal && goals[item.goal];
      return Object.assign({}, item, { unlocked: !item.goal || !!(goal && goal.unlocked),
        current: goal ? goal.current : 1, target: goal ? goal.target : 1, equipped: equipped[item.kind] === item.id });
    });
  }
  function appearance(equipped) {
    const raw = equipped && typeof equipped === 'object' ? equipped : defaults;
    return { skin: CATALOG.find(item => item.kind === 'skin' && item.id === raw.skin) || CATALOG[0],
      trail: CATALOG.find(item => item.kind === 'trail' && item.id === raw.trail) || CATALOG[1] };
  }
  return { CATALOG: CATALOG, getItems: getItems, cleanEquipped: cleanEquipped, appearance: appearance };
});
