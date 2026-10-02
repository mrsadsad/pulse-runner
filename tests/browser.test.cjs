'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');
const { chromium } = playwright;
const levels = require('../web/levels.js');
const challenges = require('../web/challenges.js');
const entry = pathToFileURL(path.resolve(__dirname, '../web/index.html')).href;
const saveKey = 'pulse-runner-save-v1';
let browser;

test.before(async () => {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PULSE_BROWSER_EXECUTABLE_PATH
      ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE_PATH }
      : { channel: process.env.PULSE_BROWSER_CHANNEL || 'chrome' }),
  });
});
test.after(async () => { if (browser) await browser.close(); });

async function fixture(seed, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (seed) await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: saveKey, value: seed });
  const initialTime = new Date('2026-09-22T00:00:00.000Z');
  await page.clock.install({ time: initialTime });
  await page.clock.pauseAt(new Date(initialTime.valueOf() + 1000));
  await page.goto(entry);
  await page.clock.runFor(32);
  return { page, context, errors };
}
async function runCheck(check, seed, viewport) {
  const f = await fixture(seed, viewport);
  try {
    await check(f.page);
    assert.deepEqual(f.errors, [], 'browser must not throw JavaScript errors');
  } finally { await f.context.close(); }
}
async function snapshot(page) { return page.evaluate(() => window.PulseGame.snapshot()); }
async function fullSave(page) {
  return page.evaluate(key => window.PulseEngine.cleanSave(JSON.parse(localStorage.getItem(key) || 'null')), saveKey);
}
function seedCampaign(completedCount = 5) {
  const seed = { version: 1, unlocked: Math.min(15, completedCount + 1), sound: false, music: false, vibration: false, effects: true, attempts: completedCount, records: {} };
  for (let id = 1; id <= completedCount; id++) seed.records[id] = { stars: 3, gems: levels[id - 1].rows.length, progress: 1, attempts: 1, bestScore: 5000, bestCombo: levels[id - 1].rows.length };
  return seed;
}
async function savedProgress(page) {
  return page.evaluate(key => {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    const save = window.PulseEngine.cleanSave(raw);
    return { unlocked: save.unlocked, attempts: save.attempts, records: save.records };
  }, saveKey);
}
async function tap(page, selector) {
  const locator = page.locator(selector);
  assert.equal(await locator.count(), 1, `expected one tap target: ${selector}`);
  let box = await locator.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `tap target not visible: ${selector}`);
  const reachable = await locator.evaluate(element => {
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === element || element.contains(hit);
  });
  if (!reachable) {
    await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    box = await locator.boundingBox();
  }
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
async function begin(page) {
  await tap(page, '#home [data-do="continue"]');
  assert.equal((await snapshot(page)).modal, 'prepare');
  await tap(page, '#modal [data-do="start"]');
  assert.equal((await snapshot(page)).phase, 'countdown');
  await page.clock.runFor(2200);
  assert.equal((await snapshot(page)).phase, 'running');
}
async function awaitRunning(page) {
  for (let frame = 0; frame < 100; frame++) {
    if ((await snapshot(page)).phase === 'running') return;
    await page.clock.runFor(32);
  }
  assert.fail('countdown did not finish within 3.2 seconds');
}
function sectionSolution(spec, firstRow) {
  const instructions = [];
  let lane = 1;
  const at = value => Math.round(value * 1000) / 1000;
  for (const row of spec.rows.slice(firstRow)) {
    const target = row.gem;
    const distance = Math.abs(target - lane);
    const direction = target < lane ? 'left' : 'right';
    if (distance >= 1) instructions.push({ t: at(row.t - .45), action: direction });
    if (distance === 2) instructions.push({ t: at(row.t - .30), action: direction });
    if (['hurdle', 'gap'].includes(row.type[target])) instructions.push({ t: at(row.t - .41), action: 'jump' });
    lane = target;
  }
  return instructions.sort((a, b) => a.t - b.t);
}
async function swipe(page, dx, dy = 0) {
  const box = await page.locator('#gameCanvas').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}
async function solve(page, spec, instructions = spec.solution, expectedGems = spec.rows.length) {
  for (const instruction of instructions) {
    let state = await snapshot(page);
    assert.equal(state.phase, 'running', `level ${spec.id} stopped before input at ${instruction.t} s: ${JSON.stringify(state)}`);
    if (state.time < instruction.t) await page.clock.runFor(Math.ceil((instruction.t - state.time) * 1000));
    state = await snapshot(page);
    // rAF fires on frame boundaries: permit one extra frame to reach the input time.
    if (state.time < instruction.t - 1e-7) await page.clock.runFor(16);
    await tap(page, `[data-action="${instruction.action}"]`);
  }
  const state = await snapshot(page);
  await page.clock.runFor(Math.ceil((spec.duration - state.time) * 1000) + 1100);
  const result = await snapshot(page);
  assert.equal(result.phase, 'result', `level ${spec.id} did not show results: ${JSON.stringify(result)}`);
  assert.equal(result.status, 'won');
  assert.equal(result.gems, expectedGems);
  return result;
}

