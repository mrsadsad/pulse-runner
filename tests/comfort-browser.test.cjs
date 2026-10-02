'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
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
  return {
    version: 1, unlocked: 2, sound: false, music: false, vibration: false, effects: true, attempts: 3,
    records: { 1: { stars: 2, gems: 12, progress: 1, attempts: 3, bestScore: 4000, bestCombo: 12 } },
  };
}
function incomingSave() {
  return {
    version: 1, unlocked: 3, sound: true, music: true, vibration: true, effects: false, attempts: 9,
    records: {
      1: { stars: 1, gems: 5, progress: 1, attempts: 5, bestScore: 3000, bestCombo: 5 },
      2: { stars: 3, gems: 15, progress: 1, attempts: 2, bestScore: 6000, bestCombo: 15 },
    },
    equipped: { skin: 'spark', trail: 'classic' }, ghostEnabled: false,
    controls: { layout: 'left', size: 'large', lift: 32, sensitivity: 'steady', gestures: false, tapJump: false },
  };
}
function backupText(save = incomingSave()) {
  return require('../web/backup.js').exportSave(save, '2026-09-21T12:00:00.000Z');
}
function scoresOnly(save) {
  const { unlocked, attempts, records, challengeRecords, dailyRecords, trialRecords, endlessRecord } = require('../web/engine.js').cleanSave(save);
  return { unlocked, attempts, records, challengeRecords, dailyRecords, trialRecords, endlessRecord };
}
async function checkBrowser(check, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai', acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, { key: saveKey, value: options.save || initialSave() });
  if (options.beforeLoad) await options.beforeLoad(page);
  const epoch = new Date('2026-09-22T00:00:00.000Z');
  await page.clock.install({ time: epoch });
  await page.clock.pauseAt(new Date(epoch.valueOf() + 1000));
  try {
    await page.goto(entry);
    await page.clock.runFor(32);
    await check(page);
    assert.deepEqual(errors, [], 'the application must not throw browser errors');
  } catch (error) {
    await capture(page, 'browser-v15-last-failure.png');
    throw error;
  } finally { await context.close(); }
}
async function snapshot(page) { return page.evaluate(() => window.PulseGame.snapshot()); }
async function rawSave(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), saveKey); }
async function saveText(page) { return page.evaluate(key => localStorage.getItem(key), saveKey); }
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
async function capture(page, filename) {
  await page.screenshot({ path: path.resolve(__dirname, '../qa/' + filename), animations: 'disabled' });
}
async function startCampaign(page, id = 1) {
  await tap(page, '#home [data-do="levels"]');
  await tap(page, `[data-level="${id}"]`);
  await tap(page, '#modal [data-do="start"]');
  await awaitRunning(page);
}
async function swipe(page, selector, dx, dy = 0) {
  await page.locator(selector).evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width > Math.abs(dx) && box.height > Math.abs(dy));
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy, id: 1 }] });
  await page.clock.runFor(32);
  const during = await snapshot(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.clock.runFor(32);
  await client.detach();
  return during;
}
async function downloadedText(download) {
  const failure = await download.failure();
  assert.equal(failure, null);
  return fs.readFile(await download.path(), 'utf8');
}
async function openSettingsPage(page, action) {
  await tap(page, '#home [data-do="settings"]');
  await tap(page, `#modal [data-do="${action}"]`);
}
async function previewText(page, text = backupText()) {
  await page.locator('#backupImportText').fill(text);
  await tap(page, '#backupPage [data-do="previewBackup"]');
  assert.equal((await snapshot(page)).modal, 'importPreview');
}
async function previewFile(page, text = backupText(), name = 'progress.json') {
  await page.locator('#backupFile').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
  await page.locator('#modal [data-do="confirmImport"]').waitFor({ state: 'visible' });
  assert.equal((await snapshot(page)).modal, 'importPreview');
}
async function pausedControls(page) {
  await tap(page, '#play [data-do="pause"]');
  await page.locator('#modal [data-do="resume"]').waitFor({ state: 'visible' });
  const paused = await snapshot(page);
  assert.equal(paused.modal, 'pause', JSON.stringify(paused));
  await tap(page, '#modal [data-do="controls"]');
  assert.equal((await snapshot(page)).screen, 'controlsPage');
  assert.equal((await snapshot(page)).time, paused.time);
  return paused;
}
async function resumeFromControls(page, paused) {
  await tap(page, '#controlsPage .primary-button[data-do="controlsBack"]');
  assert.equal((await snapshot(page)).modal, 'pause');
  assert.equal((await snapshot(page)).phase, 'paused');
  assert.equal((await snapshot(page)).time, paused.time);
  await tap(page, '#modal [data-do="resume"]');
  await awaitRunning(page);
}
async function gameButtons(page) {
  return page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#play [data-action]')).map(button => {
    const b = button.getBoundingClientRect(), hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return [button.dataset.action, { x: b.x, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height, reachable: hit === button || button.contains(hit) }];
  })));
}

