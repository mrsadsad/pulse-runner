const test=require('node:test');
const assert=require('node:assert/strict');
const Challenges=require('../web/challenges.js');
const goals=save=>Object.fromEntries(Challenges.getGoals(save).map(goal=>[goal.id,goal]));
test('trial wins earn first win and combo goals without crediting campaign or mirror goals',()=>{
  const result=goals({trialRecords:{15:{wins:1,bestCombo:50,stars:3}}});
  for(const id of ['firstwin','combo20','combo50'])assert.equal(result[id].unlocked,true,id);
  for(const id of ['fivewins','allwins','stars15','stars45','mirror5','rush5','daily3'])assert.equal(result[id].current,0,id);
});
test('endless records credit combo milestones, never a finite-stage win or campaign stars',()=>{
  const result=goals({endlessRecord:{attempts:4,bestCombo:50,bestDistance:8000,bestScore:120000}});
  assert.equal(result.combo50.unlocked,true);
  assert.equal(result.firstwin.unlocked,false);
  assert.equal(result.stars15.current,0);
  assert.equal(result.allwins.current,0);
});