test('mobile level picker blocks 14 locked levels and help returns to preparation', async () => runCheck(async page => {
  assert.equal((await snapshot(page)).unlocked, 1);
  await tap(page, '#home [data-do="levels"]');
  assert.equal(await page.locator('.level-card').count(), 15);
  assert.equal(await page.locator('.level-card[aria-disabled="true"]').count(), 14);
  await tap(page, '[data-level="2"]');
  assert.equal((await snapshot(page)).modal, '');
  assert.match(await page.locator('#toast').textContent(), /先完成第 1 关/);
  await tap(page, '[data-level="1"]');
  await tap(page, '#modal [data-do="help"]');
  assert.equal((await snapshot(page)).modal, 'help');
  assert.match(await page.locator('#modal').textContent(), /高墙不能跳过/);
  await tap(page, '#modal [data-do="helpDone"]');
  assert.equal((await snapshot(page)).modal, 'prepare');
  await page.keyboard.press('Escape');
  assert.equal((await snapshot(page)).modal, '');
  assert.equal((await snapshot(page)).screen, 'levels');
}));

test('sound, music, vibration and effects switches persist after reload', async () => runCheck(async page => {
  await tap(page, '#home [data-do="settings"]');
  assert.equal(await page.locator('[data-do="sound"]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-do="vibration"]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-do="effects"]').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-do="music"]').getAttribute('aria-checked'), 'true');
  await tap(page, '#modal [data-do="sound"]');
  await tap(page, '#modal [data-do="vibration"]');
  await tap(page, '#modal [data-do="effects"]');
  await tap(page, '#modal [data-do="music"]');
  assert.equal(await page.locator('[data-do="sound"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-do="vibration"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-do="effects"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-do="music"]').getAttribute('aria-checked'), 'false');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(saved.sound, false);
  assert.equal(saved.vibration, false);
  assert.equal(saved.effects, false);
  assert.equal(saved.music, false);
  await tap(page, '#modal .primary-button');
  await page.reload();
  await page.clock.runFor(32);
  await tap(page, '#home [data-do="settings"]');
  assert.equal(await page.locator('[data-do="sound"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-do="vibration"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-do="effects"]').getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('[data-do="music"]').getAttribute('aria-checked'), 'false');
}));

test('version 1 saves retain stars, unlocks, attempts and preferences when new fields are added', async () => {
  const seed = {
    version: 1, unlocked: 3, sound: false, vibration: false, attempts: 7,
    records: {
      1: { stars: 2, gems: 12, progress: 1, attempts: 3 },
      2: { stars: 1, gems: 8, progress: 1, attempts: 2 },
      3: { stars: 0, gems: 4, progress: .48, attempts: 2 },
    },
  };
  await runCheck(async page => {
    assert.equal((await snapshot(page)).unlocked, 3);
    assert.equal((await snapshot(page)).stars, 3);
    await tap(page, '#home [data-do="settings"]');
    assert.equal(await page.locator('[data-do="sound"]').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('[data-do="vibration"]').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('[data-do="effects"]').getAttribute('aria-checked'), 'true');
    await tap(page, '#modal [data-do="effects"]');
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
    assert.equal(saved.unlocked, 3);
    assert.equal(saved.attempts, 7);
    for (const id of [1, 2, 3]) {
      for (const key of ['stars', 'gems', 'progress', 'attempts']) assert.equal(saved.records[id][key], seed.records[id][key]);
      assert.equal(saved.records[id].bestScore, 0);
      assert.equal(saved.records[id].bestCombo, 0);
    }
    await page.reload();
    await page.clock.runFor(32);
    assert.equal((await snapshot(page)).unlocked, 3);
    assert.equal((await snapshot(page)).stars, 3);
  }, seed);
});

test('real touch buttons, keyboard and touch gestures operate the runner', async () => runCheck(async page => {
  await begin(page);
  assert.equal((await snapshot(page)).lane, 1);
  await tap(page, '[data-action="left"]');
  assert.equal((await snapshot(page)).lane, 0);
  await page.clock.runFor(120);
  await page.keyboard.press('ArrowRight');
  assert.equal((await snapshot(page)).lane, 1);
  await page.clock.runFor(120);
  await swipe(page, 70);
  assert.equal((await snapshot(page)).lane, 2);
  await page.clock.runFor(120);
  await swipe(page, -70);
  assert.equal((await snapshot(page)).lane, 1);
  await tap(page, '[data-action="jump"]');
  await page.clock.runFor(64);
  assert.ok((await snapshot(page)).jumpHeight > 0);
  assert.match(await page.locator('#jumpStatus').textContent(), /空中/);
  await page.clock.runFor(850);
  assert.match(await page.locator('#jumpStatus').textContent(), /跃迁就绪/);
  await page.keyboard.press('Space');
  await page.clock.runFor(64);
  assert.ok((await snapshot(page)).jumpHeight > 0);
  assert.match(await page.locator('#jumpStatus').textContent(), /空中/);
  await page.clock.runFor(850);
  await tap(page, '#gameCanvas');
  await page.clock.runFor(64);
  assert.ok((await snapshot(page)).jumpHeight > 0);
  assert.match(await page.locator('#jumpStatus').textContent(), /空中/);
}));

