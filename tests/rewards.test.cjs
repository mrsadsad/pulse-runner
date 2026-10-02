'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Rewards = require('../web/rewards.js');
const Challenges = require('../web/challenges.js');
const Engine = require('../web/engine.js');

test('catalog contains two defaults and one cosmetic reward for each achievement', () => {
  assert.equal(Rewards.CATALOG.length, 12);
  assert.equal(Rewards.CATALOG.filter(item => !item.goal).length, 2);
  assert.equal(Rewards.CATALOG.filter(item => item.kind === 'skin').length, 6);
  assert.equal(Rewards.CATALOG.filter(item => item.kind === 'trail').length, 6);
  assert.equal(new Set(Rewards.CATALOG.map(item => item.id)).size, 12);
  assert.deepEqual(Rewards.CATALOG.filter(item => item.goal).map(item => item.goal).sort(), Challenges.getGoals({}).map(goal => goal.id).sort());
  assert.ok(Object.isFrozen(Rewards.CATALOG));
  Rewards.CATALOG.forEach(item => assert.ok(Object.isFrozen(item)));
});

test('fresh and legacy saves use the original ship and trail, without early unlocks', () => {
  for (const save of [undefined, null, {}, Engine.emptySave()]) {
    const items = Rewards.getItems(save);
    assert.deepEqual(items.filter(item => item.unlocked).map(item => item.id), ['pulse', 'classic']);
    assert.deepEqual(items.filter(item => item.equipped).map(item => item.id), ['pulse', 'classic']);
  }
});

test('existing campaign progress grants rewards without replaying completed goals', () => {
  const save = { records: {}, equipped: { skin: 'spark', trail: 'twin' } };
  for (let id = 1; id <= 5; id++) save.records[id] = { stars: 3, bestCombo: 20 };
  const items = Rewards.getItems(save);
  for (const id of ['spark', 'twin', 'prism', 'dots']) assert.ok(items.find(item => item.id === id).unlocked, id);
  for (const id of ['crown', 'aurora', 'comet', 'kite', 'ribbon', 'echo']) assert.equal(items.find(item => item.id === id).unlocked, false, id);
  assert.deepEqual(items.filter(item => item.equipped).map(item => item.id), ['spark', 'twin']);
});

test('partial progress remains locked and reports the achievement target', () => {
  const item = Rewards.getItems({ goalProgress: { combo50: 49 } }).find(item => item.id === 'comet');
  assert.equal(item.unlocked, false);
  assert.equal(item.current, 49);
  assert.equal(item.target, 50);
  assert.deepEqual(Rewards.cleanEquipped({ trail: 'comet' }, { goalProgress: { combo50: 49 } }), { skin: 'pulse', trail: 'classic' });
});

test('persistent achievement progress retains unlocks after bounded daily history rotates', () => {
  const save = { dailyRecords: {}, goalProgress: { daily3: 3 }, equipped: { skin: 'pulse', trail: 'echo' } };
  assert.deepEqual(Rewards.cleanEquipped(save.equipped, save), save.equipped);
  const item = Rewards.getItems(save).find(item => item.id === 'echo');
  assert.ok(item.unlocked && item.equipped);
});

test('unlocked outfits validate kind and reject unknown, locked or malformed choices', () => {
  const save = { goalProgress: { firstwin: 1, fivewins: 5 } };
  assert.deepEqual(Rewards.cleanEquipped({ skin: 'spark', trail: 'twin' }, save), { skin: 'spark', trail: 'twin' });
  for (const raw of [null, 'spark', {}, { skin: 'twin', trail: 'spark' }, { skin: 'crown', trail: 'echo' }, { skin: '__proto__', trail: '<script>' }]) {
    assert.deepEqual(Rewards.cleanEquipped(raw, save), { skin: 'pulse', trail: 'classic' });
  }
  assert.deepEqual(Rewards.cleanEquipped({ skin: 'spark', trail: 'missing' }, save), { skin: 'spark', trail: 'classic' });
});

test('each achievement independently unlocks its assigned reward', () => {
  for (const goal of Challenges.getGoals({})) {
    const save = { goalProgress: { [goal.id]: goal.target } };
    const unlocked = Rewards.getItems(save).filter(item => item.unlocked && item.goal);
    assert.equal(unlocked.length, 1, goal.id);
    assert.equal(unlocked[0].goal, goal.id);
  }
});

test('trial wins and endless combo progress grant the existing achievement rewards', () => {
  const trial = Rewards.getItems({ trialRecords: { 4: { wins: 1 } } });
  assert.ok(trial.find(item => item.id === 'spark').unlocked);
  const endless = Rewards.getItems({ endlessRecord: { bestCombo: 50 } });
  assert.ok(endless.find(item => item.id === 'comet').unlocked);
  assert.ok(endless.find(item => item.id === 'dots').unlocked);
  assert.equal(endless.find(item => item.id === 'spark').unlocked, false);
});

test('appearance resolves catalog entries with safe defaults and no save mutation', () => {
  const save = { goalProgress: { firstwin: 1 }, equipped: { skin: 'spark', trail: 'classic' } };
  const before = JSON.stringify(save);
  const look = Rewards.appearance(Rewards.cleanEquipped(save.equipped, save));
  assert.equal(look.skin.id, 'spark');
  assert.equal(look.trail.id, 'classic');
  assert.deepEqual(Rewards.appearance({ skin: 'twin', trail: 'spark' }), Rewards.appearance(null));
  const items = Rewards.getItems(save); items[0].name = 'changed';
  assert.equal(Rewards.CATALOG[0].name, '原初脉冲');
  assert.equal(JSON.stringify(save), before);
  assert.equal('speed' in look.skin, false);
});
