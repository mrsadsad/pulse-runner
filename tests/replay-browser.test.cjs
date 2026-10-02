'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const playwright = require('playwright');
const { chromium } = playwright;
const entry = pathToFileURL(path.resolve(__dirname, '../web/index.html')).href;
const saveKey = 'pulse-runner-save-v1';
let browser;

test.before(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PULSE_BROWSER_EXECUTABLE_PATH
    ? { executablePath: process.env.PULSE_BROWSER_EXECUTABLE_PATH }
    : { channel: process.env.PULSE_BROWSER_CHANNEL || 'chrome' }) });
});
test.after(async () => { if (browser) await browser.close(); });

function initialSave() {
  return { version: 1, unlocked: 1, sound: false, music: false, vibration: false, effects: true, attempts: 0, records: {} };
}
function legacyScoreSave() {
  const save = initialSave();
  save.attempts = 1;
  save.records[1] = { stars: 0, gems: 1, progress: .3, attempts: 1, bestScore: 5000, bestCombo: 1 };
  return save;
}
function legacyRewardSave() {
  const save = initialSave();
  save.unlocked = 15;
  save.attempts = 15;
  save.challengeRecords = {};
  save.dailyRecords = {};
  for (let id = 1; id <= 15; id++) {
    save.records[id] = { stars: 3, gems: 64, progress: 1, attempts: 1, bestScore: 25000, bestCombo: 50 };
    if (id <= 5) save.challengeRecords[id + '-mirrorRush'] = { stars: 3, gems: 64, progress: 1, attempts: 1, wins: 1, bestScore: 25000, bestCombo: 50 };
  }
  for (const date of ['2026-09-18', '2026-09-19', '2026-09-20']) {
    const daily = require('../web/challenges.js').makeDaily(date);
    save.dailyRecords[date] = { baseId: daily.baseId, mode: daily.mode, stars: 3, gems: 64, progress: 1, attempts: 1, wins: 1, bestScore: 25000, bestCombo: 50 };
  }
  return save;
}
function scoresOnly(save) {
  const { unlocked, attempts, records, challengeRecords, dailyRecords, trialRecords, endlessRecord } = require('../web/engine.js').cleanSave(save);
  return { unlocked, attempts, records, challengeRecords, dailyRecords, trialRecords, endlessRecord };
}
async function checkBrowser(check, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: saveKey, value: options.save || initialSave() });
  const epoch = new Date('2026-09-22T00:00:00.000Z');
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(new Date(epoch.valueOf() + 1000));
  try {
    await page.goto(entry);
    await page.clock.runFor(32);
    await check(page);
    assert.deepEqual(errors, [], 'the application must not throw browser errors');
  } catch (error) {
    await capture(page, 'browser-v14-last-failure.png');
    throw error;
  } finally { await context.close(); }
}
async function snapshot(page) { return page.evaluate(() => window.PulseGame.snapshot()); }
async function rawSave(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), saveKey); }
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
async function startCampaign(page, id = 1) {
  await tap(page, '#home [data-do="levels"]');
  await tap(page, `[data-level="${id}"]`);
  await startPrepared(page);
}
function recordedTrack(level) {
  // Build valid post-update recordings through the public observer API. The
  // browser receives an existing profile; its live run is never mutated.
  const Engine = require('../web/engine.js');
  const Replay = require('../web/replay.js');
  const recorder = new Replay.Recorder(Replay.keyFor(level));
  const run = new Engine.Run(level, { onUpdate: state => recorder.observe(state) });
  run.step(.5);
  run.input('left');
  run.step(1.5);
  run.input('right');
  if (level.endless) run.finishEndless();
  else run.step(120);
  const track = recorder.track(run);
  assert.ok(track && track.frames.length > 1, 'fixture must contain actual recorded operations');
  return track;
}

