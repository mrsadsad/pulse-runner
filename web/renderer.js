(function (root) {
  'use strict';
  const themes = [
    { name: '苔原信号', sky: '#101615', haze: '#19251d', ridge: '#243024', track: '#213022', side: '#1a281e', rail: '#b4ca8c', accent: '#c2f5a2', portal: '#ff8652', aura: '#ff853425' },
    { name: '极光回廊', sky: '#0b1922', haze: '#152f3c', ridge: '#1b3a46', track: '#193442', side: '#142b37', rail: '#71becf', accent: '#9ee9ee', portal: '#60dbed', aura: '#38c6ed30' },
    { name: '暮光临界', sky: '#1b1425', haze: '#322137', ridge: '#42293f', track: '#302334', side: '#261d30', rail: '#b798cd', accent: '#e1b6ff', portal: '#ff8a96', aura: '#ff698930' }
  ];
  function poly(c, points, fill, stroke, width) {
    c.beginPath();
    for (let i = 0; i < points.length; i++) i ? c.lineTo(points[i][0], points[i][1]) : c.moveTo(points[i][0], points[i][1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width || 1; c.stroke(); }
  }
  function line(c, x1, y1, x2, y2, color, width) {
    c.strokeStyle = color; c.lineWidth = width || 1;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  class Renderer {
    constructor(canvas, home) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.home = !!home;
      this.w = 390; this.h = 500; this.dpr = 1; this.particles = [];
      this.background = document.createElement('canvas'); this.cacheKey = ''; this.flash = 0;
      this.chapter = 1; this.effects = true; this.ripples = []; this.appearance = null;
    }
    resize() {
      const box = this.canvas.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (this.canvas.width === Math.round(box.width * dpr) && this.canvas.height === Math.round(box.height * dpr)) return;
      this.w = box.width; this.h = box.height; this.dpr = dpr;
      this.canvas.width = Math.round(box.width * dpr); this.canvas.height = Math.round(box.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.cacheKey = '';
    }
    get theme() { return themes[this.chapter - 1] || themes[0]; }
    setAppearance(appearance) { this.appearance = appearance || null; }
    get shipColor() { return this.appearance && this.appearance.skin && this.appearance.skin.id !== 'pulse' ? this.appearance.skin.color : this.theme.accent; }
    shipPoints(x, y, scale, shape) {
      const shapes = {
        pulse: [[0,-22],[16,11],[0,5],[-16,11]],
        spark: [[0,-23],[8,-5],[17,7],[11,10],[0,4],[-11,10],[-17,7],[-8,-5]],
        aurora: [[0,-26],[6,-7],[17,11],[6,7],[0,12],[-6,7],[-17,11],[-6,-7]],
        prism: [[0,-24],[14,-3],[10,12],[0,6],[-10,12],[-14,-3]],
        crown: [[0,-25],[6,-5],[14,-14],[17,12],[0,5],[-17,12],[-14,-14],[-6,-5]],
        kite: [[0,-24],[18,2],[8,12],[0,5],[-8,12],[-18,2]]
      };
      return (shapes[shape] || shapes.pulse).map(point => [x + point[0] * scale, y + point[1] * scale]);
    }
    project(lane, p) {
      const q = Math.max(0, p), scale = .09 + .91 * q;
      const horizon = this.h * (this.home ? .22 : .19), bottom = this.h * (this.home ? 1.04 : .84);
      return { x: this.w / 2 + (lane - 1) * this.w * .265 * scale, y: horizon + (bottom - horizon) * q * q, scale, width: this.w * .265 * scale };
    }
    reset() { this.particles = []; this.flash = 0; this.ripples = []; }
    cacheBackground() {
      const key = [this.w, this.h, this.chapter, this.home, this.effects].join(':');
      if (this.cacheKey === key) return;
      this.cacheKey = key;
      const w = this.w, h = this.h, t = this.theme;
      this.background.width = this.canvas.width; this.background.height = this.canvas.height;
      const c = this.background.getContext('2d'); c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const horizon = h * (this.home ? .22 : .19);
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, t.sky); bg.addColorStop(.6, t.haze); bg.addColorStop(1, t.sky);
      c.fillStyle = bg; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) {
        c.fillStyle = i % 5 === 0 ? t.rail + '99' : t.rail + '44';
        c.fillRect((i * 127.17) % w, (i * 59.3) % (h * .68), i % 9 ? 1 : 2, 1);
      }
      const glow = c.createRadialGradient(w / 2, horizon, 3, w / 2, horizon, w * .5);
      glow.addColorStop(0, t.aura); glow.addColorStop(1, t.portal + '00');
      c.fillStyle = glow; c.fillRect(0, 0, w, h);
      if (this.chapter === 2) {
        for (let k = 0; k < 3; k++) {
          c.beginPath(); c.moveTo(0, horizon * .3 + k * 18);
          c.bezierCurveTo(w * .28, horizon * .6 + k * 8, w * .58, -30 + k * 25, w, horizon * .5 + k * 15);
          c.strokeStyle = t.accent + (k ? '18' : '32'); c.lineWidth = 9 - k * 3; c.stroke();
        }
      }
      const ring = this.home ? Math.min(w * .165, h * .21) : w * .09;
      const cy = this.home ? horizon + ring * .18 : horizon - ring * .1;
      c.save(); c.translate(w / 2, cy);
      c.strokeStyle = t.portal + '50'; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, ring * 1.28, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = t.portal; c.lineWidth = this.home ? 4 : 2;
      if (this.effects) { c.shadowColor = t.portal; c.shadowBlur = 16; }
      c.beginPath(); c.arc(0, 0, ring, -.7, Math.PI * 1.62); c.stroke(); c.shadowBlur = 0;
      c.strokeStyle = t.portal + '70'; c.lineWidth = 1; c.beginPath(); c.arc(0, 0, ring * .8, 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        line(c, Math.cos(a) * ring * 1.2, Math.sin(a) * ring * 1.2, Math.cos(a) * ring * 1.32, Math.sin(a) * ring * 1.32, i % 3 ? t.rail + '55' : t.rail, 1);
      }
      c.restore();
      poly(c, [[0, horizon + 25], [w * .1, horizon - 14], [w * .17, horizon + 8], [w * .27, horizon - 6], [w * .38, horizon + 26]], t.ridge);
      poly(c, [[w, horizon + 25], [w * .94, horizon - 14], [w * .82, horizon + 8], [w * .75, horizon - 8], [w * .6, horizon + 26]], t.ridge);
      if (this.chapter === 2) {
        for (const side of [0, 1]) for (let i = 0; i < 4; i++) {
          const x = side ? w - i * 31 : i * 31;
          poly(c, [[x - 4, horizon + 35], [x + 7, horizon - 35 + i * 9], [x + 20, horizon + 35]], '#245361', t.accent + '30');
        }
      } else if (this.chapter === 3) {
        for (const side of [0, 1]) for (let i = 0; i < 3; i++) {
          const x = side ? w - i * 35 - 8 : i * 35 + 8;
          poly(c, [[x, horizon + 30], [x + 8, horizon - 35 + i * 13], [x + 24, horizon - 4], [x + 14, horizon + 30]], '#4c2e4b', t.portal + '44');
        }
      }
      for (let lane = 0; lane < 3; lane++) this.lane(c, lane, 0, 1.16, lane === 1 ? t.track : t.side);
      for (let edge = -.5; edge < 3; edge++) {
        const a = this.project(edge, 0), b = this.project(edge, 1.16);
        line(c, a.x, a.y, b.x, b.y, t.rail + (edge === -.5 || edge === 2.5 ? '66' : '33'), 1);
      }
    }
    lane(c, lane, from, to, fill, stroke) {
      const a = this.project(lane, from), b = this.project(lane, to);
      poly(c, [[a.x - a.width * .47, a.y], [a.x + a.width * .47, a.y], [b.x + b.width * .47, b.y], [b.x - b.width * .47, b.y]], fill, stroke);
    }
    scene(time, lane, id, lookAhead) {
      this.cacheBackground();
      const c = this.ctx, t = this.theme, w = this.w, h = this.h;
      c.drawImage(this.background, 0, 0, w, h);
      const horizon = h * (this.home ? .22 : .19), ring = this.home ? Math.min(w * .165, h * .21) : w * .09;
      c.fillStyle = t.rail; c.font = (this.home ? '11' : '9') + 'px Bahnschrift, monospace'; c.textAlign = 'center';
      c.fillText(this.home ? '15' : (id < 10 ? '0' + id : String(id)), w / 2, (this.home ? horizon + ring * .18 : horizon - ring * .1) + 4);
      if (!this.home) {
        this.lane(c, lane, .38, 1.14, t.accent + '08');
        const from = 1 - .57 / lookAhead, to = 1 - .27 / lookAhead;
        for (let track = 0; track < 3; track++) this.lane(c, track, from, to, '#edc67508');
        const a = this.project(-.5, (from + to) / 2), b = this.project(2.5, (from + to) / 2);
        c.setLineDash([3, 9]); line(c, a.x, a.y, b.x, b.y, '#eac97f45'); c.setLineDash([]);
        c.fillStyle = '#cdbb86'; c.font = '9px "Segoe UI","Microsoft YaHei",sans-serif'; c.textAlign = 'left'; c.fillText('起跳区', 12, a.y - 7);
      }
      const scroll = (time * .36) % .13;
      for (let p = scroll; p < 1.15; p += .13) {
        const a = this.project(-.5, p), b = this.project(2.5, p);
        line(c, a.x, a.y, b.x, b.y, t.rail + '16');
        for (const track of [-.57, 2.57]) {
          const f = this.project(track, p), end = this.project(track, p + .026);
          line(c, f.x, f.y, end.x, end.y, t.rail + '88', 2 * f.scale);
        }
      }
      if (!this.home) {
        const a = this.project(-.5, 1), b = this.project(2.5, 1);
        line(c, a.x, a.y, b.x, b.y, t.accent + '90', 1.5);
        c.fillStyle = t.accent + 'b0'; c.font = '9px "Segoe UI","Microsoft YaHei",sans-serif'; c.textAlign = 'left'; c.fillText('判定线', 12, a.y + 16);
      }
    }
    obstacle(lane, p, type, danger, moving) {
      const c = this.ctx, pos = this.project(lane, p), x = pos.x, y = pos.y, s = pos.scale, bw = pos.width * .70;
      if (type === 'gap') {
        const far = this.project(lane, p - .055), near = this.project(lane, p + .038);
        poly(c, [[far.x - far.width * .46, far.y], [far.x + far.width * .46, far.y], [near.x + near.width * .46, near.y], [near.x - near.width * .46, near.y]], '#010607', '#c9eaa1', 1.4 * s);
        line(c, near.x - near.width * .45, near.y, near.x + near.width * .45, near.y, '#dbf4ac', 3 * s);
        for (let i = 0; i < 5; i++) {
          const px = far.x - far.width * .36 + i * far.width * .17;
          line(c, px, far.y - 3 * s, px + 5 * s, far.y - 7 * s, '#c9eaa199', 2 * s);
        }
        if (p > .55) { c.fillStyle = '#d6eabb'; c.font = Math.max(7, 10 * s) + 'px sans-serif'; c.textAlign = 'center'; c.fillText('↑', x, (near.y + far.y) / 2 + 3 * s); }
        return;
      }
      const height = (type === 'wall' ? 72 : 23) * s, depth = 12 * s;
      const main = moving ? '#49648b' : type === 'wall' ? '#bd5439' : '#c49748', light = moving ? '#a0d5ff' : type === 'wall' ? '#fa885f' : '#f3d087';
      poly(c, [[x - bw / 2, y], [x + bw / 2, y], [x + bw / 2, y - height], [x - bw / 2, y - height]], main, danger ? '#fff0bd' : light, danger ? 2 * s : Math.max(.8, s));
      poly(c, [[x - bw / 2, y - height], [x - bw / 2 + depth, y - height - depth], [x + bw / 2 + depth, y - height - depth], [x + bw / 2, y - height]], light);
      poly(c, [[x + bw / 2, y], [x + bw / 2 + depth, y - depth], [x + bw / 2 + depth, y - height - depth], [x + bw / 2, y - height]], moving ? '#263b60' : type === 'wall' ? '#703828' : '#77633b');
      if (type === 'wall') {
        line(c, x - bw * .33, y - height * .24, x + bw * .33, y - height * .77, '#eea68188', 2 * s);
        line(c, x - bw * .33, y - height * .77, x + bw * .33, y - height * .24, '#eea68188', 2 * s);
        c.fillStyle = '#ffd8a4'; c.fillRect(x - bw * .34, y - height + 5 * s, bw * .17, 2 * s);
      } else for (let i = 0; i < 4; i++) { const ax = x - bw * .42 + i * bw * .24; line(c, ax, y - 5 * s, ax + 7 * s, y - height + 5 * s, '#523f24', 3 * s); }
    }
    movingGuide(row, p, state) {
      const c = this.ctx, motion = row.motion, from = this.project(motion.from, p), to = this.project(motion.to, p), s = to.scale;
      const height = 72 * s, bw = to.width * .70, y = to.y - height - 18 * s, direction = motion.to > motion.from ? 1 : -1;
      c.save(); c.setLineDash([4 * s, 4 * s]);
      poly(c, [[to.x - bw / 2, to.y], [to.x + bw / 2, to.y], [to.x + bw / 2, to.y - height], [to.x - bw / 2, to.y - height]], '#9bd9ff0c', '#9bd9ff99', Math.max(.8, s));
      line(c, from.x, y, to.x, y, '#b6e0ff', Math.max(1, 1.5 * s)); c.setLineDash([]);
      poly(c, [[to.x, y], [to.x - direction * 8 * s, y - 4 * s], [to.x - direction * 8 * s, y + 4 * s]], '#b6e0ff');
      if (p > .55) { c.fillStyle = '#b6e0ff'; c.font = Math.max(8, 10 * s) + 'px "Microsoft YaHei",sans-serif'; c.textAlign = 'center'; c.fillText('落点', to.x, y - 6 * s); }
      c.restore();
      this.obstacle(state.movingLane, p, 'wall', false, true);
    }
    gate(row, p, state, danger) {
      const c = this.ctx, pos = this.project(row.gate.lane, p), s = pos.scale, x = pos.x, y = pos.y;
      const bw = pos.width * .82, height = 81 * s, closed = state.gateClosed, color = closed ? '#ff946b' : '#8febc5';
      c.save();
      if (closed) {
        poly(c, [[x - bw * .43, y], [x + bw * .43, y], [x + bw * .43, y - height * .87], [x - bw * .43, y - height * .87]], '#873e32d9', danger ? '#ffecb8' : color, Math.max(1, 1.4 * s));
        for (let k = 1; k <= 4; k++) line(c, x - bw * .42, y - height * k * .17, x + bw * .42, y - height * k * .17, color, Math.max(1, 2.5 * s));
      } else {
        this.lane(c, row.gate.lane, p - .035, p + .03, '#8febc51b');
        const markY = y - 19 * s;
        line(c, x - 9 * s, markY + 5 * s, x, markY - 4 * s, color, Math.max(1, 2 * s));
        line(c, x, markY - 4 * s, x + 9 * s, markY + 5 * s, color, Math.max(1, 2 * s));
      }
      line(c, x - bw / 2, y, x - bw / 2, y - height, color, Math.max(1, 4 * s));
      line(c, x + bw / 2, y, x + bw / 2, y - height, color, Math.max(1, 4 * s));
      line(c, x - bw / 2, y - height, x + bw / 2, y - height, color, Math.max(1, 4 * s));
      c.fillStyle = state.gateLocked ? '#e2f6dc' : '#f4ca7c';
      for (let k = -1; k <= 1; k++) c.fillRect(x + k * 8 * s - 2 * s, y - height - 7 * s, 4 * s, 3 * s);
      if (p > .55) {
        c.fillStyle = color; c.font = Math.max(8, 10 * s) + 'px "Microsoft YaHei",sans-serif'; c.textAlign = 'center';
        c.fillText((closed ? '关闭' : '开放') + (state.gateLocked ? ' · 已锁定' : ' · 变化中'), x, y - height - 13 * s);
      }
      c.restore();
    }
    gem(lane, p, time, bonus) {
      const c = this.ctx, pos = this.project(lane, p), r = (bonus ? 9 : 6.5) * pos.scale;
      const y = pos.y - (bonus ? 40 : 25) * pos.scale + (this.effects ? Math.sin(time * 4) * 2 : 0);
      c.save(); if (this.effects) { c.shadowColor = bonus ? '#ffc86b' : this.theme.accent; c.shadowBlur = 9 * pos.scale; }
      poly(c, [[pos.x, y - r], [pos.x + r * .68, y], [pos.x, y + r], [pos.x - r * .68, y]], bonus ? '#ffc86b' : '#d1ffb0', bonus ? '#fff0c9' : '#f0ffda');
      if (bonus) {
        poly(c, [[pos.x, y - r * .57], [pos.x + r * .34, y], [pos.x, y + r * .57], [pos.x - r * .34, y]], '#8d5427');
        if (p > .52) { c.shadowBlur = 0; c.fillStyle = '#ffe0a0'; c.font = 'bold ' + Math.max(8, 10 * pos.scale) + 'px Bahnschrift,monospace'; c.textAlign = 'center'; c.fillText('+200', pos.x, y - r - 5 * pos.scale); }
      }
      c.restore();
    }
    playerTrail(x, y, scale, time) {
      const c = this.ctx, item = this.appearance && this.appearance.trail, style = item ? item.style : 'classic';
      const color = !item || item.id === 'classic' ? this.shipColor : item.color;
      const trail = c.createLinearGradient(0, y + 12, 0, y + 72);
      trail.addColorStop(0, color + '99'); trail.addColorStop(1, color + '00');
      if (style === 'twin') {
        for (const side of [-1, 1]) poly(c, [[x + side * 9 * scale - 2 * scale,y + 9],[x + side * 9 * scale + 2 * scale,y + 9],[x + side * 12 * scale,y + 63 + Math.sin(time * 14) * 3]], trail);
      } else if (style === 'dots') {
        for (let i = 0; i < 6; i++) {
          const distance = (i * 10 + time * 25) % 60;
          c.globalAlpha = Math.max(0, .85 - distance / 70); c.fillStyle = color;
          c.beginPath(); c.arc(x + Math.sin(i * 2.4) * 4 * scale, y + 14 + distance, (2.5 - distance / 40) * scale, 0, Math.PI * 2); c.fill();
        }
        c.globalAlpha = 1;
      } else if (style === 'comet') {
        poly(c, [[x - 11 * scale,y + 8],[x + 11 * scale,y + 8],[x,y + 76 + Math.sin(time * 18) * 4]], trail);
        line(c,x,y + 12,x,y + 49,color + 'bb',2 * scale);
      } else if (style === 'ribbon') {
        c.strokeStyle = trail; c.lineWidth = 5 * scale; c.beginPath(); c.moveTo(x,y + 9);
        c.bezierCurveTo(x + Math.sin(time * 6) * 18 * scale,y + 29,x - Math.sin(time * 6) * 18 * scale,y + 45,x,y + 67); c.stroke();
      } else if (style === 'echo') {
        for (let i = 0; i < 4; i++) {
          const distance = (i * 15 + time * 25) % 60;
          c.globalAlpha = .7 * (1 - distance / 60); c.strokeStyle = color; c.lineWidth = 1.3 * scale;
          c.beginPath(); c.ellipse(x,y + 14 + distance,(6 + distance * .09) * scale,3 * scale,0,0,Math.PI * 2); c.stroke();
        }
        c.globalAlpha = 1;
      } else {
        // The original appearance keeps the exact original beam dimensions.
        const classic = c.createLinearGradient(0,y + 12,0,y + 60); classic.addColorStop(0,color + '99'); classic.addColorStop(1,color + '00');
        poly(c, [[x - 8 * scale,y + 7],[x + 8 * scale,y + 7],[x + 3 * scale,y + 50 + Math.sin(time * 24) * 8],[x - 3 * scale,y + 50 + Math.sin(time * 24) * 8]], classic);
      }
    }
    player(lane, jump, time, crashed, bank) {
      const c = this.ctx, pos = this.project(lane, this.home ? .87 : 1), s = this.home ? .82 : 1, y = pos.y - jump * 66 - 10;
      const skin = this.appearance && this.appearance.skin, color = this.shipColor;
      c.save(); c.fillStyle = '#01060388'; c.beginPath(); c.ellipse(pos.x, pos.y + 3, 18 * s, 6 * s, 0, 0, Math.PI * 2); c.fill();
      if (!crashed && this.effects) this.playerTrail(pos.x,y,s,time);
      if (this.effects) { c.shadowColor = crashed ? '#ff6d4a' : color; c.shadowBlur = 15; }
      if (bank && this.effects) { c.translate(pos.x,y); c.rotate(bank); c.translate(-pos.x,-y); }
      poly(c,this.shipPoints(pos.x,y,s,skin && skin.shape),crashed ? '#ff9162' : color,'#efffdf',1.2);
      c.shadowBlur = 0;
      poly(c, [[pos.x, y - 14 * s], [pos.x + 5 * s, y + 4 * s], [pos.x - 5 * s, y + 4 * s]], this.theme.ridge);
      if (jump > 0) { c.strokeStyle = color + '77'; c.lineWidth = 1; c.beginPath(); c.ellipse(pos.x, pos.y, 20 + jump * 8, 7, 0, 0, Math.PI * 2); c.stroke(); }
      c.restore();
    }
    ghost(state, playerLane) {
      const transition = Math.min(1, Math.max(0, (state.time - state.movedAt) / .09));
      const lane = state.previousLane + (state.lane - state.previousLane) * (1 - Math.pow(1 - transition,3));
      const pos = this.project(lane,1), c = this.ctx;
      const offset = Math.abs(lane - playerLane) < .32 ? (lane > 1.5 ? -22 : 22) : 0;
      const x = pos.x + offset, y = pos.y - Math.max(0,Math.min(1,state.jumpHeight)) * 66 - 10;
      c.save(); c.globalAlpha = .72; c.setLineDash([3,2]);
      poly(c,this.shipPoints(x,y,1,'pulse'),'#a7d7ff0c','#b3c9ff',1.5); c.setLineDash([]);
      c.fillStyle = '#cedbff'; c.font = '9px "Microsoft YaHei",sans-serif'; c.textAlign = 'center';
      c.fillText('最佳影子',x,y - 33); c.restore();
    }
    emit(kind, lane) {
      if (!this.effects) return;
      const crash = kind === 'crash'; this.flash = crash ? 1 : kind === 'win' ? .65 : 0;
      this.flashColor = crash ? '255,100,60' : '195,245,162';
      if (kind === 'land' || kind === 'jump' || crash || kind === 'win') this.ripples.push({x:this.w/2+(lane-1)*this.w*.265,y:this.h*.84,life:.45,crash});
      const count = crash ? 25 : kind === 'win' ? 42 : kind === 'land' ? 4 : kind === 'jump' ? 3 : 7;
      for (let i = 0; i < count; i++) this.particles.push({ x: this.w / 2 + (lane - 1) * this.w * .265, y: this.h * .84 - 16, vx: (Math.random() - .5) * (crash ? 230 : 150), vy: -Math.random() * 180, life: .45 + Math.random() * .5, color: crash ? '#ff9162' : this.theme.accent });
      if (this.particles.length > 90) this.particles.splice(0, this.particles.length - 90);
    }
    drawHome(time, chapter, effects) {
      this.chapter = chapter; this.effects = effects;
      const t = effects ? time : 0;
      this.scene(t * .3, 1, 15, 2.8);
      this.obstacle(0, .5, 'wall'); this.obstacle(2, .66, 'wall'); this.obstacle(0, .84, 'hurdle');
      for (const p of [.40, .54, .68]) this.gem(1, p, t);
      this.player(1, .08 + (effects ? Math.sin(t * 2) * .035 : 0), t, false);
      const fade = this.ctx.createLinearGradient(0, this.h - 38, 0, this.h);
      fade.addColorStop(0, this.theme.sky + '00'); fade.addColorStop(1, this.theme.sky);
      this.ctx.fillStyle = fade; this.ctx.fillRect(0, this.h - 38, this.w, 38);
    }
    drawPreview(time, appearance, effects) {
      this.setAppearance(appearance); this.effects = !!effects;
      const c = this.ctx, t = this.effects ? time : 0, w = this.w, h = this.h;
      const background = c.createRadialGradient(w / 2,h * .45,4,w / 2,h * .45,Math.max(w,h) * .65);
      background.addColorStop(0,'#24302c'); background.addColorStop(1,'#101615');
      c.fillStyle = background; c.fillRect(0,0,w,h);
      for (const side of [-1,1]) line(c,w / 2 + side * 55,0,w / 2 + side * 55,h,'#b4ca8c18');
      const pos = this.project(1,this.home ? .87 : 1);
      c.save(); c.translate(0,h * .39 - pos.y + 10);
      this.player(1,0,t,false); c.restore();
    }
    draw(run, dt, phase, effects, ghostState) {
      this.chapter = run.level.chapter; this.effects = effects;
      if (phase === 'replay') this.reset();
      this.ctx.fillStyle = this.theme.sky; this.ctx.fillRect(0,0,this.w,this.h);
      this.ctx.save();
      if (effects && this.flashColor === '255,100,60' && this.flash > .45) this.ctx.translate(Math.sin(this.flash*61)*this.flash*4,Math.cos(this.flash*49)*this.flash*3);
      this.scene(run.time, run.lane, run.level.endless ? '∞' : run.level.id, run.level.lookAhead);
      const rows = run.level.rows;
      let last = run.nextRow;
      while (last < rows.length && rows[last].t - run.time < run.level.lookAhead) last++;
      const first = Math.max(run.practiceStartRow || 0, run.nextRow - 1);
      for (let i = last - 1; i >= first; i--) {
        const row = rows[i], until = row.t - run.time;
        if (until < -.18) continue;
        const p = 1 - until / run.level.lookAhead;
        const state = row.motion || row.gate ? root.PulseEngine.rowState(row, run.time) : { type: row.type };
        for (let lane = 0; lane < 3; lane++) {
          if (row.gate && lane === row.gate.lane) continue;
          if (row.motion && lane === Math.round(state.movingLane)) continue;
          if (state.type[lane]) this.obstacle(lane, p, state.type[lane], lane === run.lane && until < .55);
        }
        if (row.motion) this.movingGuide(row, p, state);
        if (row.gate) this.gate(row, p, state, row.gate.lane === run.lane && until < .55);
        if (row.gem >= 0 && i >= run.nextRow && state.type[row.gem] !== 'wall') this.gem(row.gem, p, run.time);
        if (row.bonusGem >= 0 && i >= run.nextRow && state.type[row.bonusGem] !== 'wall') this.gem(row.bonusGem, p, run.time, true);
      }
      const transition = Math.min(1, Math.max(0, (run.time - run.movedAt) / .09));
      const lane = run.previousLane + (run.lane - run.previousLane) * (1 - Math.pow(1 - transition, 3));
      if (ghostState) this.ghost(ghostState,lane);
      this.player(lane, run.jumpHeight(), run.time, run.status === 'failed', (run.lane-run.previousLane)*Math.sin(transition*Math.PI)*.2);
      const c = this.ctx;
      if (phase !== 'replay' && !run.level.endless && run.level.duration - run.time < 2.5 && run.status !== 'failed') {
        c.fillStyle = this.theme.accent; c.font = '12px Bahnschrift,monospace'; c.textAlign = 'center'; c.fillText('FINISH // KEEP GOING', this.w / 2, this.h * .35);
      }
      if (effects) {
        const animate = phase !== 'paused' && phase !== 'result' && phase !== 'countdown';
        for (let i = this.particles.length - 1; i >= 0; i--) {
          const p = this.particles[i];
          if (animate) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 280 * dt; p.life -= dt; }
          if (p.life <= 0) { this.particles.splice(i, 1); continue; }
          c.globalAlpha = Math.min(1, p.life * 2); c.fillStyle = p.color; c.fillRect(p.x, p.y, 3, 3);
        }
        c.globalAlpha = 1;
        for(let i=this.ripples.length-1;i>=0;i--) {
          const ring=this.ripples[i]; if(animate)ring.life-=dt;
          if(ring.life<=0){this.ripples.splice(i,1);continue;}
          const r=14+(1-ring.life/.45)*48;
          c.globalAlpha=ring.life/.45*.7;c.strokeStyle=ring.crash?'#ff9e75':this.theme.accent;c.lineWidth=1.5;
          c.beginPath();c.ellipse(ring.x,ring.y,r,r*.3,0,0,Math.PI*2);c.stroke();
        }
        c.globalAlpha=1;
        if (this.flash > 0) { c.fillStyle = 'rgba(' + this.flashColor + ',' + this.flash * .16 + ')'; c.fillRect(0, 0, this.w, this.h); if (animate) this.flash = Math.max(0, this.flash - dt * 3); }
      } else this.reset();
      c.restore();
    }
  }
  root.PulseRenderer = Renderer;
  root.PulseThemes = themes;
})(window);