test('phone layouts, larger raised buttons and the touch lab persist without changing scores or a paused run', async () => checkBrowser(async page => {
  const before = scoresOnly(await rawSave(page));
  await startCampaign(page);
  const defaults = await gameButtons(page);
  const defaultCanvasHeight = await page.locator('#gameCanvas').evaluate(canvas => canvas.height);
  assert.ok(defaults.left.x < defaults.jump.x && defaults.jump.x < defaults.right.x);
  let paused = await pausedControls(page);
  await page.locator('#controlLayout').selectOption('left');
  await page.locator('#controlSize').selectOption('large');
  await page.locator('#controlLift').selectOption('32');
  await page.locator('#controlsPage').evaluate(element => { element.scrollTop = 0; });
  await page.clock.runFor(32);
  await capture(page, 'browser-v15-controls-top-360.png');
  await tap(page, '[data-lab-action="left"]');
  assert.equal((await snapshot(page)).labLane, 0);
  await swipe(page, '#controlLab', 45);
  assert.equal((await snapshot(page)).labLane, 1);
  await tap(page, '[data-lab-action="jump"]');
  assert.match(await page.locator('#labFeedback').textContent(), /起跳.*不计成绩/);
  assert.deepEqual(scoresOnly(await rawSave(page)), before);
  await capture(page, 'browser-v15-touch-lab.png');
  await resumeFromControls(page, paused);
  const left = await gameButtons(page);
  assert.ok(left.jump.x < left.left.x && left.left.x < left.right.x);
  assert.ok(left.jump.height > defaults.jump.height);
  assert.ok(left.jump.bottom <= defaults.jump.bottom - 31);
  const canvasSize = await page.locator('#gameCanvas').evaluate(canvas => ({ pixels: canvas.height, height: canvas.getBoundingClientRect().height }));
  assert.ok(canvasSize.pixels < defaultCanvasHeight - 40, 'raising and enlarging controls must reduce and resize the actual drawing canvas');
  assert.ok(Math.abs(canvasSize.pixels - canvasSize.height) <= 1);
  for (const button of Object.values(left)) assert.ok(button.reachable && button.width >= 44 && button.height >= 44 && button.x >= 0 && button.right <= 360.01 && button.bottom <= 640.01);
  await capture(page, 'browser-v15-left-large-raised-360.png');
  paused = await pausedControls(page);
  await page.locator('#controlLayout').selectOption('right');
  await resumeFromControls(page, paused);
  const right = await gameButtons(page);
  assert.ok(right.left.x < right.right.x && right.right.x < right.jump.x);
  await tap(page, '#play [data-action="jump"]');
  await page.clock.runFor(64);
  assert.ok((await snapshot(page)).jumpHeight > 0);
  const controls = (await snapshot(page)).controls;
  assert.deepEqual(scoresOnly(await rawSave(page)), before);
  await page.reload();
  await page.clock.runFor(32);
  assert.deepEqual((await snapshot(page)).controls, controls);
  assert.deepEqual(scoresOnly(await rawSave(page)), before);
}, { viewport: { width: 360, height: 640 } }));