test('failure replay is a read-only half-speed view of the last six seconds and returns to the settled result', async () => checkBrowser(async page => {
  await startCampaign(page);
  await page.clock.runFor(9500);
  const failed = await snapshot(page);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.phase, 'result');
  assert.ok(failed.time > 6);
  const stored = await rawSave(page);
  const resultText = await page.locator('#modal').textContent();
  await tap(page, '#modal [data-do="replay"]');
  const opened = await snapshot(page);
  assert.equal(opened.phase, 'replay');
  assert.equal(opened.replay.rate, .5);
  assert.equal(opened.replay.playing, true);
  assert.ok(Math.abs(opened.replay.end - failed.time) < .02);
  assert.ok(Math.abs(opened.replay.start - (failed.time - 6)) < .02);
  await page.mouse.click(5, 5);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await page.clock.runFor(2000);
  const playing = await snapshot(page);
  assert.ok(playing.replay.time - opened.replay.time > .94 && playing.replay.time - opened.replay.time < 1.06);
  for (const key of ['time', 'score', 'lane', 'gems', 'distance', 'status']) assert.equal(playing[key], failed[key], key + ' changed during replay');
  assert.deepEqual(await rawSave(page), stored);
  await capture(page, 'browser-v14-failure-replay.png');
  await page.evaluate(() => window.dispatchEvent(new Event('nativePause')));
  const frozen = (await snapshot(page)).replay;
  assert.equal(frozen.playing, false);
  await page.clock.runFor(1000);
  assert.equal((await snapshot(page)).replay.time, frozen.time);
  await page.evaluate(() => window.dispatchEvent(new Event('nativeResume')));
  await page.clock.runFor(1000);
  assert.equal((await snapshot(page)).replay.time, frozen.time, 'native resume must not restart playback');
  await page.locator('#replaySeek').focus();
  await page.keyboard.press('ArrowRight');
  const sought = (await snapshot(page)).replay.time;
  assert.ok(sought > frozen.time, 'focused replay range must retain native keyboard seeking');
  await tap(page, '#replayToggle');
  await page.clock.runFor(400);
  assert.ok((await snapshot(page)).replay.time > sought);
  await tap(page, '[data-do="replayRate"]');
  const atNormalSpeed = (await snapshot(page)).replay;
  assert.equal(atNormalSpeed.rate, 1);
  await page.clock.runFor(400);
  assert.ok((await snapshot(page)).replay.time - atNormalSpeed.time > .37);
  assert.ok((await snapshot(page)).replay.time - atNormalSpeed.time < .43);
  await tap(page, '[data-do="replayRestart"]');
  assert.equal((await snapshot(page)).replay.time, opened.replay.start);
  assert.equal((await snapshot(page)).replay.playing, true);
  await page.locator('#replayToggle').focus();
  await page.keyboard.press('Space');
  assert.equal((await snapshot(page)).replay.playing, false, 'focused replay button must retain native keyboard activation');
  const layout = await page.evaluate(() => ({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    controls: Array.from(document.querySelectorAll('#replayDeck button')).map(button => {
      const b = button.getBoundingClientRect();
      return { left: b.left, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
    }),
  }));
  assert.ok(layout.scrollWidth <= layout.width);
  for (const control of layout.controls) assert.ok(control.left >= 0 && control.right <= 360.01 && control.bottom <= 640.01 && control.width >= 44 && control.height >= 44);
  await page.evaluate(() => window.dispatchEvent(new Event('nativeBack')));
  const restored = await snapshot(page);
  assert.equal(restored.phase, 'result');
  assert.equal(restored.replay, null);
  assert.equal(await page.locator('#modal').textContent(), resultText);
  assert.deepEqual(await rawSave(page), stored, 'returning from replay must not settle again');
  await tap(page, '#modal [data-do="replay"]');
  await tap(page, '[data-do="replayBack"]');
  assert.equal((await snapshot(page)).phase, 'result');
  assert.deepEqual(await rawSave(page), stored);
}, { viewport: { width: 360, height: 640 } }));