test('a touch swipe changes lane before release and each gesture moves once', async () => runCheck(async page => {
  await begin(page);
  await tap(page, '[data-action="left"]');
  await page.clock.runFor(120);
  assert.equal((await snapshot(page)).lane, 0);
  const box = await page.locator('#gameCanvas').boundingBox();
  const x = box.x + box.width / 3, y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 60, y, id: 1 }] });
    assert.equal((await snapshot(page)).lane, 1, 'swipe must act during pointermove, before the finger lifts');
    await page.clock.runFor(160);
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 130, y, id: 1 }] });
    assert.equal((await snapshot(page)).lane, 1, 'continued motion must not trigger another move');
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.clock.runFor(32);
    assert.equal((await snapshot(page)).lane, 1);
    assert.match(await page.locator('#jumpStatus').textContent(), /跃迁就绪/, 'releasing a consumed swipe must not also jump');
  } finally { await session.detach(); }
}));

test('rapid touch lane inputs and a near-landing jump execute from the input buffer', async () => runCheck(async page => {
  await begin(page);
  await tap(page, '[data-action="left"]');
  await page.clock.runFor(120);
  await tap(page, '[data-action="right"]');
  await tap(page, '[data-action="right"]');
  assert.equal((await snapshot(page)).lane, 1, 'first move is immediate, second awaits cooldown');
  await page.clock.runFor(120);
  assert.equal((await snapshot(page)).lane, 2, 'buffered second tap must not be lost');
  await tap(page, '[data-action="jump"]');
  await page.clock.runFor(740);
  await tap(page, '[data-action="jump"]');
  assert.equal((await snapshot(page)).bufferedJump, true);
  await page.clock.runFor(180);
  assert.equal((await snapshot(page)).bufferedJump, false);
  assert.ok((await snapshot(page)).jumpHeight > 0, 'buffered jump should start when the previous jump lands');
  assert.match(await page.locator('#jumpStatus').textContent(), /空中/);
  await page.clock.runFor(850);
  assert.match(await page.locator('#jumpStatus').textContent(), /跃迁就绪/);
}));

test('pause freezes time, resume counts down, and native/background events remain paused', async () => runCheck(async page => {
  await begin(page);
  await page.clock.runFor(250);
  await tap(page, '#play [data-do="pause"]');
  let state = await snapshot(page);
  assert.equal(state.phase, 'paused');
  const frozenTime = state.time;
  await page.clock.runFor(3000);
  assert.equal((await snapshot(page)).time, frozenTime);
  await page.keyboard.press('ArrowLeft');
  assert.equal((await snapshot(page)).lane, state.lane);
  await tap(page, '#modal [data-do="resume"]');
  assert.equal((await snapshot(page)).phase, 'countdown');
  await page.clock.runFor(800);
  assert.equal((await snapshot(page)).time, frozenTime);
  await page.clock.runFor(700);
  assert.equal((await snapshot(page)).phase, 'running');
  await page.evaluate(() => window.dispatchEvent(new Event('nativePause')));
  assert.equal((await snapshot(page)).phase, 'paused');
  const nativeFrozen = (await snapshot(page)).time;
  await page.evaluate(() => window.dispatchEvent(new Event('nativeResume')));
  await page.clock.runFor(1500);
  assert.equal((await snapshot(page)).phase, 'paused');
  assert.equal((await snapshot(page)).time, nativeFrozen);
  await page.evaluate(() => window.dispatchEvent(new Event('nativeBack')));
  assert.equal((await snapshot(page)).phase, 'countdown');
  await page.clock.runFor(1500);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal((await snapshot(page)).phase, 'paused');
}));

test('100 millisecond animation frames preserve game speed and long stalls pause fairly', async () => runCheck(async page => {
  // Alter only browser frame delivery; the game still advances its own engine.
  await page.evaluate(() => {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 100);
    window.cancelAnimationFrame = id => window.clearTimeout(id);
  });
  await tap(page, '#home [data-do="continue"]');
  await tap(page, '#modal [data-do="start"]');
  await page.clock.runFor(2500);
  const before = await snapshot(page);
  assert.equal(before.phase, 'running');
  await page.clock.runFor(1000);
  const after = await snapshot(page);
  assert.equal(after.phase, 'running');
  assert.ok(Math.abs(after.time - before.time - 1) < .025, `game speed drifted: ${after.time - before.time} seconds for one elapsed second`);
  await page.evaluate(() => {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 400);
  });
  await page.clock.runFor(550);
  assert.equal((await snapshot(page)).phase, 'paused', 'a long rendering stall should not skip unseen obstacles');
}));