test('actual swipes obey sensitivity and button-only mode while tap-to-jump remains independently configurable', async () => checkBrowser(async page => {
  const before = scoresOnly(await rawSave(page));
  await startCampaign(page);
  let paused = await pausedControls(page);
  await tap(page, '#tapJumpToggle');
  await resumeFromControls(page, paused);
  await swipe(page, '#gameCanvas', 18);
  assert.equal((await snapshot(page)).lane, 1);
  assert.equal((await snapshot(page)).jumpHeight, 0);
  paused = await pausedControls(page);
  await page.locator('#controlSensitivity').selectOption('sensitive');
  await resumeFromControls(page, paused);
  const during = await swipe(page, '#gameCanvas', 18);
  assert.equal(during.lane, 2, 'sensitive swipe responds before the finger is released');
  await page.clock.runFor(150);
  await tap(page, '#play [data-action="left"]');
  await page.clock.runFor(150);
  paused = await pausedControls(page);
  await page.locator('#controlSensitivity').selectOption('steady');
  await resumeFromControls(page, paused);
  await swipe(page, '#gameCanvas', 30);
  assert.equal((await snapshot(page)).lane, 1);
  await swipe(page, '#gameCanvas', 40);
  assert.equal((await snapshot(page)).lane, 2);
  await page.clock.runFor(150);
  await tap(page, '#play [data-action="left"]');
  await page.clock.runFor(150);
  paused = await pausedControls(page);
  await tap(page, '#gesturesToggle');
  assert.equal(await page.locator('#tapJumpToggle').isDisabled(), true);
  assert.equal(await page.locator('#controlSensitivity').isDisabled(), true);
  await resumeFromControls(page, paused);
  await swipe(page, '#gameCanvas', 90);
  await tap(page, '#gameCanvas');
  await page.clock.runFor(64);
  assert.equal((await snapshot(page)).lane, 1);
  assert.equal((await snapshot(page)).jumpHeight, 0);
  await tap(page, '#play [data-action="right"]');
  await page.clock.runFor(150);
  assert.equal((await snapshot(page)).lane, 2, 'buttons remain functional with gestures disabled');
  await tap(page, '#play [data-action="left"]');
  await page.clock.runFor(150);
  paused = await pausedControls(page);
  await tap(page, '#gesturesToggle');
  await resumeFromControls(page, paused);
  await tap(page, '#gameCanvas');
  await page.clock.runFor(64);
  assert.equal((await snapshot(page)).jumpHeight, 0, 'tap jump remains independently disabled');
  await swipe(page, '#gameCanvas', 0, -45);
  await page.clock.runFor(64);
  assert.ok((await snapshot(page)).jumpHeight > 0, 'upward swipe still jumps');
  await page.clock.runFor(850);
  paused = await pausedControls(page);
  await tap(page, '#tapJumpToggle');
  await resumeFromControls(page, paused);
  await tap(page, '#gameCanvas');
  await page.clock.runFor(64);
  assert.ok((await snapshot(page)).jumpHeight > 0);
  assert.deepEqual(scoresOnly(await rawSave(page)), before);
  const controls = (await snapshot(page)).controls;
  await page.reload();
  await page.clock.runFor(32);
  assert.deepEqual((await snapshot(page)).controls, controls);
}));

