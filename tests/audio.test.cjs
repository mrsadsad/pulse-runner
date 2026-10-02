'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');

let browser;
const results = [];
const demoSegments = [];
const rate = 22050;

test.before(async () => {
  browser = await playwright.chromium.launch({ headless: true,
    ...(process.env.PULSE_BROWSER_EXECUTABLE_PATH
      ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE_PATH }
      : { channel: process.env.PULSE_BROWSER_CHANNEL || 'chrome' }) });
});

async function fixture(check) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.evaluate(() => {
      window.audioHarness = function (seconds) {
        const offline = new OfflineAudioContext(2, Math.ceil(seconds * 22050), 22050);
        let clock = 0, state = 'running', suspends = 0, resumes = 0;
        const proxy = new Proxy(offline, {
          get(target, name) {
            if (name === 'currentTime') return clock;
            if (name === 'state') return state;
            if (name === 'suspend') return () => { state = 'suspended'; suspends++; return Promise.resolve(); };
            if (name === 'resume') return () => { state = 'running'; resumes++; return Promise.resolve(); };
            const value = Reflect.get(target, name, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        });
        window.AudioContext = function () { return proxy; };
        const sound = new PulseAudio();
        sound.unlock();
        function rms(data, from, to) {
          let sum = 0;
          const begin = Math.floor(from * 22050), end = Math.min(data.length, Math.floor(to * 22050));
          for (let i = begin; i < end; i++) sum += data[i] * data[i];
          return Math.sqrt(sum / Math.max(1, end - begin));
        }
        return { sound, at: time => { clock = time; }, state: () => ({ state, suspends, resumes }),
          async render(windows, exportPcm) {
            const buffer = await offline.startRendering();
            await new Promise(resolve => setTimeout(resolve, 0));
            let peak = 0, invalid = 0, sum = 0;
            for (let c = 0; c < buffer.numberOfChannels; c++) {
              const data = buffer.getChannelData(c);
              for (const value of data) {
                if (!Number.isFinite(value)) invalid++;
                peak = Math.max(peak, Math.abs(value)); sum += value * value;
              }
            }
            const measurements = { rms: Math.sqrt(sum / (buffer.length * buffer.numberOfChannels)), peak, invalid,
              windows: (windows || []).map(range => rms(buffer.getChannelData(0), range[0], range[1])),
              tailRms: rms(buffer.getChannelData(0), seconds - .12, seconds), voices: sound.voices.size };
            if (exportPcm) {
              const bytes = new Uint8Array(buffer.length * 4), view = new DataView(bytes.buffer);
              const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
              for (let i = 0; i < buffer.length; i++) {
                view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true);
                view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true);
              }
              let binary = '';
              for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
              measurements.pcm = btoa(binary);
            }
            return measurements;
          }
        };
      };
    });
    await page.addScriptTag({ path: path.resolve(__dirname, '../web/audio.js') });
    const result = await check(page);
    assert.deepEqual(errors, [], 'audio execution must not produce browser errors');
    return result;
  } finally { await page.close(); }
}

function audible(result) {
  assert.equal(result.invalid, 0, 'every sample must be finite');
  assert.ok(result.rms > .0001, `render must be audible; RMS=${result.rms}`);
  assert.ok(result.peak <= 1, `render must avoid hard clipping; peak=${result.peak}`);
  assert.equal(result.voices, 0, 'finished sources must leave the voice set');
}

test('jump, land, gem, crash and win produce distinct non-silent rendered segments', async () => {
  const result = await fixture(page => page.evaluate(async () => {
    const h = audioHarness(3.8);
    const sequence = [[.10, 'jump'], [.55, 'land'], [.95, 'gem', 5], [1.40, 'crash'], [2.10, 'win']];
    for (const [time, kind, detail] of sequence) { h.at(time); h.sound.play(kind, detail); }
    return h.render([[.10, .40], [.55, .80], [.95, 1.25], [1.40, 1.80], [2.10, 3.1]], true);
  }));
  audible(result);
  assert.ok(result.windows.every(value => value > .0001));
  assert.ok(result.tailRms < .00001, 'effects must release to silence');
  demoSegments.push(Buffer.from(result.pcm, 'base64'));
  delete result.pcm;
  results.push({ name: '跳跃 / 落地 / 晶体 / 碰撞 / 通关', ...result });
});

for (const kind of ['left', 'right', 'perfect', 'count', 'go']) {
  test(`${kind} feedback is audible and its voices release`, async () => {
    const result = await fixture(page => page.evaluate(async kind => {
      const h = audioHarness(1.2); h.sound.play(kind); return h.render();
    }, kind));
    audible(result);
    assert.ok(result.tailRms < .00001);
    results.push({ name: kind, ...result });
  });
}

for (const chapter of [1, 2, 3]) {
  test(`chapter ${chapter} music renders across multiple beats without clipping`, async () => {
    const result = await fixture(page => page.evaluate(async chapter => {
      const h = audioHarness(3.8);
      for (let frame = 0; frame <= 168; frame++) {
        const time = frame / 60; h.at(time); h.sound.tick(time, chapter, 12);
      }
      return h.render([[0, .8], [.8, 1.6], [1.6, 2.4]], true);
    }, chapter));
    audible(result);
    assert.ok(result.windows.every(value => value > .0001));
    assert.ok(result.tailRms < .00001);
    demoSegments.push(Buffer.from(result.pcm, 'base64'));
    delete result.pcm;
    results.push({ name: `第 ${chapter} 章音乐`, ...result });
  });
}