test('idle collision shows retry, records attempt, and restart resets the run', async () => runCheck(async page => {
  await begin(page);
  await page.clock.runFor(12000);
  const failed = await snapshot(page);
  assert.equal(failed.phase, 'result');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.unlocked, 1);
  assert.match(await page.locator('#modal').textContent(), /高墙/);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(saved.attempts, 1);
  assert.equal(saved.records[1].attempts, 1);
  assert.ok(saved.records[1].progress > 0 && saved.records[1].progress < 1);
  await tap(page, '#modal [data-do="retry"]');
  const retry = await snapshot(page);
  assert.equal(retry.phase, 'countdown');
  assert.equal(retry.time, 0);
  assert.equal(retry.gems, 0);
  assert.equal(retry.lane, 1);
  assert.equal(retry.status, 'running');
  await page.clock.runFor(450);
  assert.equal((await snapshot(page)).phase, 'countdown');
  await page.clock.runFor(350);
  assert.equal((await snapshot(page)).phase, 'running', 'fast retry should resume within 0.8 seconds');
}));

test('playing level 1 through touch controls wins, unlocks level 2 and survives reload', async () => runCheck(async page => {
  await begin(page);
  const result = await solve(page, levels[0]);
  assert.equal(result.unlocked, 2);
  assert.equal(result.stars, 3);
  assert.ok(result.score > 0);
  assert.equal(result.maxCombo, levels[0].rows.length);
  assert.equal(Number((await page.locator('#scoreCount').textContent()).replace(/[^0-9]/g, '')), result.score);
  assert.match(await page.locator('#comboCount').textContent(), /15 连击/);
  const saved = await savedProgress(page);
  assert.equal(saved.records[1].bestScore, result.score);
  assert.equal(saved.records[1].bestCombo, result.maxCombo);
  assert.match(await page.locator('#modal').textContent(), /得分|分数|SCORE/i);
  await page.screenshot({ path: path.resolve(__dirname, '../qa/browser-level-01-won.png') });
  await tap(page, '#modal [data-do="next"]');
  assert.equal((await snapshot(page)).selected, 2);
  assert.equal((await snapshot(page)).modal, 'prepare');
  await tap(page, '#modal [data-do="close"]');
  assert.equal((await snapshot(page)).modal, '');
  assert.equal((await snapshot(page)).screen, 'levels', 'cancelling the next-level preparation must leave a usable level picker');
  await tap(page, '[data-level="2"]');
  assert.equal((await snapshot(page)).modal, 'prepare');
  await page.reload();
  await page.clock.runFor(32);
  assert.equal((await snapshot(page)).unlocked, 2);
  assert.equal((await snapshot(page)).stars, 3);
  await tap(page, '#home [data-do="levels"]');
  assert.equal(await page.locator('.level-card[aria-disabled="true"]').count(), 13);
  assert.match(await page.locator('[data-level="1"]').getAttribute('class'), /complete/);
  await tap(page, '[data-level="2"]');
  assert.equal((await snapshot(page)).selected, 2);
}));

test('full-level practice can be completed without changing records, attempts or unlocks', async () => {
  const seed = { version: 1, unlocked: 1, sound: false, vibration: false, attempts: 2, records: { 1: { stars: 0, gems: 2, progress: .25, attempts: 2 } } };
  await runCheck(async page => {
    const before = await savedProgress(page);
    await tap(page, '#home [data-do="continue"]');
    await tap(page, '#modal [data-do="practice"]');
    assert.equal((await snapshot(page)).practice, true);
    assert.equal((await snapshot(page)).practiceStartRow, 0);
    await awaitRunning(page);
    const result = await solve(page, levels[0]);
    assert.equal(result.practice, true);
    assert.equal(result.stars, 0);
    assert.equal(result.unlocked, 1);
    assert.ok(result.score > 0, 'practice can show temporary score without saving it');
    assert.deepEqual(await savedProgress(page), before);
    assert.match(await page.locator('#modal').textContent(), /练习/);
    await page.screenshot({ path: path.resolve(__dirname, '../qa/browser-v11-practice-complete.png') });
    await tap(page, '#modal [data-do="official"]');
    assert.equal((await snapshot(page)).practice, false);
    assert.equal((await snapshot(page)).time, 0);
    assert.equal((await snapshot(page)).unlocked, 1);
  }, seed);
});

test('failure-section practice starts near the failed row, preserves practice on retry and saves no rewards', async () => runCheck(async page => {
  await begin(page);
  await page.clock.runFor(12000);
  assert.equal((await snapshot(page)).status, 'failed');
  const before = await savedProgress(page);
  await tap(page, '#modal [data-do="practiceSection"]');
  const section = await snapshot(page);
  assert.equal(section.practice, true);
  assert.ok(section.practiceStartRow > 0, 'failure-section practice should skip already learned opening rows');
  assert.ok(section.time > 0);
  await awaitRunning(page);
  await tap(page, '#play [data-do="pause"]');
  await tap(page, '#modal [data-do="retry"]');
  assert.equal((await snapshot(page)).practice, true, 'retry must retain practice mode');
  assert.equal((await snapshot(page)).practiceStartRow, section.practiceStartRow);
  await awaitRunning(page);
  const spec = levels[0];
  const result = await solve(page, spec, sectionSolution(spec, section.practiceStartRow), spec.rows.length - section.practiceStartRow);
  assert.equal(result.practice, true);
  assert.equal(result.unlocked, 1);
  assert.equal(result.stars, 0);
  assert.deepEqual(await savedProgress(page), before);
}));