test('browser export creates a valid JSON download and file preview or cancellation never writes progress', async () => checkBrowser(async page => {
  const Backup = require('../web/backup.js');
  const before = await saveText(page);
  await openSettingsPage(page, 'backup');
  await capture(page, 'browser-v15-backup-top.png');
  const downloadPromise = page.waitForEvent('download');
  await tap(page, '#backupPage [data-do="exportBackup"]');
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^PulseRunner-backup-\d{8}\.json$/);
  const exported = await downloadedText(download);
  const parsed = Backup.inspect(exported);
  assert.equal(parsed.legacy, false);
  assert.deepEqual(scoresOnly(parsed.save), scoresOnly(JSON.parse(before)));
  assert.equal(await saveText(page), before, 'export must not rewrite the current save');
  await previewFile(page, backupText(), '<img src=x onerror=alert(1)>.json');
  assert.equal(await saveText(page), before, 'reading a file is only a preview');
  assert.equal(await page.locator('#modal img').count(), 0);
  assert.match(await page.locator('#importOutcome').textContent(), /合并后/);
  await capture(page, 'browser-v15-import-preview.png');
  await page.locator('#importMode').selectOption('replace');
  assert.match(await page.locator('#importWarning').textContent(), /减少当前进度/);
  assert.equal(await saveText(page), before, 'changing the proposed import mode must not save');
  await tap(page, '#modal [data-do="cancelImport"]');
  assert.equal((await snapshot(page)).modal, '');
  assert.equal(await saveText(page), before);
}));

test('merge keeps better scores and local controls; replace applies the backup and recovery survives reload', async () => checkBrowser(async page => {
  const original = await rawSave(page);
  await openSettingsPage(page, 'backup');
  await previewText(page);
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.equal((await snapshot(page)).modal, '');
  const merged = await rawSave(page);
  assert.equal(merged.records[1].stars, 2);
  assert.equal(merged.records[1].bestScore, 4000);
  assert.equal(merged.records[1].attempts, 5, 'merge uses maximum attempt counts, not addition');
  assert.equal(merged.records[2].stars, 3);
  assert.equal(merged.attempts, 9);
  assert.equal(merged.unlocked, 3);
  assert.equal(merged.sound, false);
  assert.equal(merged.controls.layout, 'center');
  assert.deepEqual(merged.equipped, { skin: 'pulse', trail: 'classic' });
  assert.equal(await page.locator('#restoreBackup').isDisabled(), false);
  await page.reload();
  await page.clock.runFor(32);
  await openSettingsPage(page, 'backup');
  await tap(page, '#restoreBackup');
  assert.match(await page.locator('#importWarning').textContent(), /替换当前进度/);
  assert.deepEqual(scoresOnly(await rawSave(page)), scoresOnly(merged), 'opening recovery remains a preview');
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.deepEqual(scoresOnly(await rawSave(page)), scoresOnly(original));
  assert.equal(await page.locator('#restoreBackup').isDisabled(), true);
  await previewText(page);
  await page.locator('#importMode').selectOption('replace');
  await tap(page, '#modal [data-do="confirmImport"]');
  const replaced = await rawSave(page);
  assert.equal(replaced.records[1].stars, 1);
  assert.equal(replaced.records[1].bestScore, 3000);
  assert.equal(replaced.sound, true);
  assert.deepEqual(replaced.controls, incomingSave().controls);
  assert.deepEqual(replaced.equipped, incomingSave().equipped);
  await capture(page, 'browser-v15-import-complete.png');
  await tap(page, '#restoreBackup');
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.deepEqual(scoresOnly(await rawSave(page)), scoresOnly(original));
  assert.equal((await rawSave(page)).controls.layout, 'center');
  assert.equal((await snapshot(page)).sound, false);
}));

