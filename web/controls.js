(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PulseControls = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULTS=Object.freeze({layout:'center',size:'normal',lift:0,sensitivity:'normal',gestures:true,tapJump:true});
  function clean(raw) {
    raw=raw&&typeof raw==='object'?raw:{};
    return {layout:['center','left','right'].includes(raw.layout)?raw.layout:DEFAULTS.layout,
      size:['normal','large'].includes(raw.size)?raw.size:DEFAULTS.size,
      lift:[0,16,32].includes(raw.lift)?raw.lift:DEFAULTS.lift,
      sensitivity:['sensitive','normal','steady'].includes(raw.sensitivity)?raw.sensitivity:DEFAULTS.sensitivity,
      gestures:typeof raw.gestures==='boolean'?raw.gestures:true,tapJump:typeof raw.tapJump==='boolean'?raw.tapJump:true};
  }
  function threshold(settings) { return {sensitive:16,normal:24,steady:36}[clean(settings).sensitivity]; }
  // Each contact can perform one action. Maximum travel prevents a swipe that
  // returns to its starting point from being mistaken for a tap on release.
  class Gesture {
    constructor(){this.cancel();}
    cancel(){this.contact=null;}
    begin(id,x,y,time,settings){
      if(this.contact||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(time))return false;
      const config=clean(settings);if(!config.gestures)return false;
      this.contact={id,x,y,time,config,consumed:false,travel:0};return true;
    }
    move(id,x,y){
      const p=this.contact;if(!p||p.id!==id||!Number.isFinite(x)||!Number.isFinite(y))return null;
      const dx=x-p.x,dy=y-p.y;p.travel=Math.max(p.travel,Math.abs(dx),Math.abs(dy));
      if(p.consumed)return null;
      const edge=threshold(p.config);
      let action=null;
      if(Math.abs(dx)>=edge&&Math.abs(dx)>Math.abs(dy))action=dx>0?'right':'left';
      else if(dy<=-(edge+4)&&Math.abs(dy)>Math.abs(dx))action='jump';
      else if(dy>=edge+4&&Math.abs(dy)>Math.abs(dx))p.consumed=true;
      if(action)p.consumed=true;return action;
    }
    end(id,x,y,time){
      const p=this.contact;if(!p||p.id!==id)return null;
      let action=this.move(id,x,y);
      if(!action&&!p.consumed&&p.config.tapJump&&p.travel<Math.min(24,threshold(p.config))&&time>=p.time&&time-p.time<350)action='jump';
      this.cancel();return action;
    }
  }
  return Object.freeze({DEFAULTS,clean,threshold,Gesture});
});
