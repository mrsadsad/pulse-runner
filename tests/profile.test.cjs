'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../web/engine.js');
const C=require('../web/challenges.js');
const R=require('../web/replay.js');
const P=require('../web/profile.js');
const levels=require('../web/levels.js');

function recorded(level){
  const recorder=new R.Recorder(R.keyFor(level));
  const run=new E.Run(level,{onUpdate:state=>recorder.observe(state)});
  for(const input of level.solution){run.step(input.t-run.time);run.action(input.action);}
  run.step(level.duration-run.time+.01);
  assert.equal(run.status,'won');
  return {run,track:recorder.track(run)};
}

test('old progress and every existing setting survive the profile migration',()=>{
  const old=E.emptySave();E.recordRun(old,recorded(levels[0]).run);
  old.sound=false;old.music=false;old.effects=false;old.vibration=false;
  const raw=JSON.stringify(old),save=P.cleanSave(old);
  assert.deepEqual(E.cleanSave(save),old);
  assert.deepEqual(save.equipped,{skin:'pulse',trail:'classic'});
  assert.equal(save.ghostEnabled,true);assert.deepEqual(save.replays,[]);
  assert.equal(JSON.stringify(old),raw);
});

test('earned appearance and recorded trace persist together through JSON and game results',()=>{
  let save=P.cleanSave(null);const {run,track}=recorded(levels[0]);
  E.recordRun(save,run);save.equipped.skin='spark';save.ghostEnabled=false;
  save.replays=R.store(save.replays,track);
  save=P.cleanSave(JSON.parse(JSON.stringify(save)));
  assert.equal(save.equipped.skin,'spark');assert.equal(save.ghostEnabled,false);
  assert.equal(save.replays[0].score,run.score);
  const failed=new E.Run(levels[0]);failed.step(30);E.recordRun(save,failed);
  const reread=P.cleanSave(save);
  assert.deepEqual(reread.replays,save.replays);assert.deepEqual(reread.equipped,save.equipped);
  assert.equal(reread.records[1].attempts,2);
});

test('corrupt optional data cannot unlock cosmetics or damage valid scores',()=>{
  const raw={records:{1:{stars:3,progress:1,bestScore:5000,attempts:4}},unlocked:2,
    equipped:{skin:'crown',trail:'spark'},ghostEnabled:'false',replays:[{version:1,key:'campaign:1',frames:'bad'}]};
  const save=P.cleanSave(raw);
  assert.equal(save.records[1].bestScore,5000);assert.equal(save.unlocked,2);
  assert.deepEqual(save.equipped,{skin:'pulse',trail:'classic'});
  assert.equal(save.ghostEnabled,true);assert.deepEqual(save.replays,[]);
  for(const invalid of [null,undefined,[],7,'bad'])assert.equal(P.cleanSave(invalid).unlocked,1);
});

test('maximal game records plus a saturated replay archive fit the native 65536 character limit',()=>{
  const raw=E.emptySave(),record={stars:3,gems:999999999,progress:1,attempts:999999999,wins:999999999,bestScore:999999999,bestCombo:999999999,bestBonus:999999999};
  for(let id=1;id<=15;id++){
    raw.records[id]={...record};raw.trialRecords[id]={...record};
    for(const mode of C.MODES)raw.challengeRecords[id+'-'+mode.id]={...record,baseId:id,mode:mode.id};
  }
  for(let i=0;i<60;i++){
    const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),daily=C.makeDaily(date);
    raw.dailyRecords[date]={...record,baseId:daily.baseId,mode:daily.mode};
  }
  raw.endlessRecord={attempts:999999999,bestScore:999999999,bestDistance:999999999,bestTime:999999999,bestCombo:999999999,bestBonus:999999999,bestStage:999999999};
  raw.replays=[];
  for(let id=10;id<=15;id++)raw.replays=R.store(raw.replays,recorded(levels[id-1]).track);
  raw.equipped={skin:'crown',trail:'comet'};
  const save=P.cleanSave(raw),size=JSON.stringify(save).length;
  assert.ok(JSON.stringify(save.replays).length>15000,'exercise substantial real operation data');
  assert.ok(JSON.stringify(save.replays).length<=24000);
  assert.ok(size<65536,'native save budget: '+size);
  assert.equal(Object.keys(save.dailyRecords).length,60);
  assert.equal(Object.keys(save.records).length,15);
  assert.equal(save.equipped.skin,'crown');
  assert.deepEqual(P.cleanSave(JSON.parse(JSON.stringify(save))),save);
});