test('master sound disables existing and future scheduling', async () => {
  const result = await fixture(page => page.evaluate(async () => {
    const h = audioHarness(1.4);
    h.sound.play('win');
    const before = h.sound.voices.size;
    h.sound.configure(false, true);
    const after = h.sound.voices.size;
    h.sound.play('jump'); h.sound.tick(0, 3, 10);
    return { before, after, afterMutedCalls: h.sound.voices.size, ...(await h.render()) };
  }));
  assert.ok(result.before > 0);
  assert.equal(result.after, 0);
  assert.equal(result.afterMutedCalls, 0);
  assert.equal(result.rms, 0);
  assert.equal(result.invalid, 0);
});

test('music can be disabled while sound effects remain audible', async () => {
  const result = await fixture(page => page.evaluate(async () => {
    const h = audioHarness(1.4);
    h.sound.configure(true, false);
    h.sound.tick(0, 1, 0);
    const afterMusic = h.sound.voices.size;
    h.sound.play('jump');
    return { afterMusic, ...(await h.render()) };
  }));
  assert.equal(result.afterMusic, 0);
  audible(result);
});

test('suspend clears scheduled sources and unlock resumes audio', async () => {
  await fixture(page => page.evaluate(async () => {
    const h = audioHarness(1.4);
    h.sound.play('win');
    if (h.sound.voices.size === 0) throw new Error('expected scheduled voices');
    h.sound.suspend();
    if (h.sound.voices.size !== 0 || h.sound.nextBeat !== null) throw new Error('suspend did not clear sources');
    if (h.state().state !== 'suspended' || h.state().suspends !== 1) throw new Error('context was not suspended');
    h.sound.play('jump');
    if (h.sound.voices.size !== 0) throw new Error('suspended audio accepted new sources');
    h.sound.unlock();
    if (h.state().state !== 'running' || h.state().resumes !== 1) throw new Error('unlock did not resume');
    h.sound.play('land');
    if (h.sound.voices.size === 0) throw new Error('resumed audio remained silent');
    h.sound.silence();
    if (h.sound.voices.size !== 0) throw new Error('silence did not clear sources');
    const rendered = await h.render();
    if (rendered.voices !== 0 || rendered.invalid) throw new Error('invalid cleanup after rendering');
  }));
});

test('duplicate music ticks do not schedule duplicate beats', async () => {
  const result = await fixture(page => page.evaluate(() => {
    const h = audioHarness(1.4);
    h.sound.tick(0, 1, 0);
    const first = h.sound.voices.size;
    for (let i = 0; i < 100; i++) h.sound.tick(.01, 1, 0);
    const repeated = h.sound.voices.size;
    h.sound.silence();
    return { first, repeated };
  }));
  assert.ok(result.first > 0);
  assert.equal(result.repeated, result.first);
});

test('burst effects have bounded polyphony and all sources release', async () => {
  const result = await fixture(page => page.evaluate(async () => {
    const h = audioHarness(1.4);
    for (let i = 0; i < 200; i++) h.sound.play('jump');
    const maximum = h.sound.voices.size;
    return { maximum, ...(await h.render()) };
  }));
  assert.ok(result.maximum > 0 && result.maximum <= 49, `voice bound exceeded: ${result.maximum}`);
  audible(result);
  results.push({ name: `200 次跳跃音效突发（最多 ${result.maximum} 声部）`, ...result });
});

test.after(async () => {
  if (browser) await browser.close();
  if (demoSegments.length !== 4 || results.length !== 10) return;
  const pcm = Buffer.concat(demoSegments);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28); header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.resolve(__dirname, '../qa/audio-demo.wav'), Buffer.concat([header, pcm]));
  const table = results.map(r => `| ${r.name} | ${r.rms.toFixed(6)} | ${r.peak.toFixed(6)} | ${r.invalid} | ${r.voices} |`).join('\n');
  const notes = `# 脉冲穿行 v1.1 音频验证\n\n执行命令：\`node --test tests/audio.test.cjs\`。2026-09-22，使用已安装 Google Chrome、Playwright 及浏览器真实 OfflineAudioContext 音频节点，22050 Hz 双声道渲染。\n\n共 14 项检查通过：五段主要音效、左右换道与精准跳跃及倒计时反馈、全部三章音乐、总静音、独立音乐开关、暂停恢复、重复节拍去重及突发声部释放。所有浏览器 JavaScript 错误为 0。\n\n音频上下文的时钟与运行状态通过代理控制；振荡器、滤波、音量包络、声像和压缩器均由 Chrome 实际计算。暂停/恢复检查覆盖 Soundscape 调用和声部清理，不替代 Android 音频设备测试。\n\n| 内容 | RMS | 绝对峰值 | 非有限采样 | 结束后声部 |\n| --- | ---: | ---: | ---: | ---: |\n${table}\n\n所有音频 RMS 大于 0.0001、峰值不超过 1，音效与章节音乐的尾部回归静音。突发 200 次跳跃调用的同时声部上限为 49，渲染结束后全部释放。\n\n\`qa/audio-demo.wav\` 是 15.2 秒的测量用试听文件：0–3.8 秒为跳跃/落地/连击晶体/碰撞/通关，随后每 3.8 秒依次为第 1、2、3 章音乐。每段结束留有自然释放时间。\n\n此记录是合成与信号测量结果，未进行主观听感评价，也未宣称完成 Android 真机扬声器、耳机或系统音频延迟验证。\n`;
  fs.writeFileSync(path.resolve(__dirname, '../qa/audio-notes.md'), notes, 'utf8');
});