test('final level plays through touch controls and shows 15-level completion', async () => {
  const seed = { version: 1, unlocked: 15, sound: false, vibration: false, attempts: 14, records: {} };
  for (let id = 1; id <= 14; id++) seed.records[id] = { stars: 3, gems: levels[id - 1].rows.length, progress: 1, attempts: 1 };
  await runCheck(async page => {
    assert.equal((await snapshot(page)).unlocked, 15);
    await begin(page);
    assert.equal((await snapshot(page)).selected, 15);
    const result = await solve(page, levels[14]);
    assert.equal(result.unlocked, 15);
    assert.equal(result.stars, 45);
    assert.match(await page.locator('#modal').textContent(), /15 关全部完成/);
    assert.match(await page.locator('#modal').textContent(), /45 颗星/);
    await page.screenshot({ path: path.resolve(__dirname, '../qa/browser-level-15-won.png') });
    await tap(page, '#modal [data-do="levels"]');
    assert.equal(await page.locator('.level-card.complete').count(), 15);
    assert.equal(await page.locator('.level-card[aria-disabled="true"]').count(), 0);
    await tap(page, '#levels [data-do="home"]');
    assert.match(await page.locator('#homeDifficulty').textContent(), /全关已通/);
    assert.equal(await page.locator('#home [data-do="continue"] span').textContent(), '再次挑战');
  }, seed);
});

test('all three chapter palettes render distinctly with reachable controls at 360 by 640', async () => {
  const seed = { version: 1, unlocked: 15, sound: false, vibration: false, attempts: 14, records: {} };
  for (let id = 1; id <= 14; id++) seed.records[id] = { stars: 3, gems: levels[id - 1].rows.length, progress: 1, attempts: 1 };
  await runCheck(async page => {
    const backgrounds = [];
    await tap(page, '#home [data-do="levels"]');
    for (const id of [1, 6, 11]) {
      await tap(page, `[data-level="${id}"]`);
      await tap(page, '#modal [data-do="start"]');
      await page.clock.runFor(2200);
      assert.equal((await snapshot(page)).phase, 'running');
      assert.equal((await snapshot(page)).selected, id);
      const layout = await page.evaluate(() => {
        const app = document.getElementById('app').getBoundingClientRect();
        const controls = Array.from(document.querySelectorAll('[data-action]')).map(button => {
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height, reachable: hit === button || button.contains(hit) };
        });
        const canvas = document.getElementById('gameCanvas');
        return { width: innerWidth, height: innerHeight, appWidth: app.width, scrollWidth: document.documentElement.scrollWidth, controls, canvasHeight: canvas.getBoundingClientRect().height, background: Array.from(canvas.getContext('2d').getImageData(1, 1, 1, 1).data).join(',') };
      });
      assert.equal(layout.width, 360);
      assert.ok(layout.appWidth <= 360 && layout.scrollWidth <= 360, 'layout must not overflow horizontally');
      assert.ok(layout.canvasHeight >= 170, 'race arena must retain enough visible space');
      for (const button of layout.controls) {
        assert.ok(button.width >= 44 && button.height >= 44, 'touch targets must remain large enough');
        assert.ok(button.x >= 0 && button.y >= 0 && button.right <= 360.01 && button.bottom <= 640.01);
        assert.equal(button.reachable, true, 'controls must not be covered by HUD or arena');
      }
      backgrounds.push(layout.background);
      await page.screenshot({ path: path.resolve(__dirname, `../qa/browser-v11-chapter-${String(levels[id - 1].chapter).padStart(2, '0')}-360.png`) });
      await tap(page, '#play [data-do="pause"]');
      await tap(page, '#modal [data-do="levels"]');
    }
    assert.equal(new Set(backgrounds).size, 3, 'each chapter must draw its own palette');
  }, seed, { width: 360, height: 640 });
});