test('only a newly recorded route produces a ghost; a worse result and practice preserve the best recording', async () => checkBrowser(async page => {
  const level = require('../web/levels.js')[0];
  await startCampaign(page);
  assert.equal((await snapshot(page)).ghost.available, false, 'legacy scores contain no recorded movements');
  await playActions(page, level.solution, level.duration);
  await page.clock.runFor(1100);
  const won = await snapshot(page);
  assert.equal(won.status, 'won');
  assert.equal(won.recordedTracks, 1);
  assert.equal(won.rewardCount, 1);
  assert.match(await page.locator('#modal .goal-unlock').textContent(), /解锁装扮：初燃/);
  await capture(page, 'browser-v14-new-reward-result.png');
  const recorded = await rawSave(page);
  await tap(page, '#modal [data-do="retry"]');
  await awaitRunning(page);
  const ghost = (await snapshot(page)).ghost;
  assert.equal(ghost.available, true);
  assert.equal(ghost.visible, true);
  assert.equal(ghost.key, 'campaign:1');
  assert.equal(ghost.score, won.score);
  await page.clock.runFor(5000);
  await capture(page, 'browser-v14-best-ghost.png');
  await page.clock.runFor(4500);
  const failed = await snapshot(page);
  assert.equal(failed.status, 'failed');
  assert.ok(failed.score < won.score);
  await tap(page, '#modal [data-do="retry"]');
  await awaitRunning(page);
  assert.equal((await snapshot(page)).ghost.score, won.score, 'a lower recorded score must preserve the old best');
  await page.clock.runFor(9500);
  const beforePractice = await rawSave(page);
  await tap(page, '#modal [data-do="practiceSection"]');
  await awaitRunning(page);
  assert.equal((await snapshot(page)).practice, true);
  await page.clock.runFor(12000);
  assert.equal((await snapshot(page)).phase, 'result');
  assert.deepEqual(await rawSave(page), beforePractice, 'practice must not store a trace or alter any score');
  assert.equal(scoresOnly(recorded).records[1].stars, 3);
  assert.deepEqual((await rawSave(page)).replays, recorded.replays);
}, { save: legacyScoreSave() }));

test('empty collection exposes two defaults and blocks locked equipment', async () => checkBrowser(async page => {
  await tap(page, '#home [data-do="hub"]');
  await tap(page, '#hub [data-do="wardrobe"]');
  assert.equal((await snapshot(page)).screen, 'wardrobe');
  assert.equal(await page.locator('.reward-card[data-reward]').count(), 12);
  assert.equal((await snapshot(page)).rewardCount, 0);
  assert.deepEqual((await snapshot(page)).equipped, { skin: 'pulse', trail: 'classic' });
  for (const id of ['spark', 'twin', 'aurora', 'prism', 'crown', 'dots', 'comet', 'kite', 'ribbon', 'echo']) {
    assert.equal(await page.locator(`[data-equip="${id}"]`).isDisabled(), true, id + ' must remain locked');
  }
  const before = await rawSave(page);
  await tap(page, '[data-equip="crown"]');
  assert.deepEqual((await snapshot(page)).equipped, { skin: 'pulse', trail: 'classic' });
  assert.deepEqual(await rawSave(page), before);
  await capture(page, 'browser-v14-collection-locked.png');
}, { viewport: { width: 360, height: 640 } }));

test('legacy achievements unlock all ten rewards and equipped cosmetics persist without changing progress', async () => checkBrowser(async page => {
  const before = scoresOnly(await rawSave(page));
  await tap(page, '#home [data-do="hub"]');
  await tap(page, '#hub [data-do="wardrobe"]');
  assert.equal((await snapshot(page)).rewardCount, 10);
  assert.equal(await page.locator('.reward-card[data-reward]').count(), 12);
  await tap(page, '[data-equip="crown"]');
  await tap(page, '[data-equip="comet"]');
  assert.deepEqual((await snapshot(page)).equipped, { skin: 'crown', trail: 'comet' });
  assert.equal(await page.locator('[data-equip="crown"]').isDisabled(), true);
  assert.equal(await page.locator('[data-equip="comet"]').isDisabled(), true);
  assert.deepEqual(scoresOnly(await rawSave(page)), before);
  const size = await page.evaluate(key => new TextEncoder().encode(localStorage.getItem(key)).length, saveKey);
  assert.ok(size <= 65536);
  await capture(page, 'browser-v14-collection-equipped.png');
  await page.locator('#wardrobe').evaluate(element => { element.scrollTop = 0; });
  await page.clock.runFor(32);
  await capture(page, 'browser-v14-collection-preview.png');
  await page.reload();
  await page.clock.runFor(32);
  assert.deepEqual((await snapshot(page)).equipped, { skin: 'crown', trail: 'comet' });
  await startCampaign(page);
  assert.equal((await snapshot(page)).ghost.available, false);
  const level = require('../web/levels.js')[0];
  await playActions(page, level.solution, level.duration);
  await page.clock.runFor(1100);
  assert.equal((await snapshot(page)).status, 'won');
  assert.equal((await snapshot(page)).gems, level.rows.length);
  assert.equal((await snapshot(page)).score, 4975, 'appearance must not change the route score');
  await capture(page, 'browser-v14-equipped-result.png');
}, { save: legacyRewardSave(), viewport: { width: 360, height: 640 } }));

