(function (root, factory) {
  const levels = factory();
  if (typeof module === 'object' && module.exports) module.exports = levels;
  else root.PulseLevels = levels;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Encounters are authored as repeatable lane motifs. Nothing changes after a
  // retry: the player can learn a difficult section and improve their timing.
  const specs = [
    { name: '初次脉冲', subtitle: '左右换道，找到节奏', duration: 26, count: 15, lookAhead: 2.80,
      route: [1, 0, 1, 2, 1, 0, 1, 2],
      tutorial: '点击左、右按钮换道。橙红高墙不能跳过，提前观察下一道缺口。',
      description: '从连续折返开始，学会在三条轨道之间保持节奏。' },
    { name: '离地瞬间', subtitle: '第一次起跳', duration: 28, count: 18, lookAhead: 2.80,
      route: [1, 1, 1, 0, 0, 1, 2, 2, 1],
      tutorial: '金色矮栏需要起跳越过。障碍接近底部判定线时，点击跳跃。',
      description: '在换道之间插入起跳，落地之后才能再次跳跃。' },
    { name: '折返走廊', subtitle: '看清两步之后', duration: 30, count: 21, lookAhead: 2.72,
      route: [1, 2, 0, 1, 0, 2, 1, 2, 1, 0],
      tutorial: '从最左到最右需要连续换道两次。起跳过程中也可以换道。',
      description: '高墙收窄通道，跨越两条轨道时也要留意前方矮栏。' },
    { name: '断桥信号', subtitle: '别踏入黑色裂隙', duration: 32, count: 24, lookAhead: 2.72,
      route: [1, 1, 0, 0, 1, 2, 2, 1],
      tutorial: '黑色断层也需要起跳。看准脚下的判定线，不要在远处就起跳。',
      description: '矮栏与断层交替出现，保持准确的起跳时机。' },
    { name: '交叉节拍', subtitle: '换道与起跳相接', duration: 34, count: 27, lookAhead: 2.65,
      route: [1, 0, 2, 0, 2, 1, 0, 2, 1],
      tutorial: '先锁定下一个缺口，再准备跳跃。两次换道与一次起跳可以连续完成。',
      description: '第一章的综合挑战：跨轨折返之后，立刻越过障碍。' },
    { name: '镜面回廊', subtitle: '熟悉的路线开始翻转', duration: 36, count: 30, lookAhead: 2.62,
      route: [0, 1, 2, 2, 1, 0, 0, 2, 1, 2], mirror: true,
      tutorial: '每一组路线都会左右翻转。能量晶体提示可收集的路线，注意下一组入口。',
      description: '镜像排列打破惯性，需要重新判断每一次左右方向。' },
    { name: '全线封锁', subtitle: '这一次必须跳', duration: 38, count: 34, lookAhead: 2.58,
      route: [1, 0, 0, 2, 2, 1, 0, 1, 2, 1],
      tutorial: '横跨三条轨道的金色矮栏没有侧面出口。保持节奏，直接跳过。',
      description: '整排矮栏加入路线，换道与跳跃开始形成连续节拍。' },
    { name: '悬空回声', subtitle: '连桥消失的瞬间', duration: 40, count: 38, lookAhead: 2.52,
      route: [1, 2, 2, 0, 1, 0, 0, 2], mirror: true,
      tutorial: '整排黑色断层同样可以跳过。落地后立即观察下一道高墙。',
      description: '跨越整条断桥，再从高墙之间找到下一段落脚点。' },
    { name: '急速回环', subtitle: '节奏再快一点', duration: 42, count: 42, lookAhead: 2.48,
      route: [0, 1, 2, 0, 1, 2, 2, 1, 0, 2, 1, 0],
      tutorial: '路线形成连续回环。别只盯住眼前障碍，提前看下一条通道。',
      description: '更密集的折返把路线记忆与即时反应连接起来。' },
    { name: '双重奏', subtitle: '双跨与跳跃组合', duration: 44, count: 46, lookAhead: 2.43,
      route: [0, 2, 0, 1, 2, 0, 2, 1],
      tutorial: '两侧通道频繁交替。连续点击同一个方向可跨过两条轨道。',
      description: '第二章终点：两次换道、准确起跳，完成完整组合。' },
    { name: '高压脉冲', subtitle: '在间隙中换位', duration: 46, count: 50, lookAhead: 2.38,
      route: [1, 0, 2, 0, 1, 2, 0, 2, 2, 1, 0, 1], mirror: true,
      tutorial: '障碍间隔进一步缩短。通过一排后，立即准备下一次换位。',
      description: '密集通道夹着短暂喘息，抓住空隙重新整理节奏。' },
    { name: '碎光阶梯', subtitle: '三条轨道步步收紧', duration: 48, count: 54, lookAhead: 2.30,
      route: [0, 1, 2, 1, 0, 2, 1, 2, 0, 1],
      tutorial: '阶梯路线中会突然出现双跨。注意能量晶体位置，及时改变方向。',
      description: '渐进换道与突然折返交错，断层留给判断的时间更少。' },
    { name: '逆向风暴', subtitle: '打破手指的惯性', duration: 50, count: 58, lookAhead: 2.24,
      route: [2, 0, 1, 0, 2, 1, 2, 0, 0, 2], mirror: true,
      tutorial: '路线再次翻转，跳跃也不会暂停换道。用短而明确的操作控制位置。',
      description: '反向折返穿插全线障碍，每一次操作都要落在节拍里。' },
    { name: '临界反应', subtitle: '逼近反应的边界', duration: 51, count: 61, lookAhead: 2.16,
      route: [0, 2, 1, 2, 0, 1, 0, 2, 0, 1, 2, 1],
      tutorial: '跳过整排障碍后仍要立刻换道。尽量把视线放在判定线上方两排。',
      description: '全线矮栏、断桥与窄通道轮番出现，为最终挑战热身。' },
    { name: '最后穿行', subtitle: '把所有反应连成一次', duration: 52, count: 64, lookAhead: 2.10,
      route: [0, 2, 0, 1, 2, 0, 2, 1, 0, 2, 1, 0], mirror: true,
      tutorial: '最终关集齐所有障碍。失败也可以立刻重试，每次路线始终相同。',
      description: '六十四道节拍，最后五十二秒。保持冷静，完成最后一次穿行。' }
  ];

  function roundTime(value) { return Math.round(value * 1000) / 1000; }

  // A required jump never follows another by less than two encounters. Even
  // the final level leaves over 1.47 seconds between required jumps, compared
  // with the player's 0.82-second jump duration.
  function jumpType(id, index) {
    if (id === 1) return null;
    if (id === 2) return index % 4 === 2 ? 'hurdle' : null;
    if (id === 3) return index % 4 === 1 ? 'hurdle' : null;
    if (id === 4) return index % 4 === 2 ? 'gap' : index % 8 === 4 ? 'hurdle' : null;
    if (id === 5) return index % 3 === 1 ? (index % 2 ? 'hurdle' : 'gap') : null;
    if (index % 2 !== 0) return null;
    if (id === 11 && index % 12 === 10) return null;
    if (id === 8) return 'gap';
    if (id === 12) return index % 4 === 0 ? 'gap' : 'hurdle';
    if (id === 14) return index % 8 === 6 ? 'gap' : 'hurdle';
    if (id === 15 && index % 12 === 10) return 'gap';
    return index % 4 === 0 ? 'hurdle' : 'gap';
  }

  function isFullWidth(id, index) {
    if (id === 7) return index % 6 === 2;
    if (id === 8) return index % 8 === 6;
    if (id === 9) return index % 8 === 4;
    if (id === 10) return index % 10 === 0;
    if (id === 11) return index % 12 === 4;
    if (id === 12) return index % 10 === 8;
    if (id === 13) return index % 12 === 4 || index % 12 === 10;
    if (id === 14) return index % 8 === 2 || index % 8 === 6;
    if (id === 15) return index % 12 === 4 || index % 12 === 10;
    return false;
  }

  function buildLevel(spec, offset) {
    const id = offset + 1;
    const rows = [];
    const solution = [];
    let previousLane = 1;
    const firstEncounter = 3.5;
    const lastEncounter = spec.duration - 2.1;
    const spacing = (lastEncounter - firstEncounter) / (spec.count - 1);

    for (let index = 0; index < spec.count; index++) {
      const t = roundTime(firstEncounter + spacing * index);
      let lane = spec.route[index % spec.route.length];
      if (spec.mirror && Math.floor(index / spec.route.length) % 2) lane = 2 - lane;
      let obstacle = jumpType(id, index);
      let type = ['wall', 'wall', 'wall'];

      if (isFullWidth(id, index)) {
        // The introduction to whole-track barriers always uses a hurdle.
        if (id === 7 || id === 9 || id === 10 || id === 11) obstacle = 'hurdle';
        if (id === 8 || id === 12) obstacle = 'gap';
        if (id === 13) obstacle = index % 12 === 4 ? 'hurdle' : 'gap';
        if (id === 14) obstacle = index % 8 === 2 ? 'hurdle' : 'gap';
        type = [obstacle, obstacle, obstacle];
      } else {
        type[lane] = obstacle;
        // Early encounters sometimes allow a second safe lane; the crystal
        // still marks the full-score route. Later corridors require accuracy.
        if (id === 1 && index % 3 === 1) type[(lane + 1) % 3] = null;
        if (id === 2 && index % 4 === 0) type[(lane + 2) % 3] = null;
        if ((id === 4 || id === 6 || id === 8 || id === 12) && index % 3 === 0) {
          type[(lane + 1) % 3] = id >= 4 ? 'gap' : 'hurdle';
        }
      }

      rows.push({ t: t, type: type, gem: lane });
      const distance = Math.abs(lane - previousLane);
      const action = lane < previousLane ? 'left' : 'right';
      if (distance >= 1) solution.push({ t: roundTime(t - 0.45), action: action });
      if (distance === 2) solution.push({ t: roundTime(t - 0.30), action: action });
      if (obstacle === 'hurdle' || obstacle === 'gap') {
        solution.push({ t: roundTime(t - 0.41), action: 'jump' });
      }
      previousLane = lane;
    }

    solution.sort(function (a, b) { return a.t - b.t; });
    return {
      id: id,
      name: spec.name,
      subtitle: spec.subtitle,
      chapter: Math.ceil(id / 5),
      difficulty: Math.ceil(id / 3),
      duration: spec.duration,
      lookAhead: spec.lookAhead,
      tutorial: spec.tutorial,
      description: spec.description,
      expectedRows: rows.length,
      maxGems: rows.length,
      rows: rows,
      solution: solution
    };
  }

  return specs.map(buildLevel);
});