test('mirror, rush and combined challenges win independently without changing campaign records', async () => runCheck(async page => {
  const baseline = await savedProgress(page);
  let previousRecords = {};
  await tap(page, '#home [data-do="hub"]');
  for (const mode of ['mirror', 'rush', 'mirrorRush']) {
    await tap(page, `#hub [data-mode="${mode}"]`);
    assert.equal(await page.locator(`#hub [data-mode="${mode}"]`).getAttribute('aria-pressed'), 'true');
    await page.locator('#variantLevel').selectOption('1');
    await tap(page, '#hub [data-do="variant"]');
    const expected = { kind: 'level', baseId: 1, mode, dateKey: null, code: challenges.encodeLevelCode(1, mode) };
    assert.deepEqual((await snapshot(page)).session, expected);
    if (mode === 'mirror') {
      await tap(page, '#modal [data-do="help"]');
      await tap(page, '#modal [data-do="helpDone"]');
      assert.deepEqual((await snapshot(page)).session, expected, 'help round trip must preserve challenge identity');
      await tap(page, '#modal [data-do="practice"]');
      await awaitRunning(page);
      await page.clock.runFor(12000);
      assert.equal((await snapshot(page)).practice, true);
      assert.equal((await snapshot(page)).status, 'failed');
      assert.deepEqual((await fullSave(page)).challengeRecords, {});
      assert.deepEqual(await savedProgress(page), baseline);
      await tap(page, '#modal [data-do="official"]');
      assert.deepEqual((await snapshot(page)).session, expected, 'official challenge after practice must retain mirror mode');
    } else await tap(page, '#modal [data-do="start"]');
    await awaitRunning(page);
    const result = await solve(page, challenges.makeLevel(1, mode));
    assert.deepEqual(result.session, expected);
    assert.equal(result.unlocked, 1);
    assert.equal(result.stars, 0, 'challenge stars must not add to the campaign star count');
    const save = await fullSave(page);
    assert.deepEqual(await savedProgress(page), baseline);
    const record = save.challengeRecords[`1-${mode}`];
    assert.equal(record.wins, 1);
    assert.equal(record.attempts, 1);
    assert.equal(record.stars, 3);
    assert.equal(record.bestScore, result.score);
    for (const [key, value] of Object.entries(previousRecords)) assert.deepEqual(save.challengeRecords[key], value, 'another mode must not overwrite an existing mode record');
    previousRecords = save.challengeRecords;
    assert.deepEqual(save.dailyRecords, {});
    assert.equal(await page.locator('#outgoingCode').inputValue(), expected.code);
    if (mode === 'mirrorRush') await page.screenshot({ path: path.resolve(__dirname, '../qa/browser-v12-challenge-result.png') });
    await tap(page, '#modal [data-do="hub"]');
    assert.equal((await snapshot(page)).screen, 'hub');
  }
  assert.equal(Object.keys((await fullSave(page)).challengeRecords).length, 3);
}, seedCampaign(0)));

test('daily challenge finishes across local midnight and retry keeps its captured date and route', async () => runCheck(async page => {
  await page.clock.setSystemTime(new Date('2026-09-22T15:59:40.000Z'));
  const baseline = await savedProgress(page);
  await tap(page, '#home [data-do="hub"]');
  assert.equal((await snapshot(page)).hubDateKey, '2026-09-22');
  assert.equal(await page.locator('#dailyDate').textContent(), '2026-09-22');
  const daily = challenges.makeDaily('2026-09-22');
  await tap(page, '#hub [data-do="daily"]');
  const captured = (await snapshot(page)).session;
  assert.equal(captured.kind, 'daily');
  assert.equal(captured.dateKey, '2026-09-22');
  assert.equal(captured.code, daily.code);
  await tap(page, '#modal [data-do="start"]');
  await awaitRunning(page);
  await solve(page, daily.level);
  assert.equal(await page.evaluate(() => window.PulseChallenges.localDateKey()), '2026-09-23');
  assert.deepEqual((await snapshot(page)).session, captured);
  assert.deepEqual(await savedProgress(page), baseline);
  const save = await fullSave(page);
  assert.equal(save.dailyRecords['2026-09-22'].wins, 1);
  assert.equal(save.dailyRecords['2026-09-22'].stars, 3);
  assert.equal(save.dailyRecords['2026-09-23'], undefined);
  assert.deepEqual(save.challengeRecords, {});
  assert.equal(await page.locator('#outgoingCode').inputValue(), 'PR2-20260922');
  await page.keyboard.press('r');
  assert.equal((await snapshot(page)).phase, 'countdown');
  assert.deepEqual((await snapshot(page)).session, captured, 'retry after midnight must use the completed daily route');
  await page.clock.runFor(800);
  assert.equal((await snapshot(page)).phase, 'running');
  await tap(page, '#play [data-do="pause"]');
  await tap(page, '#modal [data-do="levels"]');
  assert.equal((await snapshot(page)).screen, 'hub');
  assert.equal((await snapshot(page)).hubDateKey, '2026-09-23');
  await tap(page, '#hub [data-do="daily"]');
  assert.equal((await snapshot(page)).session.dateKey, '2026-09-23', 'a newly selected daily uses the new local date');
  await page.keyboard.press('Escape');
  assert.equal((await snapshot(page)).screen, 'hub');
  assert.equal((await snapshot(page)).modal, '');
}, seedCampaign(0)));