test('ghost identity distinguishes daily date, independent mode, and exact endless seed', async () => {
  const Challenges = require('../web/challenges.js'), Expedition = require('../web/expedition.js');
  const firstDate = '2026-09-22', firstDaily = Challenges.makeDaily(firstDate);
  let secondDaily;
  for (let offset = 1; offset <= 180 && !secondDaily; offset++) {
    const date = new Date(Date.UTC(2026, 8, 22 - offset)).toISOString().slice(0, 10);
    const daily = Challenges.makeDaily(date);
    if (daily.baseId === firstDaily.baseId && daily.mode === firstDaily.mode) secondDaily = daily;
  }
  assert.ok(secondDaily, 'fixture requires another day with the same base route and mode');
  const seed = 0x13572468, dailyTrack = recordedTrack(firstDaily.level), endlessTrack = recordedTrack(Expedition.makeEndless(seed));
  const save = initialSave();
  save.replays = [dailyTrack, endlessTrack];
  await checkBrowser(async page => {
    const scenarios = [
      { code: firstDaily.code, key: dailyTrack.key, available: true },
      { code: Challenges.encodeLevelCode(firstDaily.baseId, firstDaily.mode), available: false },
      { code: secondDaily.code, available: false },
      { code: Expedition.encodeEndlessCode(seed), key: endlessTrack.key, available: true },
      { code: Expedition.encodeEndlessCode(seed + 1), available: false },
    ];
    for (const scenario of scenarios) {
      await page.reload();
      await page.clock.runFor(32);
      await openCode(page, scenario.code);
      await startPrepared(page);
      const state = await snapshot(page);
      assert.equal(state.ghost.available, scenario.available, 'wrong ghost for ' + scenario.code);
      assert.equal(state.ghost.visible, scenario.available);
      if (scenario.key) assert.equal(state.ghost.key, scenario.key);
    }
    const final = await rawSave(page);
    assert.deepEqual(final.replays, save.replays, 'starting other routes must not rewrite the archive');
    assert.ok(Buffer.byteLength(JSON.stringify(final.replays), 'utf8') <= 24000);
    assert.ok(Buffer.byteLength(JSON.stringify(final), 'utf8') <= 65536);
  }, { save });
});

test('ghost setting survives reload, hides only the visualization and preserves the stored trace', async () => {
  const save = initialSave();
  save.replays = [recordedTrack(require('../web/levels.js')[0])];
  await checkBrowser(async page => {
    assert.equal((await snapshot(page)).ghostEnabled, true);
    await tap(page, '#home [data-do="settings"]');
    await tap(page, '#modal [data-do="ghostEnabled"]');
    assert.equal((await snapshot(page)).ghostEnabled, false);
    await page.reload();
    await page.clock.runFor(32);
    assert.equal((await snapshot(page)).ghostEnabled, false);
    await startCampaign(page);
    assert.equal((await snapshot(page)).ghost.available, true);
    assert.equal((await snapshot(page)).ghost.visible, false);
    const archive = (await rawSave(page)).replays;
    await page.reload();
    await page.clock.runFor(32);
    await tap(page, '#home [data-do="settings"]');
    await tap(page, '#modal [data-do="ghostEnabled"]');
    await tap(page, '#modal .primary-button[data-do="close"]');
    await startCampaign(page);
    assert.equal((await snapshot(page)).ghost.available, true);
    assert.equal((await snapshot(page)).ghost.visible, true);
    assert.deepEqual((await rawSave(page)).replays, archive);
  }, { save });
});
