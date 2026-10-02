'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');
const { chromium } = playwright;
const Expedition = require('../web/expedition.js');
const entry = pathToFileURL(path.resolve(__dirname, '../web/index.html')).href;
const saveKey = 'pulse-runner-save-v1';
let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PULSE_BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE_PATH }
    : { channel: process.env.PULSE_BROWSER_CHANNEL || 'chrome' }) });
});
test.after(async () => { if (browser) await browser.close(); });

function baselineSave() {
  return {
    version: 1, unlocked: 2, sound: false, music: false, vibration: false, effects: true, attempts: 3,
    records: { 1: { stars: 2, gems: 12, progress: 1, attempts: 3, bestScore: 4000, bestCombo: 12 } },
  };
}
async function checkBrowser(check, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: saveKey, value: options.save || baselineSave() });
  const epoch = new Date('2026-09-22T00:00:00.000Z');
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(new Date(epoch.valueOf() + 1000));
  try {
    await page.goto(entry);
    await page.clock.runFor(32);
    await check(page);
    assert.deepEqual(errors, [], 'the application must not throw browser errors');
  } catch (error) {
    await capture(page, 'browser-v13-last-failure.png');
    throw error;
  } finally { await context.close(); }
}
async function snapshot(page) { return page.evaluate(() => window.PulseGame.snapshot()); }
async function fullSave(page) {
  return page.evaluate(key => window.PulseEngine.cleanSave(JSON.parse(localStorage.getItem(key) || 'null')), saveKey);
}
function legacyRecords(save) {
  return { unlocked: save.unlocked, attempts: save.attempts, records: save.records, challengeRecords: save.challengeRecords, dailyRecords: save.dailyRecords };
}
async function tap(page, selector) {
  const target = page.locator(selector);
  assert.equal(await target.count(), 1, `expected one target: ${selector}`);
  let box = await target.boundingBox();
  assert.ok(box && box.width && box.height, `target is hidden: ${selector}`);
  const reachable = await target.evaluate(element => {
    const b = element.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return hit === element || element.contains(hit);
  });
  if (!reachable) {
    await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    box = await target.boundingBox();
  }
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
async function awaitRunning(page) {
  for (let tick = 0; tick < 100; tick++) {
    if ((await snapshot(page)).phase === 'running') return;
    await page.clock.runFor(32);
  }
  assert.fail('countdown did not reach the running phase: ' + JSON.stringify(await snapshot(page)));
}
async function advanceTo(page, time) {
  let current = await snapshot(page);
  if (current.time < time) await page.clock.runFor(Math.ceil((time - current.time) * 1000));
  current = await snapshot(page);
  if (current.time < time - 1e-7 && current.phase === 'running') await page.clock.runFor(16);
}
async function playActions(page, actions, until) {
  for (const action of actions) {
    if (action.t > until) break;
    const state = await snapshot(page);
    assert.equal(state.phase, 'running', `run ended before ${action.t.toFixed(3)} s: ${JSON.stringify(state)}`);
    assert.ok(action.t >= state.time - .05, 'solution must start before its scheduled controls');
    await advanceTo(page, action.t);
    await tap(page, `[data-action="${action.action}"]`);
  }
  await advanceTo(page, until);
}
async function capture(page, filename) {
  await page.screenshot({ path: path.resolve(__dirname, '../qa/' + filename), animations: 'disabled' });
}

async function openTrial(page, id) {
  if ((await snapshot(page)).screen === 'home') await tap(page, '#home [data-do="hub"]');
  await page.locator('#trialLevel').selectOption(String(id));
  await tap(page, '#hub [data-do="trial"]');
  assert.equal((await snapshot(page)).session.kind, 'trial');
  assert.equal((await snapshot(page)).selected, id);
}
async function openCode(page, code) {
  if ((await snapshot(page)).screen === 'home') await tap(page, '#home [data-do="hub"]');
  await page.locator('#friendCode').fill(code);
  await tap(page, '#hub [data-do="importCode"]');
  assert.equal((await snapshot(page)).modal, 'prepare');
}
async function startPrepared(page) {
  await tap(page, '#modal [data-do="start"]');
  await awaitRunning(page);
}
async function finishTrial(page, trial, actions) {
  await playActions(page, actions, trial.duration);
  await page.clock.runFor(1100);
  const result = await snapshot(page);
  assert.equal(result.phase, 'result');
  assert.equal(result.status, 'won');
  assert.equal(result.gems, trial.rows.length);
  return result;
}

test('trial telegraphs moving walls and locked gates before collision; risk route earns exactly 200 per bonus', async () => checkBrowser(async page => {
  const original = legacyRecords(await fullSave(page));
  const trial = Expedition.makeTrial(1);
  await openTrial(page, 1);
  const session = (await snapshot(page)).session;
  assert.equal(session.code, 'PR3-T-01');
  assert.match(await page.locator('#modal').textContent(), /移动高墙/);
  assert.match(await page.locator('#modal').textContent(), /周期闸门/);
  await tap(page, '#modal [data-do="help"]');
  await tap(page, '#modal [data-do="helpDone"]');
  assert.deepEqual((await snapshot(page)).session, session);
  await startPrepared(page);
  assert.match(await page.locator('#play').getAttribute('class'), /has-mechanics/);
  const moving = trial.rows[0];
  assert.ok(moving.motion);
  await advanceTo(page, moving.motion.moveEnd + .016);
  assert.ok(moving.t - (await snapshot(page)).time >= .85, 'moving wall must already be settled with at least 0.85 seconds to react');
  assert.match(await page.locator('#mechanicHint').textContent(), /高墙落点/);
  await capture(page, 'browser-v13-moving-wall.png');
  const gate = trial.rows[1];
  assert.ok(gate.gate);
  await advanceTo(page, gate.gate.lockAt + .016);
  assert.ok(gate.t - (await snapshot(page)).time >= .85, 'gate state must lock before the reaction window');
  assert.equal(await page.evaluate(row => window.PulseEngine.rowState(row, window.PulseGame.snapshot().time).gateLocked, gate), true);
  // Canvas resolves every frame; explanatory HUD text refreshes every ~48 ms.
  await page.clock.runFor(64);
  assert.match(await page.locator('#mechanicHint').textContent(), /状态已锁定/);
  await capture(page, 'browser-v13-locked-gate.png');
  const safe = await finishTrial(page, trial, trial.solution);
  assert.equal(safe.bonusGems, 0);
  assert.deepEqual(legacyRecords(await fullSave(page)), original);
  const firstRecord = (await fullSave(page)).trialRecords[1];
  assert.equal(firstRecord.wins, 1);
  assert.equal(firstRecord.attempts, 1);
  assert.equal(firstRecord.bestScore, safe.score);
  await tap(page, '#modal [data-do="retry"]');
  await awaitRunning(page);
  const risk = await finishTrial(page, trial, trial.riskSolution);
  assert.equal(risk.bonusGems, trial.bonusTotal);
  assert.equal(risk.score - safe.score, trial.bonusTotal * 200);
  assert.equal(risk.gems, safe.gems, 'bonus route still collects at most one normal crystal per row');
  assert.equal(await page.locator('#outgoingCode').inputValue(), 'PR3-T-01');
  const secondRecord = (await fullSave(page)).trialRecords[1];
  assert.equal(secondRecord.wins, 2);
  assert.equal(secondRecord.attempts, 2);
  assert.equal(secondRecord.bestScore, risk.score);
  assert.deepEqual(legacyRecords(await fullSave(page)), original);
  await capture(page, 'browser-v13-risk-result.png');
}));

test('trial 15 imports independently and practice does not write any results', async () => checkBrowser(async page => {
  const before = await fullSave(page);
  await openCode(page, ' pr3-t-15 ');
  assert.equal((await snapshot(page)).selected, 15);
  assert.equal((await snapshot(page)).session.code, 'PR3-T-15');
  await tap(page, '#modal [data-do="practice"]');
  await awaitRunning(page);
  await page.clock.runFor(10000);
  assert.equal((await snapshot(page)).phase, 'result');
  assert.equal((await snapshot(page)).practice, true);
  assert.deepEqual(await fullSave(page), before);
  await tap(page, '#modal [data-do="official"]');
  assert.equal((await snapshot(page)).practice, false);
  assert.equal((await snapshot(page)).session.kind, 'trial');
  assert.equal((await snapshot(page)).selected, 15);
  assert.equal((await snapshot(page)).unlocked, 2);
}));

test('endless generates beyond its initial segment, advances stages and saves distance exactly once', async () => checkBrowser(async page => {
  const original = legacyRecords(await fullSave(page));
  const seed = 0x13572468, course = Expedition.makeEndless(seed), initialRows = course.rows.length;
  course.ensureRows(58);
  await openCode(page, Expedition.encodeEndlessCode(seed));
  assert.equal(await page.locator('#modal [data-do="practice"]').count(), 0);
  assert.match(await page.locator('#modal').textContent(), /没有终点/);
  await startPrepared(page);
  const captured = (await snapshot(page)).session;
  await playActions(page, course.solution, 55);
  const state = await snapshot(page);
  assert.equal(state.phase, 'running');
  assert.equal(state.status, 'running', 'endless must not end at an authored campaign duration');
  assert.ok(state.gems > initialRows, 'the browser must consume newly generated segments');
  assert.equal(state.stage, 3);
  assert.ok(state.distance > 0);
  assert.doesNotMatch(await page.locator('#runPercent').textContent(), /%|NaN|Infinity/);
  assert.match(await page.locator('#runPercent').textContent(), /米/);
  assert.match(await page.locator('#gameSpeed').textContent(), /阶段 3/);
  assert.deepEqual(legacyRecords(await fullSave(page)), original);
  await capture(page, 'browser-v13-endless-stage3.png');
  await tap(page, '#play [data-do="pause"]');
  const frozen = await snapshot(page);
  await page.clock.runFor(1500);
  assert.equal((await snapshot(page)).time, frozen.time);
  assert.equal((await snapshot(page)).distance, frozen.distance);
  assert.equal((await fullSave(page)).endlessRecord.attempts, 0, 'pause alone must not settle a run');
  await tap(page, '#modal [data-do="endRun"]');
  const finished = await snapshot(page);
  assert.equal(finished.status, 'finished');
  assert.equal(finished.phase, 'result');
  assert.deepEqual(finished.session, captured);
  const saved = await fullSave(page);
  assert.equal(saved.endlessRecord.attempts, 1);
  assert.equal(saved.endlessRecord.bestDistance, frozen.distance);
  assert.equal(saved.endlessRecord.bestScore, frozen.score);
  assert.deepEqual(legacyRecords(saved), original);
  assert.equal(await page.locator('#outgoingCode').inputValue(), captured.code);
  await capture(page, 'browser-v13-endless-result.png');
  await tap(page, '#modal [data-do="hub"]');
  assert.match(await page.locator('#endlessBest').textContent(), /最远/);
  await page.reload();
  await page.clock.runFor(32);
  assert.deepEqual((await fullSave(page)).endlessRecord, saved.endlessRecord, 'navigation and reload must not double-count settlement');
  assert.deepEqual(legacyRecords(await fullSave(page)), original);
}));

test('paused endless retry and exit each settle once; new-route cancel returns to a usable hub', async () => checkBrowser(async page => {
  const original = legacyRecords(await fullSave(page));
  await openCode(page, 'PR3-E-FFFFFFFF');
  await startPrepared(page);
  await page.clock.runFor(800);
  const first = await snapshot(page);
  await tap(page, '#play [data-do="pause"]');
  assert.match(await page.locator('#modal [data-do="retry"]').textContent(), /保存/);
  await tap(page, '#modal [data-do="retry"]');
  assert.equal((await fullSave(page)).endlessRecord.attempts, 1);
  assert.deepEqual((await snapshot(page)).session, first.session);
  assert.equal((await snapshot(page)).time, 0);
  await awaitRunning(page);
  await page.clock.runFor(1200);
  const second = await snapshot(page);
  await tap(page, '#play [data-do="pause"]');
  await tap(page, '#modal [data-do="levels"]');
  assert.equal((await snapshot(page)).screen, 'hub');
  assert.equal((await fullSave(page)).endlessRecord.attempts, 2);
  assert.ok((await fullSave(page)).endlessRecord.bestDistance >= second.distance);
  await openCode(page, first.session.code);
  await startPrepared(page);
  await tap(page, '#play [data-do="pause"]');
  await tap(page, '#modal [data-do="endRun"]');
  assert.equal((await fullSave(page)).endlessRecord.attempts, 3);
  await tap(page, '#modal [data-do="newRoute"]');
  const newSession = (await snapshot(page)).session;
  assert.equal(newSession.kind, 'endless');
  assert.notEqual(newSession.seed, first.session.seed);
  assert.equal(newSession.code, Expedition.encodeEndlessCode(newSession.seed));
  await tap(page, '#modal [data-do="close"]');
  assert.equal((await snapshot(page)).screen, 'hub');
  assert.equal((await snapshot(page)).modal, '');
  assert.equal((await fullSave(page)).endlessRecord.attempts, 3);
  await tap(page, '#hub [data-do="endless"]');
  assert.equal((await snapshot(page)).modal, 'prepare');
  assert.notEqual((await snapshot(page)).session.seed, newSession.seed);
  await tap(page, '#modal [data-do="close"]');
  await openCode(page, 'PR3-E-0000002A');
  await startPrepared(page);
  await page.clock.runFor(11500);
  const collision = await snapshot(page);
  assert.equal(collision.phase, 'result');
  assert.equal(collision.status, 'failed');
  assert.equal((await fullSave(page)).endlessRecord.attempts, 4, 'a collision also settles once');
  assert.ok((await fullSave(page)).endlessRecord.bestDistance >= collision.distance);
  assert.equal(await page.locator('#outgoingCode').inputValue(), 'PR3-E-0000002A');
  assert.equal(await page.locator('#modal [data-do="practiceSection"]').count(), 0);
  await tap(page, '#modal [data-do="retry"]');
  assert.deepEqual((await snapshot(page)).session, collision.session);
  assert.equal((await fullSave(page)).endlessRecord.attempts, 4, 'result retry cannot settle the failure twice');
  assert.deepEqual(legacyRecords(await fullSave(page)), original);
}));

test('mechanics and endless entry, help and controls fit the 360 by 640 screen', async () => checkBrowser(async page => {
  await tap(page, '#home [data-do="hub"]');
  assert.equal(await page.locator('#trialLevel option').count(), 15);
  for (const selector of ['#hub [data-do="trial"]', '#hub [data-do="endless"]']) {
    const target = page.locator(selector);
    await target.evaluate(button => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const box = await target.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= 360.01 && box.height >= 44);
  }
  await capture(page, 'browser-v13-hub-360.png');
  await openTrial(page, 15);
  await tap(page, '#modal [data-do="help"]');
  assert.match(await page.locator('#modal').textContent(), /移动高墙|金色奖励/);
  await tap(page, '#modal [data-do="helpDone"]');
  assert.equal((await snapshot(page)).session.kind, 'trial');
  await tap(page, '#modal [data-do="close"]');
  await tap(page, '#hub [data-do="endless"]');
  const prepared = (await snapshot(page)).session;
  await tap(page, '#modal [data-do="help"]');
  await tap(page, '#modal [data-do="helpDone"]');
  assert.deepEqual((await snapshot(page)).session, prepared);
  await startPrepared(page);
  const layout = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    buttons: Array.from(document.querySelectorAll('[data-action]')).map(button => {
      const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { width: b.width, height: b.height, x: b.x, right: b.right, bottom: b.bottom, reachable: hit === button || button.contains(hit) };
    }),
  }));
  assert.equal(layout.width, 360);
  assert.ok(layout.scrollWidth <= 360);
  for (const button of layout.buttons) {
    assert.ok(button.width >= 44 && button.height >= 44 && button.x >= 0 && button.right <= 360.01 && button.bottom <= 640.01);
    assert.equal(button.reachable, true);
  }
  await capture(page, 'browser-v13-endless-360.png');
}, { viewport: { width: 360, height: 640 } }));