test('invalid backup text is rejected and storage failure cannot report success or consume the recovery point', async () => checkBrowser(async page => {
  const before = await saveText(page);
  await openSettingsPage(page, 'backup');
  const broken = JSON.parse(backupText());
  broken.payload.unlocked = 15;
  for (const text of ['<img src=x onerror=alert(1)>', '{}', JSON.stringify(broken)]) {
    await page.locator('#backupImportText').fill(text);
    await tap(page, '#backupPage [data-do="previewBackup"]');
    assert.equal((await snapshot(page)).modal, '');
    assert.match(await page.locator('#backupStatus').getAttribute('class'), /error/);
    assert.equal(await saveText(page), before);
    assert.equal(await page.locator('#backupPage img').count(), 0);
  }
  await previewText(page);
  const visibleBefore = await snapshot(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    window.__restoreStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Simulated full storage', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, saveKey);
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.equal((await snapshot(page)).modal, 'importPreview');
  assert.match(await page.locator('#importError').textContent(), /写入失败|无法保存/);
  assert.equal(await saveText(page), before);
  assert.equal((await snapshot(page)).unlocked, visibleBefore.unlocked);
  assert.equal((await snapshot(page)).stars, visibleBefore.stars);
  assert.equal(await page.evaluate(() => localStorage.getItem('pulse-runner-recovery-v1')), null, 'failed import must roll back its tentative recovery point');
  await page.evaluate(() => window.__restoreStorage());
  await tap(page, '#modal [data-do="cancelImport"]');
  assert.equal(await page.locator('#restoreBackup').isDisabled(), true);
}));

test('readback failures roll back a verified save or retain recovery when the outcome cannot be verified', async () => checkBrowser(async page => {
  const before = await saveText(page);
  await openSettingsPage(page, 'backup');
  for (const persistent of [false, true]) {
    await previewText(page);
    await page.evaluate(({ key, persistent }) => {
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      let armed = true, readFault = false;
      window.__restoreStorage = () => { Storage.prototype.getItem = get; Storage.prototype.setItem = set; };
      window.__rawPrimary = () => get.call(localStorage, key);
      Storage.prototype.setItem = function (name, value) {
        const result = set.call(this, name, value);
        if (name === key && armed) { armed = false; readFault = true; }
        return result;
      };
      Storage.prototype.getItem = function (name) {
        if (name === key && readFault) {
          if (!persistent) readFault = false;
          throw new DOMException('Simulated unreadable storage', 'SecurityError');
        }
        return get.call(this, name);
      };
    }, { key: saveKey, persistent });
    await tap(page, '#modal [data-do="confirmImport"]');
    assert.equal((await snapshot(page)).modal, 'importPreview');
    assert.equal((await snapshot(page)).unlocked, 2);
    assert.equal((await snapshot(page)).stars, 2);
    const warning = await page.locator('#importError').textContent();
    const recovery = await page.evaluate(() => localStorage.getItem('pulse-runner-recovery-v1'));
    if (persistent) {
      assert.match(warning, /无法确认/);
      assert.ok(recovery, 'uncertain write result must retain the pre-import recovery snapshot');
      assert.deepEqual(scoresOnly(JSON.parse(recovery)), scoresOnly(JSON.parse(before)));
      assert.equal(await page.locator('#restoreBackup').isDisabled(), false);
    } else {
      assert.match(warning, /写入失败|恢复原/);
      assert.equal(await page.evaluate(() => window.__rawPrimary()), before);
      assert.equal(recovery, null);
    }
    await page.evaluate(() => window.__restoreStorage());
    await tap(page, '#modal [data-do="cancelImport"]');
    if (persistent) {
      await tap(page, '#restoreBackup');
      await tap(page, '#modal [data-do="confirmImport"]');
      assert.deepEqual(scoresOnly(await rawSave(page)), scoresOnly(JSON.parse(before)));
      assert.equal(await page.locator('#restoreBackup').isDisabled(), true);
    }
  }
}));

test('a preview cannot overwrite progress changed by another window before confirmation', async () => checkBrowser(async page => {
  await openSettingsPage(page, 'backup');
  await previewText(page);
  const external = initialSave();
  external.records[1].stars = 3;
  external.records[1].bestScore = 9000;
  const changed = JSON.stringify(external);
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), { key: saveKey, text: changed });
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.match(await page.locator('#importError').textContent(), /已变化/);
  assert.equal((await snapshot(page)).modal, 'importPreview');
  assert.equal(await saveText(page), changed);
  assert.equal(await page.evaluate(() => localStorage.getItem('pulse-runner-recovery-v1')), null);
}));

