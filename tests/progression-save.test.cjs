const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../web/engine.js');
const C=require('../web/challenges.js');
const levels=require('../web/levels.js');
function win(level,options){
  const run=new E.Run(level,options);
  for(const input of level.solution){run.step(input.t-run.time);run.action(input.action);}
  run.step(level.duration-run.time+.01);assert.equal(run.status,'won');return run;
}
test('campaign, three variants and daily results occupy separate records',()=>{
  const save=E.emptySave();E.recordRun(save,win(levels[0]));
  const before=JSON.stringify(save.records),attempts=save.attempts;
  for(const mode of ['mirror','rush','mirrorRush']){
    const l=C.makeLevel(15,mode);E.recordRun(save,win(l));
    assert.equal(E.getRecord(save,l).wins,1);assert.equal(E.getRecord(save,l).stars,3);
  }
  const daily=C.makeDaily('2026-09-22').level;E.recordRun(save,win(daily));
  assert.equal(save.dailyRecords['2026-09-22'].wins,1);
  assert.equal(save.unlocked,2);assert.equal(save.attempts,attempts);assert.equal(JSON.stringify(save.records),before);
  assert.equal(Object.keys(save.challengeRecords).length,3);
  assert.deepEqual(E.cleanSave(JSON.parse(JSON.stringify(save))),save);
});
test('normal route shared as code is a challenge, not a campaign shortcut',()=>{
  const save=E.emptySave();const level=C.makeLevel(15,'normal');E.recordRun(save,win(level));
  assert.equal(save.unlocked,1);assert.deepEqual(save.records,{});assert.equal(save.challengeRecords['15-normal'].wins,1);
});
test('practice in challenge and daily modes never records rewards',()=>{
  const save=E.emptySave();const snapshot=JSON.stringify(save);
  for(const level of [C.makeLevel(5,'rush'),C.makeDaily('2026-09-22').level])E.recordRun(save,win(level,{practice:true}));
  assert.equal(JSON.stringify(save),snapshot);
});
test('challenge retry keeps best score and increases only its own attempts',()=>{
  const save=E.emptySave(),level=C.makeLevel(1,'mirror');
  const won=win(level);E.recordRun(save,won);const best=won.score;
  const failed=new E.Run(level);failed.step(level.duration);assert.equal(failed.status,'failed');E.recordRun(save,failed);
  const record=save.challengeRecords['1-mirror'];assert.equal(record.wins,1);assert.equal(record.attempts,2);assert.equal(record.bestScore,best);assert.equal(record.stars,3);
});
test('daily date is taken from the run, never the current wall clock',()=>{
  const save=E.emptySave();const old=C.makeDaily('2020-02-29').level;E.recordRun(save,win(old));
  assert.deepEqual(Object.keys(save.dailyRecords),['2020-02-29']);
});
test('malformed challenge keys, dates, numbers and goals are sanitized',()=>{
  const record={baseId:1,mode:'mirror',wins:Infinity,attempts:-4,stars:50,bestScore:NaN};
  const save=E.cleanSave({challengeRecords:{'1-mirror':record,'16-rush':record,'1-hax':record},dailyRecords:{'2026-02-30':record,'2024-02-29':record},goalProgress:{firstwin:Infinity,stars45:900,combo20:-1,extra:5}});
  assert.deepEqual(Object.keys(save.challengeRecords),['1-mirror']);assert.equal(save.challengeRecords['1-mirror'].wins,0);assert.equal(save.challengeRecords['1-mirror'].stars,3);
  assert.deepEqual(Object.keys(save.dailyRecords),['2024-02-29']);assert.deepEqual(save.goalProgress,{stars45:45});
});
test('daily record retention is bounded but previously earned goals survive',()=>{
  const raw=E.emptySave();
  for(let i=0;i<80;i++){
    const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),d=C.makeDaily(date);
    raw.dailyRecords[date]={baseId:d.baseId,mode:d.mode,wins:i<3?1:0};
  }
  raw.goalProgress={daily3:3};const save=E.cleanSave(raw);
  assert.equal(Object.keys(save.dailyRecords).length,60);assert.equal(C.getGoals(save).find(g=>g.id==='daily3').unlocked,true);
  assert.ok(JSON.stringify(save).length<65536);
});
test('all valid challenge buckets and sixty daily entries fit native storage limit',()=>{
  const raw=E.emptySave(),r={stars:3,gems:64,progress:1,attempts:999999999,wins:999999999,bestScore:999999999,bestCombo:64};
  for(let id=1;id<=15;id++)for(const m of C.MODES)raw.challengeRecords[id+'-'+m.id]={...r,baseId:id,mode:m.id};
  for(let i=0;i<60;i++){const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),d=C.makeDaily(date);raw.dailyRecords[date]={...r,baseId:d.baseId,mode:d.mode};}
  const clean=E.cleanSave(raw);assert.equal(Object.keys(clean.challengeRecords).length,60);assert.ok(JSON.stringify(clean).length<40000);
});