test('friend codes reject invalid text safely and normal level 15 code cannot unlock or finish the campaign', async () => runCheck(async page => {
  const baseline = await savedProgress(page);
  await tap(page, '#home [data-do="hub"]');
  for (const invalid of ['PR2-20260230', 'PR2-L16-N', '<img id=code-probe src=x onerror=window.__codeProbe=1>']) {
    await page.locator('#friendCode').fill(invalid);
    await tap(page, '#hub [data-do="importCode"]');
    assert.equal((await snapshot(page)).screen, 'hub');
    assert.equal((await snapshot(page)).modal, '');
    assert.equal(await page.locator('#codeError').isVisible(), true);
    assert.equal(await page.locator('#code-probe').count(), 0);
    assert.equal(await page.evaluate(() => window.__codeProbe), undefined);
  }
  // A daily code is a reproducible dated route, including when opened later.
  await page.locator('#friendCode').fill('PR2-20240229');
  await page.keyboard.press('Enter');
  assert.equal((await snapshot(page)).session.kind, 'daily');
  assert.equal((await snapshot(page)).session.dateKey, '2024-02-29');
  await page.keyboard.press('Escape');
  assert.equal((await snapshot(page)).screen, 'hub');
  await page.locator('#friendCode').fill('  pr2-l15-n  ');
  await tap(page, '#hub [data-do="importCode"]');
  const expected = { kind: 'level', baseId: 15, mode: 'normal', dateKey: null, code: 'PR2-L15-N' };
  assert.deepEqual((await snapshot(page)).session, expected);
  await tap(page, '#modal [data-do="start"]');
  await awaitRunning(page);
  const result = await solve(page, challenges.makeLevel(15, 'normal'));
  assert.deepEqual(result.session, expected);
  assert.deepEqual(await savedProgress(page), baseline);
  assert.equal(result.unlocked, 1);
  assert.equal(result.stars, 0);
  assert.doesNotMatch(await page.locator('#modal').textContent(), /15 关全部完成|你穿过了极限/);
  const save = await fullSave(page);
  assert.equal(save.challengeRecords['15-normal'].wins, 1);
  assert.deepEqual(save.dailyRecords, {});
  assert.equal(await page.locator('#outgoingCode').inputValue(), 'PR2-L15-N');
  await page.keyboard.press('Escape');
  assert.equal((await snapshot(page)).screen, 'hub');
  assert.equal((await snapshot(page)).modal, '');
}, seedCampaign(0)));

test('goal cards count legacy progress retrospectively and respect the 20 combo threshold', async () => {
  for (const combo of [19, 20]) {
    const seed = seedCampaign(5);
    for (const record of Object.values(seed.records)) record.bestCombo = combo;
    await runCheck(async page => {
      await tap(page, '#home [data-do="hub"]');
      assert.equal(await page.locator('#goalGrid [data-goal]').count(), 10);
      for (const id of ['firstwin', 'fivewins', 'stars15']) assert.match(await page.locator(`[data-goal="${id}"]`).getAttribute('class'), /earned/);
      for (const id of ['allwins', 'stars45', 'combo50', 'mirror5', 'rush5', 'daily3']) assert.doesNotMatch(await page.locator(`[data-goal="${id}"]`).getAttribute('class'), /earned/);
      assert.equal(await page.locator('[data-goal="combo20"] .goal-meter').getAttribute('aria-valuenow'), String(combo));
      assert.equal(await page.locator('[data-goal="combo20"] .goal-meter').getAttribute('aria-valuemax'), '20');
      assert.equal((await page.locator('[data-goal="combo20"]').getAttribute('class')).includes('earned'), combo === 20);
      assert.equal((await snapshot(page)).goals, combo === 20 ? 4 : 3);
      if (combo === 20) {
        await page.locator('#goalGrid').evaluate(element => element.scrollIntoView({ block: 'start' }));
        await page.screenshot({ path: path.resolve(__dirname, '../qa/browser-v12-goals.png') });
      }
    }, seed);
  }
});

test('challenge hub stays usable at 390 by 844 and 360 by 640', async () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await runCheck(async page => {
      await tap(page, '#home [data-do="hub"]');
      assert.equal((await snapshot(page)).screen, 'hub');
      assert.equal(await page.locator('#variantLevel option').count(), 15);
      const initial = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, hubWidth: document.getElementById('hub').clientWidth, hubScrollWidth: document.getElementById('hub').scrollWidth }));
      assert.equal(initial.width, viewport.width);
      assert.ok(initial.scrollWidth <= viewport.width && initial.hubScrollWidth <= initial.hubWidth);
      await page.screenshot({ path: path.resolve(__dirname, `../qa/browser-v12-hub-${viewport.width}.png`) });
      for (const selector of ['[data-do="daily"]', '[data-mode="mirror"]', '[data-mode="rush"]', '[data-mode="mirrorRush"]', '[data-do="variant"]', '[data-do="importCode"]']) {
        const element = page.locator(`#hub ${selector}`);
        await element.evaluate(button => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
        const bounds = await element.evaluate(button => {
          const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
          return { x: b.x, right: b.right, height: b.height, reachable: hit === button || button.contains(hit) };
        });
        assert.ok(bounds.x >= 0 && bounds.right <= viewport.width + .01);
        assert.ok(bounds.height >= 44);
        assert.equal(bounds.reachable, true, selector + ' must be reachable after scrolling');
      }
      await page.locator('#variantLevel').selectOption('15');
      await tap(page, '#hub [data-mode="mirrorRush"]');
      await tap(page, '#hub [data-do="variant"]');
      assert.equal((await snapshot(page)).selected, 15);
      assert.equal((await snapshot(page)).session.mode, 'mirrorRush');
      await page.keyboard.press('Escape');
      assert.equal((await snapshot(page)).screen, 'hub');
      assert.equal((await snapshot(page)).modal, '');
      await page.keyboard.press('Escape');
      assert.equal((await snapshot(page)).screen, 'home');
    }, undefined, viewport);
  }
});