test('mock native file results preview without applying data and failed native commits preserve both saves', async () => checkBrowser(async page => {
  await openSettingsPage(page, 'backup');
  const nativeBefore = await page.evaluate(() => NativeGame.getSave());
  const browserBefore = await saveText(page);
  await tap(page, '#backupPage [data-do="exportBackup"]');
  assert.equal((await snapshot(page)).backupBusy, true);
  const sent = await page.evaluate(() => window.__nativeCalls[0]);
  assert.equal(sent.kind, 'export');
  assert.equal(require('../web/backup.js').inspect(sent.text).legacy, false);
  assert.doesNotMatch(await page.locator('#backupStatus').textContent(), /已保存|已导出/);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nativeBackup', { detail: { kind: 'export', status: 'cancel' } })));
  assert.equal((await snapshot(page)).backupBusy, false);
  assert.match(await page.locator('#backupStatus').textContent(), /已取消/);
  await tap(page, '#backupPage [data-do="exportBackup"]');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nativeBackup', { detail: { kind: 'export', status: 'error', message: '模拟文件写入失败' } })));
  assert.match(await page.locator('#backupStatus').textContent(), /模拟文件写入失败/);
  assert.match(await page.locator('#backupStatus').getAttribute('class'), /error/);
  await tap(page, '#backupPage [data-do="chooseBackup"]');
  assert.equal((await snapshot(page)).backupBusy, true);
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('nativeBackup', { detail: { kind: 'import', status: 'ok', text } })), backupText());
  assert.equal((await snapshot(page)).modal, 'importPreview');
  assert.equal(await page.evaluate(() => NativeGame.getSave()), nativeBefore);
  assert.equal(await saveText(page), browserBefore);
  await page.evaluate(() => { window.__rejectRecovery = true; });
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.match(await page.locator('#importError').textContent(), /恢复点/);
  assert.equal(await page.evaluate(() => window.__commitCalls), 0);
  await page.evaluate(() => { window.__rejectRecovery = false; window.__rejectCommit = true; });
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.match(await page.locator('#importError').textContent(), /写入失败/);
  assert.equal(await page.evaluate(() => NativeGame.getSave()), nativeBefore);
  assert.equal(await page.evaluate(() => NativeGame.getRecovery()), '');
  assert.equal(await saveText(page), browserBefore);
  assert.equal((await snapshot(page)).unlocked, 2);
  assert.equal((await snapshot(page)).stars, 2);
  await page.evaluate(() => { window.__rejectCommit = false; });
  await tap(page, '#modal [data-do="confirmImport"]');
  assert.equal((await snapshot(page)).modal, '');
  assert.match(await page.locator('#backupStatus').textContent(), /导入完成/);
  const nativeAfter = await page.evaluate(() => NativeGame.getSave());
  assert.equal(nativeAfter, await saveText(page), 'the native save and browser mirror agree after confirmed commit');
  assert.equal(JSON.parse(nativeAfter).unlocked, 3);
}, { beforeLoad: async page => {
  await page.addInitScript(save => {
    const currentKey = 'qa-native-save', undoKey = 'qa-native-recovery';
    if (!sessionStorage.getItem(currentKey)) sessionStorage.setItem(currentKey, JSON.stringify(save));
    window.__nativeCalls = [];
    window.__commitCalls = 0;
    window.__rejectCommit = false;
    window.__rejectRecovery = false;
    window.NativeGame = {
      getSave: () => sessionStorage.getItem(currentKey) || '',
      setSave: text => sessionStorage.setItem(currentKey, text),
      commitSave: text => { window.__commitCalls++; if (window.__rejectCommit) return false; sessionStorage.setItem(currentKey, text); return true; },
      getRecovery: () => sessionStorage.getItem(undoKey) || '',
      setRecovery: text => { if (window.__rejectRecovery) return false; sessionStorage.setItem(undoKey, text); return true; },
      exportBackup: text => window.__nativeCalls.push({ kind: 'export', text }),
      importBackup: () => window.__nativeCalls.push({ kind: 'import' }),
    };
  }, initialSave());
} }));
