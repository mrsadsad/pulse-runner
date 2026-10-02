'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../web/controls.js'),P=require('../web/profile.js');
test('controls migrate with original defaults and reject invalid settings',()=>{
  assert.deepEqual(P.cleanSave(null).controls,C.DEFAULTS);
  assert.deepEqual(C.clean({layout:'diagonal',size:99,lift:99,sensitivity:'fast',gestures:0,tapJump:null}),C.DEFAULTS);
  const choice={layout:'left',size:'large',lift:32,sensitivity:'steady',gestures:false,tapJump:false};
  assert.deepEqual(P.cleanSave({controls:choice}).controls,choice);
});
test('all sensitivity thresholds trigger during movement, exactly once per contact',()=>{
  for(const [sensitivity,edge] of [['sensitive',16],['normal',24],['steady',36]]){
    const g=new C.Gesture();g.begin(1,50,50,0,{sensitivity});
    assert.equal(g.move(1,50+edge-1,50),null);
    assert.equal(g.move(1,50+edge,50),'right');
    assert.equal(g.move(1,0,50),null);assert.equal(g.end(1,0,50,200),null);
    g.begin(1,50,50,0,{sensitivity});assert.equal(g.end(1,50,46-edge,200),'jump');
  }
});
test('buttons-only and tap disabled still allow intended independent controls',()=>{
  const g=new C.Gesture();assert.equal(g.begin(1,0,0,0,{gestures:false}),false);
  assert.equal(g.end(1,100,0,100),null);
  g.begin(1,0,0,0,{tapJump:false});assert.equal(g.end(1,0,0,100),null);
  g.begin(1,0,0,0,{tapJump:false});assert.equal(g.move(1,-40,0),'left');
});
test('drag-return, downward swipe, long touch, second fingers and cancelled contacts cannot become taps',()=>{
  const g=new C.Gesture();
  g.begin(1,0,0,0);g.move(1,26,26);assert.equal(g.end(1,0,0,150),null);
  g.begin(1,0,0,0);g.move(1,0,45);assert.equal(g.end(1,0,0,150),null);
  g.begin(1,0,0,0);assert.equal(g.end(1,0,0,351),null);
  assert.equal(g.begin(1,0,0,0),true);assert.equal(g.begin(2,0,0,0),false);
  assert.equal(g.end(2,40,0,100),null);assert.equal(g.end(1,0,0,150),'jump');
  g.begin(1,0,0,0);g.cancel();assert.equal(g.end(1,0,0,100),null);
});