test('an old imported daily still shows results when sixty newer daily records are retained', async () => {
  const seed = seedCampaign(0);
  seed.dailyRecords = {};
  for (let index = 0; index < 60; index++) {
    const day = new Date(Date.UTC(2027, 0, index + 1)).toISOString().slice(0, 10);
    const descriptor = challenges.makeDaily(day);
    seed.dailyRecords[day] = { baseId: descriptor.baseId, mode: descriptor.mode, stars: 3, gems: descriptor.level.rows.length, progress: 1, attempts: 1, wins: 1, bestScore: 5000, bestCombo: descriptor.level.rows.length };
  }
  await runCheck(async page => {
    const baseline = await savedProgress(page);
    await tap(page, '#home [data-do="hub"]');
    await page.locator('#friendCode').fill('PR2-20260922');
    await tap(page, '#hub [data-do="importCode"]');
    const captured = (await snapshot(page)).session;
    await tap(page, '#modal [data-do="start"]');
    await awaitRunning(page);
    await page.clock.runFor(12000);
    const result = await snapshot(page);
    assert.equal(result.phase, 'result');
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.session, captured);
    assert.match(await page.locator('#modal').textContent(), /尝试 1 次/);
    assert.equal(await page.locator('#outgoingCode').inputValue(), 'PR2-20260922');
    assert.deepEqual(await savedProgress(page), baseline);
    const save = await fullSave(page);
    assert.equal(Object.keys(save.dailyRecords).length, 60);
    assert.equal(save.dailyRecords['2026-09-22'], undefined, 'old history can be evicted without invalidating current result data');
    await page.keyboard.press('r');
    assert.equal((await snapshot(page)).phase, 'countdown');
    assert.deepEqual((await snapshot(page)).session, captured);
  }, seed);
});

test('open hub refreshes at local midnight without resetting edits or prepared sessions', async () => runCheck(async page => {
  await page.clock.setSystemTime(new Date('2026-09-22T15:59:59.000Z'));
  await tap(page, '#home [data-do="hub"]');
  await page.locator('#variantLevel').selectOption('15');
  await tap(page, '#hub [data-mode="mirrorRush"]');
  await page.locator('#friendCode').fill('PR2-L05-M');
  await page.clock.runFor(2300);
  assert.equal(await page.locator('#dailyDate').textContent(), '2026-09-23');
  assert.equal((await snapshot(page)).hubDateKey, '2026-09-23');
  assert.equal(await page.locator('#variantLevel').inputValue(), '15');
  assert.equal(await page.locator('[data-mode="mirrorRush"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#friendCode').inputValue(), 'PR2-L05-M');
  await tap(page, '#hub [data-do="daily"]');
  const prepared = (await snapshot(page)).session;
  assert.equal(prepared.dateKey, '2026-09-23');
  await page.clock.setSystemTime(new Date('2026-09-23T16:00:01.000Z'));
  await page.clock.runFor(1200);
  assert.deepEqual((await snapshot(page)).session, prepared, 'an already prepared daily must not change underneath the player');
  await tap(page, '#modal [data-do="start"]');
  await awaitRunning(page);
  assert.deepEqual((await snapshot(page)).session, prepared);
}, seedCampaign(0)));

test('challenge code copy uses canonical text and clipboard failures provide selected text fallbacks', async () => runCheck(async page => {
  await page.evaluate(() => {
    window.__copiedTexts = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: text => { window.__copiedTexts.push(text); return Promise.resolve(); },
    } });
  });
  await tap(page, '#home [data-do="hub"]');
  await tap(page, '#hub [data-do="copyDaily"]');
  assert.deepEqual(await page.evaluate(() => window.__copiedTexts), ['PR2-20260922']);
  assert.match(await page.locator('#toast').textContent(), /已复制/);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Clipboard denied for test')) } });
  });
  await tap(page, '#hub [data-do="copyDaily"]');
  const selectedFriend = await page.locator('#friendCode').evaluate(input => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input }));
  assert.deepEqual(selectedFriend, { value: 'PR2-20260922', start: 0, end: 12, focused: true });
  assert.match(await page.locator('#toast').textContent(), /已选中/);
  await tap(page, '#hub [data-mode="mirror"]');
  await page.locator('#variantLevel').selectOption('1');
  await tap(page, '#hub [data-do="variant"]');
  await tap(page, '#modal [data-do="start"]');
  await awaitRunning(page);
  await page.clock.runFor(12000);
  assert.equal((await snapshot(page)).phase, 'result');
  assert.equal((await snapshot(page)).status, 'failed');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
  await tap(page, '#modal [data-do="copyCode"]');
  const selectedResult = await page.locator('#outgoingCode').evaluate(input => ({ value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: document.activeElement === input }));
  assert.deepEqual(selectedResult, { value: 'PR2-L01-M', start: 0, end: 9, focused: true });
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: text => { window.__copiedTexts.push(text); return Promise.resolve(); },
  } }));
  await tap(page, '#modal [data-do="copyCode"]');
  assert.deepEqual(await page.evaluate(() => window.__copiedTexts), ['PR2-20260922', 'PR2-L01-M']);
}, seedCampaign(0)));
