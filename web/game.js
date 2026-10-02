(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const levels = window.PulseLevels;
  const Engine = window.PulseEngine;
  const Challenges = window.PulseChallenges;
  const Expedition = window.PulseExpedition;
  const Replay = window.PulseReplay, Rewards = window.PulseRewards, Profile = window.PulseProfile;
  const Controls = window.PulseControls, Backup = window.PulseBackup;
  const gameTouch=new Controls.Gesture(),labTouch=new Controls.Gesture();
  let session = Object.freeze({kind:'campaign',baseId:1,mode:'normal',dateKey:null,code:null});
  let hubDaily = null, variantMode = 'mirror', variantBase = 1, trialBase = 1, lastDateCheck = 0;
  function modeName(mode) { return Challenges.MODES.find(m=>m.id===mode).name; }
  function sessionLevel() {
    if(session.kind==='endless')return Expedition.makeEndless(session.seed);
    if(session.kind==='trial')return Expedition.makeTrial(session.baseId);
    return session.kind==='campaign' ? levels[session.baseId-1] : session.kind==='daily' ? Challenges.makeDaily(session.dateKey).level : Challenges.makeLevel(session.baseId,session.mode);
  }
  function sessionRecord() { return Engine.getRecord(save,run ? run.level : sessionLevel()); }
  function returnToMenu() { showScreen(session.kind==='campaign'?'levels':'hub'); }

  const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  const pad = n => n < 10 ? '0' + n : String(n);
  const saveKey = 'pulse-runner-save-v1';
  const recoveryKey = 'pulse-runner-recovery-v1';
  let save;
  try {
    const raw = window.NativeGame && NativeGame.getSave ? NativeGame.getSave() : localStorage.getItem(saveKey);
    save = Profile.cleanSave(JSON.parse(raw || 'null'));
  } catch (e) { save = Profile.cleanSave(null); }
  let screen = 'home', modalKind = '', selected = 1, run = null, phase = 'idle';
  let countdown = 0, countdownTotal = 0, lastFrame = 0, ambientTime = 0;
  let endDelay = 0, storedRun = false, focusedBeforeModal = null;
  let recorder = null, ghostTrack = null, failureClip = null, replayState = null, resultHtml = '';
  let controlsReturn='settings',labLane=1,labTimer=null,pendingImport=null,importBaseline=null,backupBusy=false,backupReadToken=0;
  let toastTimer, practiceStartRow = 0, previousJumpHeight = 0, lastCount = '', feedbackUntil = 0, lastHud = 0, lastDraw = 0;
  const sounds = new PulseAudio(); sounds.configure(save.sound, save.music);
  const hudValues = Object.create(null);
  const number = n => Math.floor(n || 0).toLocaleString('en-US');
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function normalizedSave(value) {
    const clean=Profile.cleanSave(value);
    Challenges.getGoals(clean).forEach(g=>{if(g.current>0)clean.goalProgress[g.id]=g.current;});
    return clean;
  }
  function readPrimary() {
    try {return {ok:true,raw:window.NativeGame&&NativeGame.getSave?String(NativeGame.getSave()||''):localStorage.getItem(saveKey)||''};}
    catch(_){return {ok:false,raw:''};}
  }
  function writePrimary(json) {
    if(json.length>65536)return false;
    try {
      if(window.NativeGame&&NativeGame.getSave){
        if(NativeGame.commitSave){if(NativeGame.commitSave(json)!==true)return false;}
        else if(NativeGame.setSave)NativeGame.setSave(json);else return false;
        if(String(NativeGame.getSave()||'')!==json)return false;
        try{localStorage.setItem(saveKey,json);}catch(_){/* Native storage is authoritative. */}
        return true;
      }
      localStorage.setItem(saveKey,json);return localStorage.getItem(saveKey)===json;
    }catch(_){return false;}
  }
  function readRecovery() {
    try{return window.NativeGame&&NativeGame.getRecovery?String(NativeGame.getRecovery()||''):localStorage.getItem(recoveryKey)||'';}catch(_){return '';}
  }
  function restorePrimary(raw) {
    const before=readPrimary();if(before.ok&&before.raw===raw)return true;
    try{
      if(!raw&&!(window.NativeGame&&NativeGame.getSave))localStorage.removeItem(saveKey);
      else writePrimary(raw);
    }catch(_){/* Keep the recovery point if rollback cannot be verified. */}
    const after=readPrimary();return after.ok&&after.raw===raw;
  }
  function writeRecovery(json) {
    if(json.length>65536)return false;
    try{
      if(window.NativeGame&&NativeGame.setRecovery)return NativeGame.setRecovery(json)===true&&String(NativeGame.getRecovery()||'')===json;
      if(json)localStorage.setItem(recoveryKey,json);else localStorage.removeItem(recoveryKey);
      return (localStorage.getItem(recoveryKey)||'')===json;
    }catch(_){return false;}
  }
  function persist() {
    save=normalizedSave(save);
    const ok=writePrimary(JSON.stringify(save));
    if(!ok)toast('暂时无法保存，请在存档管理中导出备份');
    return ok;
  }
  function totalStars() { return Object.keys(save.records).reduce((n, k) => n + save.records[k].stars, 0); }
  function completed() { return levels.filter(l => save.records[l.id] && save.records[l.id].stars > 0).length; }
  function stars(count) { return '<div class="stars" aria-label="' + count + ' 星">' + [1, 2, 3].map(i => '<svg class="' + (i <= count ? 'earned' : '') + '"><use href="#i-star"/></svg>').join('') + '</div>'; }
  function initAudio() { sounds.unlock(); }
  function effects() { return save.effects && !reducedMotion; }
  function theme(chapter) {
    $('app').dataset.chapter = chapter;
    $('app').classList.toggle('quiet-effects', !effects());
    $('themeLabel').textContent = PulseThemes[chapter - 1].name;
  }

  function vibrate(ms) {
    if (!save.vibration) return;
    try {
      if (window.NativeGame && NativeGame.vibrate) NativeGame.vibrate(ms);
      else if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) { /* Optional feedback. */ }
  }
  function toast(message) {
    $('toast').textContent = message; $('toast').classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2300);
  }
  function showScreen(next) {
    closeModal(); resetTouches(); sounds.silence(); screen = next;
    ['home', 'levels', 'hub', 'wardrobe', 'controlsPage', 'backupPage', 'play'].forEach(name => $(name).classList.toggle('hidden', name !== next));
    replayState = null; $('play').classList.remove('is-replay'); $('replayDeck').classList.add('hidden');
    if (next !== 'play'&&!(next==='controlsPage'&&controlsReturn==='pause')) { phase = 'idle'; run = null; recorder = null; failureClip = null; ghostTrack = null; resultHtml = ''; gameRenderer.reset(); }
    if (next === 'home') updateHome();
    if (next === 'levels') { theme(1); renderLevels(); }
    if (next === 'hub') { theme(1); renderHub(); $('hub').scrollTop=0; }
    if (next === 'wardrobe') { theme(1); renderWardrobe(); $('wardrobe').scrollTop=0; }
    if (next === 'controlsPage') { renderControls(); $('controlsPage').scrollTop=0; }
    if (next === 'backupPage') { theme(1);renderBackup();$('backupPage').scrollTop=0; }
    resize();
  }
  function updateHome() {
    const l = levels[save.unlocked - 1]; theme(l.chapter);
    $('homeProgress').style.width = completed() / 15 * 100 + '%';
    $('continueLabel').textContent = pad(l.id) + ' / ' + l.name;
    $('unlockCount').textContent = pad(save.unlocked) + ' / 15';
    $('homeStars').textContent = totalStars() + ' / 45 星';
    $('homeDifficulty').textContent = completed() === 15 ? '全关已通 · 挑战三星' : ['反应训练', '节奏进阶', '极限穿行'][l.chapter - 1];
    document.querySelector('[data-do="continue"] span').textContent = completed() === 15 ? '再次挑战' : '开始穿行';
  }
  function renderLevels() {
    $('levelStars').textContent = totalStars() + ' / 45 ★';
    const chapterNames = ['01 / 苔原信号', '02 / 极光回廊', '03 / 暮光临界'];
    const chapterEn = ['FIND YOUR RHYTHM', 'INTO THE PULSE', 'BEYOND THE LIMIT'];
    $('levelGrid').innerHTML = [0, 1, 2].map(ch => '<div class="chapter"><h3 class="chapter-title">' + chapterNames[ch] + '<small>' + chapterEn[ch] + '</small></h3><div class="level-row">' + levels.slice(ch * 5, ch * 5 + 5).map(l => {
      const r = save.records[l.id], locked = l.id > save.unlocked;
      return '<button class="level-card ' + (locked ? 'locked' : r && r.stars ? 'complete' : l.id === save.unlocked ? 'current' : '') + '" data-level="' + l.id + '" aria-label="第' + l.id + '关 ' + l.name + (locked ? '，尚未解锁' : '') + '" ' + (locked ? 'aria-disabled="true"' : '') + '>' + (locked ? icon('lock') : '') + '<strong>' + pad(l.id) + '</strong><small>' + l.name + '</small>' + stars(r ? r.stars : 0) + '</button>';
    }).join('') + '</div></div>').join('');
  }
  function openModal(kind, content) {
    if ($('overlay').classList.contains('hidden')) focusedBeforeModal = document.activeElement;
    modalKind = kind; resetTouches();
    $('modal').innerHTML = content;
    if(session.kind!=='campaign')$('modal').querySelectorAll('[data-do="levels"]').forEach(b=>{b.textContent=kind==='pause'&&session.kind==='endless'?'结束并返回挑战中心':'返回挑战中心';});
    const heading = $('modal').querySelector('h2');
    if (heading) heading.id = 'modalTitle';
    $('overlay').classList.remove('hidden');
    ['home','levels','hub','wardrobe','controlsPage','backupPage','play'].forEach(id => { if ('inert' in $(id)) $(id).inert = true; });
    $('modal').scrollTop = 0;
    const focus = $('modal').querySelector('.primary-button, button');
    if (focus) focus.focus({ preventScroll: true });
  }
  function closeModal() {
    $('overlay').classList.add('hidden'); modalKind = '';
    ['home','levels','hub','wardrobe','controlsPage','backupPage','play'].forEach(id => { if ('inert' in $(id)) $(id).inert = false; });
    if (focusedBeforeModal && document.contains(focusedBeforeModal)) focusedBeforeModal.focus({ preventScroll: true });
    focusedBeforeModal = null;
  }
  function modalTop(label, closable) { return '<div class="modal-top"><span class="modal-eyebrow">' + label + '</span>' + (closable ? '<button class="icon-button" data-do="close" aria-label="关闭">' + icon('close') + '</button>' : '<span class="live-dot"></span>') + '</div>'; }
  function primary(label, action, symbol) { return '<button class="primary-button" data-do="' + action + '"><span>' + label + '</span>' + icon(symbol || 'arrow') + '</button>'; }
  function secondary(label, action) { return '<button class="secondary-button" data-do="' + action + '">' + label + '</button>'; }
  function mechanicGuide() {
    return '<div class="mechanic-guide"><strong>先读机关，再选路线</strong><p>↔ 移动高墙：箭头指向最终落点，接近前停止移动；高墙不能跳过。</p><p>▥ 周期闸门：远处会开合，接近前锁定状态。闭门必须绕开，开门可通过。</p><p>◆ 金色奖励：跳过对应矮栏或断层，额外获得 200 分。普通晶体路线无需冒这个险；两条路线每排都最多收集一枚晶体。</p></div>';
  }
  function newEndless() {
    let seed;
    try {const value=new Uint32Array(1);window.crypto.getRandomValues(value);seed=value[0];}
    catch(_){seed=(Date.now()^Math.floor(Math.random()*4294967296))>>>0;}
    if(seed===session.seed)seed=(seed+1)>>>0;
    if(screen==='play')showScreen('hub');
    prepare(1,{kind:'endless',baseId:1,mode:'normal',seed:seed,code:Expedition.encodeEndlessCode(seed)});
  }
  function prepare(id, descriptor) {
    const next=descriptor ? {kind:descriptor.kind,baseId:descriptor.baseId,mode:descriptor.mode,dateKey:descriptor.dateKey||null,code:descriptor.code||Challenges.encodeLevelCode(descriptor.baseId,descriptor.mode)} : {kind:'campaign',baseId:id,mode:'normal',dateKey:null,code:null};
    if(next.kind==='endless')next.seed=descriptor.seed;
    session=Object.freeze(next);selected=session.baseId;
    const l=sessionLevel(),r=Engine.getRecord(save,l);theme(l.chapter);
    const endless=session.kind==='endless',trial=session.kind==='trial',mechanics=endless||trial,standalone=session.kind!=='campaign';
    const label=endless?'ENDLESS / NO FINISH LINE':trial?'MECHANISM / '+pad(id):session.kind==='daily'?'DAILY SIGNAL':standalone?'REMIX CHALLENGE':'SECTOR '+pad(id)+' / 15';
    const context=standalone?'<p class="challenge-context">'+(endless?'无限生存':trial?'机关试炼':session.kind==='daily'?'日期 '+session.dateKey+' · '+modeName(session.mode):'独立变式 · '+modeName(session.mode))+' · 独立纪录，不解锁主线</p>':'';
    const best=r&&r.attempts?'<p class="personal-best">'+(endless?'最远 '+number(r.bestDistance)+' 米':'最佳进度 '+Math.floor(r.progress*100)+'%')+' · 最高分 '+number(r.bestScore)+'<br>已尝试 '+r.attempts+' 次</p>':'';
    openModal('prepare',modalTop(label,true)+'<h2>'+l.name+'<span class="orange-dot">.</span></h2>'+context+'<p>'+l.subtitle+'</p>'+(mechanics?'':'<p class="help-note">'+l.tutorial+'</p>')+(mechanics?mechanicGuide():standalone?'<p class="mode-description">'+Challenges.MODES.find(m=>m.id===session.mode).description+'</p>':'')+'<div class="result-grid"><div><span>'+(endless?'赛道长度':'赛道时长')+'</span><strong>'+(endless?'没有终点':Math.round(l.duration*10)/10+' 秒')+'</strong></div><div><span>'+(endless?'节奏提升':'挑战强度')+'</span><strong>'+(endless?'每 25 秒一阶段':'●'.repeat(l.difficulty)+'<span>'+'○'.repeat(5-l.difficulty)+'</span>')+'</strong></div></div>'+best+primary('准备好了，出发','start')+(endless?'':secondary('练习模式 · 不计成绩','practice'))+'<button class="text-button" data-do="help">查看操作说明</button>');
    const track=Replay.getGhost(save.replays,Replay.keyFor(l)),note=document.createElement('p');
    note.className='ghost-note';
    note.textContent=track?'最佳录像 '+number(track.score)+' 分 · 记录至 '+track.end.toFixed(1)+' 秒'+(track.end<track.totalTime-.01?'（仅前段）':'')+'。'+(save.ghostEnabled?'出发后显示同时间点的影子。':'影子已在设置中关闭。'):'完成一次正式挑战后，记录操作并生成最佳录像影子。旧成绩没有录像；练习不覆盖正式影子。';
    $('modal').insertBefore(note,$('modal').querySelector('.primary-button'));
  }
  function recordLabel(record) {
    return record ? '最高 '+number(record.bestScore)+' 分 · '+(record.wins||0)+' 次完成 · '+record.attempts+' 次挑战' : '还没有纪录，来完成第一次挑战。';
  }
  function refreshDaily() {
    hubDaily=Challenges.makeDaily(Challenges.localDateKey());
    $('dailyDate').textContent=hubDaily.dateKey;
    $('dailyTitle').textContent=pad(hubDaily.baseId)+' / '+hubDaily.level.name+' · '+modeName(hubDaily.mode);
    $('dailyDescription').textContent='今日固定路线，难度 '+hubDaily.level.difficulty+'/5。不限重试，按本机日期每日更新。';
    $('dailyBest').textContent=recordLabel(save.dailyRecords[hubDaily.dateKey]);
    $('dailyCode').textContent=hubDaily.code;
  }
  function renderHub() {
    refreshDaily();
    $('collectionCount').textContent='已解锁 '+Rewards.getItems(save).filter(item=>item.goal&&item.unlocked).length+' / 10 奖励 · 进入装扮收藏';
    $('variantLevel').innerHTML=levels.map(l=>'<option value="'+l.id+'">'+pad(l.id)+' / '+l.name+'</option>').join('');
    $('variantLevel').value=variantBase;updateVariant();
    $('trialLevel').innerHTML=levels.map(l=>'<option value="'+l.id+'">'+pad(l.id)+' / '+l.name+'</option>').join('');
    $('trialLevel').value=trialBase;updateTrial();
    const endless=save.endlessRecord;
    $('endlessBest').textContent=endless&&endless.attempts?'最远 '+number(endless.bestDistance)+' 米 · 最高 '+number(endless.bestScore)+' 分 · '+endless.attempts+' 次挑战':'从第一步开始，创造你的距离纪录。';
    $('codeError').classList.add('hidden');
    const goals=Challenges.getGoals(save),count=goals.filter(g=>g.unlocked).length;
    $('goalCount').textContent=count+' / '+goals.length+' 成就';
    $('goalTitle').textContent=count===10?'挑战大师':count>=7?'极限行者':count>=4?'脉冲先锋':count>=1?'初醒者':'起点在这里';
    $('goalGrid').innerHTML=goals.map(g=>'<article class="goal-card '+(g.unlocked?'earned':'')+'" data-goal="'+g.id+'"><div class="goal-top">'+icon('star')+'<span>'+g.current+' / '+g.target+'</span></div><h4>'+g.title+'</h4><p>'+g.description+'</p><div class="goal-meter" role="progressbar" aria-label="'+g.title+'" aria-valuemin="0" aria-valuemax="'+g.target+'" aria-valuenow="'+g.current+'"><span style="width:'+g.current/g.target*100+'%"></span></div></article>').join('');
    const dates=Object.keys(save.dailyRecords).sort().reverse().slice(0,5);
    $('dailyHistory').innerHTML=dates.length?'<h3>最近的每日挑战</h3>'+dates.map(date=>{const r=save.dailyRecords[date];return '<div class="history-row"><span>'+date+' · '+pad(r.baseId)+'关 '+modeName(r.mode)+(r.wins?' · 完成':'')+'</span><strong>'+number(r.bestScore)+' 分</strong></div>';}).join(''):'';
  }
  function updateVariant() {
    const mode=Challenges.MODES.find(m=>m.id===variantMode);
    document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===variantMode)));
    $('variantDescription').textContent=mode.description;
    $('variantBest').textContent=recordLabel(save.challengeRecords[variantBase+'-'+variantMode]);
  }
  function updateTrial() { $('trialBest').textContent=recordLabel((save.trialRecords||{})[trialBase]); }
  function applyAppearance() {
    const appearance=Rewards.appearance(save.equipped);
    [heroRenderer,gameRenderer,wardrobeRenderer].forEach(renderer=>renderer.setAppearance(appearance));
    lastDraw=0;
  }
  function renderWardrobe() {
    const items=Rewards.getItems(save),goals=Challenges.getGoals(save),appearance=Rewards.appearance(save.equipped);
    $('rewardCount').textContent=items.filter(item=>item.goal&&item.unlocked).length+' / 10 奖励';
    $('equippedName').textContent=appearance.skin.name+' · '+appearance.trail.name;
    ['skin','trail'].forEach(kind=>{
      $(kind+'Grid').innerHTML=items.filter(item=>item.kind===kind).map(item=>{
        const goal=goals.find(g=>g.id===item.goal),condition=goal?goal.title+' · '+item.current+' / '+item.target:'初始装备 · 已拥有';
        return '<article class="reward-card '+(item.equipped?'equipped':!item.unlocked?'locked':'')+'" data-reward="'+item.id+'"><div class="reward-top"><span class="reward-swatch" style="--reward-color:'+item.color+'">'+(kind==='skin'?'◇':'≈')+'</span><small>'+(item.equipped?'已装备':item.unlocked?'已解锁':'待解锁')+'</small></div><h4>'+item.name+'</h4><p>'+item.description+'</p><span class="reward-condition">'+condition+'</span><button data-equip="'+item.id+'" aria-label="装备'+item.name+'" '+(!item.unlocked||item.equipped?'disabled':'')+'>'+(item.equipped?'正在使用':item.unlocked?'装备':'完成成就解锁')+'</button></article>';
      }).join('');
    });
  }
  function equipReward(id) {
    const item=Rewards.getItems(save).find(entry=>entry.id===id);
    if(screen!=='wardrobe'||!item||!item.unlocked||item.equipped)return;
    const top=$('wardrobe').scrollTop;
    save.equipped[item.kind]=item.id;persist();applyAppearance();renderWardrobe();
    $('wardrobe').scrollTop=top;
    const card=document.querySelector('[data-reward="'+item.id+'"]');card.tabIndex=-1;card.focus({preventScroll:true});
    toast('已装备「'+item.name+'」');
  }
  function importCode() {
    const descriptor=Challenges.parseCode($('friendCode').value)||Expedition.parseCode($('friendCode').value);
    if(!descriptor){$('codeError').textContent='挑战码无效。请完整粘贴 PR2 或 PR3 开头的挑战码。';$('codeError').classList.remove('hidden');return;}
    $('codeError').classList.add('hidden');prepare(descriptor.baseId,descriptor);
  }
  function copyCode(code,field) {
    const fallback=()=>{const input=field||$('friendCode');input.value=code;input.focus();input.select();toast('已选中挑战码，请复制后发给朋友');};
    try {
      if(!navigator.clipboard||!navigator.clipboard.writeText){fallback();return;}
      navigator.clipboard.writeText(code).then(()=>toast('挑战码已复制，发给朋友即可'),fallback);
    } catch(_){fallback();}
  }
  function shareBlock() {
    return '<div class="session-code"><label for="outgoingCode">同码同路线 · 成绩由你们互相比对</label><div class="session-code-row"><input id="outgoingCode" readonly aria-label="本次挑战码" value="'+session.code+'"><button data-do="copyCode">复制</button></div></div>';
  }

  function start(id, options) {
    const opts = options || {};
    selected = session.kind==='campaign' ? Math.max(1,Math.min(save.unlocked,id)) : session.baseId; showScreen('play');
    const level=sessionLevel(),key=Replay.keyFor(level);
    recorder=new Replay.Recorder(key);ghostTrack=Replay.getGhost(save.replays,key);failureClip=null;resultHtml='';
    run = new Engine.Run(level, { practice: session.kind!=='endless'&&!!opts.practice, startRow: opts.startRow || 0, onUpdate: state=>recorder.observe(state) });
    practiceStartRow = run.practiceStartRow || 0; phase = 'countdown'; theme(run.level.chapter);
    countdown = opts.quick ? .65 : 2.1; countdownTotal = countdown; lastCount = '';
    storedRun = false; endDelay = 0; feedbackUntil = 0; previousJumpHeight = 0;
    gameRenderer.reset(); Object.keys(hudValues).forEach(key => delete hudValues[key]);
    $('play').classList.toggle('has-mechanics',session.kind==='trial'||session.kind==='endless');
    $('play').classList.toggle('is-endless',session.kind==='endless');
    $('gameLevelNumber').textContent = session.kind==='endless'?'无限生存':session.kind==='trial'?'机关试炼 · '+pad(selected)+' / 15':session.kind==='campaign'?'SECTOR '+pad(selected)+' / 15':session.kind==='daily'?'每日 '+session.dateKey.slice(5)+' · '+modeName(session.mode):'变式挑战 · '+modeName(session.mode);
    $('gameLevelName').textContent = run.level.name;
    $('gameSpeed').textContent = PulseThemes[run.level.chapter - 1].name + ' / ' + ['TUNDRA','AURORA','TWILIGHT'][run.level.chapter - 1];
    $('gemTotal').textContent = session.kind==='endless'?'枚':'/ ' + run.totalGems;
    $('practiceBadge').classList.toggle('hidden', !run.practice);
    $('practiceBadge').textContent = practiceStartRow ? '片段练习 · 不计成绩' : '练习模式 · 不计成绩';
    $('laneHint').textContent = session.kind==='endless'?'随时暂停，可结束并保存成绩':session.kind==='trial'?'普通晶体稳步推进 · 金色奖励需要跳跃':run.practice ? '放松练习，成绩不会计入纪录' : selected === 1 ? '左右变道，避开橙红高墙' : '障碍进入金色起跳区时起跳';
    $('impactLabel').classList.remove('show');
    $('bestMarker').style.left = Math.min(100, ((sessionRecord() || {}).progress || 0) * 100) + '%';
    updateHud(); initAudio(); lastFrame = 0; lastDraw = 0;
  }

  function pause() {
    if(phase==='replay'){if(replayState){replayState.playing=false;updateReplayControls();}return;}
    if (screen !== 'play' || !['running', 'countdown', 'paused'].includes(phase)) return;
    phase = 'paused'; resetTouches(); sounds.silence(); $('announcement').innerHTML = '';
    openModal('pause', modalTop('TAKE A BREATH', false) + '<h2 id="modalTitle">暂停一下</h2><p>调整节奏。赛道会在这里等你。</p>' + primary('继续穿行', 'resume') + secondary(session.kind==='endless'?'保存成绩并重来':'重新挑战', 'retry') + (session.kind==='endless'?secondary('结束并保存成绩','endRun'):'') + secondary('返回关卡', 'levels') + '<button class="text-button" data-do="sound">音效：' + (save.sound ? '开启' : '关闭') + '</button>');
    $('modal').insertAdjacentHTML('beforeend','<button class="text-button" data-do="ghostEnabled">最佳录像影子：'+(save.ghostEnabled?'开启':'关闭')+'</button>');
    $('modal').insertAdjacentHTML('beforeend',secondary('调整手机操作','controls'));
  }
  function resume() {
    closeModal(); initAudio();
    // A fresh countdown prevents an immediate collision after an interruption.
    phase = 'countdown'; countdown = 1.4; countdownTotal = countdown; lastCount = ''; resetTouches(); lastFrame = 0;
  }
  function settingRow(key, label, detail) {
    return '<button class="setting-row" data-do="' + key + '" role="switch" aria-checked="' + save[key] + '"><span>' + label + '<small>' + detail + '</small></span><i class="toggle ' + (save[key] ? 'on' : '') + '"></i></button>';
  }
  function settings() {
    const links='<div class="settings-links"><button data-do="controls">手机操作设置<small>按钮布局、大小、手势与试手感</small></button><button data-do="backup">存档备份与迁移<small>导出、导入、合并进度和撤回导入</small></button></div>';
    openModal('settings', modalTop('MAKE IT YOURS', true) + '<h2>游戏设置</h2><p class="author-credit settings-credit">made in yongchao</p>' + links + settingRow('sound','声音','变道、起跳、落地与碰撞反馈') + settingRow('music','赛道音乐','三个章节各有电子节奏，受声音总开关控制') + settingRow('vibration','震动','跳跃、落地、连击与碰撞反馈') + settingRow('effects','动态特效',reducedMotion ? '系统已启用减少动态效果' : '粒子、光晕和轻微震屏；关闭后更省电') + settingRow('ghostEnabled','最佳录像影子','显示同路线已录制的最高分操作，可随时关闭') + '<p class="settings-note">共 15 关 · 完全离线 · 进度自动保存<br>版本 1.5.1 / PULSE RUNNER<br>影子记录更新后的正式挑战，最多缓存 6 条路线。<br>每条最多前 120 秒；密集操作可能提前结束记录。</p>' + primary('完成','close'));
  }

  function resetTouches(){gameTouch.cancel();labTouch.cancel();}
  function applyControls(){
    const c=save.controls,main=document.querySelector('#play .controls');
    [main,$('labControls')].forEach(el=>{el.classList.add('control-layout');el.dataset.layout=c.layout;el.dataset.size=c.size;});
    $('play').style.setProperty('--control-lift',c.lift+'px');$('labControls').style.setProperty('--control-lift',c.lift+'px');
    const hint=document.querySelector('#play .keyboard-hint');
    hint.textContent=c.gestures?(c.tapJump?'滑动即变道 · 轻触 / 上滑跳跃':'左右滑动变道 · 上滑跳跃 · 轻触已关闭'):'底部按钮操作 · 赛道手势已关闭';
    resetTouches();resize();
  }
  function renderControls(){
    document.querySelectorAll('[data-control]').forEach(el=>{el.value=String(save.controls[el.dataset.control]);});
    document.querySelectorAll('[data-control-toggle]').forEach(el=>{
      const value=save.controls[el.dataset.controlToggle];el.setAttribute('aria-checked',String(value));el.querySelector('.toggle').classList.toggle('on',value);
    });
    $('tapJumpToggle').disabled=!save.controls.gestures;$('controlSensitivity').disabled=!save.controls.gestures;
    applyControls();
  }
  function openControls(){
    controlsReturn=screen==='play'&&phase==='paused'?'pause':'settings';
    labLane=1;$('labShip').style.left='50%';$('labFeedback').textContent='准备好了 · 试试变道和跳跃';
    showScreen('controlsPage');
  }
  function closeControls(){
    resetTouches();
    if(controlsReturn==='pause'&&run){showScreen('play');pause();}
    else {showScreen('home');settings();}
  }
  function changeControl(key,value){
    save.controls=Controls.clean(Object.assign({},save.controls,{[key]:value}));persist();renderControls();
  }
  function labAction(action){
    if(screen!=='controlsPage'||modalKind)return;
    if(action==='jump'){
      clearTimeout(labTimer);$('labShip').classList.remove('jumping');void $('labShip').offsetWidth;$('labShip').classList.add('jumping');
      labTimer=setTimeout(()=>$('labShip').classList.remove('jumping'),650);
    } else labLane=Math.max(0,Math.min(2,labLane+(action==='left'?-1:1)));
    $('labShip').style.left=(labLane*100/3+100/6)+'%';
    $('labFeedback').textContent=action==='jump'?'起跳 · 不计成绩':['左道','中道','右道'][labLane]+' · 不计成绩';
  }
  function summaryMarkup(summary){
    return '<div><strong>'+summary.completed+' / 15</strong><span>主线通关</span></div><div><strong>'+summary.stars+' / 45</strong><span>主线星数</span></div><div><strong>'+summary.goalCount+' / 10</strong><span>已达成就</span></div>';
  }
  function backupStatus(message,error){$('backupStatus').textContent=message||'';$('backupStatus').classList.toggle('error',!!error);}
  function setBackupBusy(value){backupBusy=value;document.querySelectorAll('#backupPage [data-do="exportBackup"],#backupPage [data-do="chooseBackup"]').forEach(b=>{b.disabled=value;});}
  function renderBackup(){
    $('backupSummary').innerHTML=summaryMarkup(Backup.summarize(save));
    let recovered=null;try{const raw=readRecovery();if(raw)recovered=Backup.inspect(raw);}catch(_){/* Invalid recovery is never offered. */}
    $('restoreBackup').disabled=!recovered;
    $('recoveryDescription').textContent=recovered?'已保留导入前的存档：'+recovered.summary.completed+' 关、'+recovered.summary.stars+' 星。恢复会替换本机现在的进度，请先导出当前备份。':'每次导入前会自动保留本机存档，方便撤回最近一次导入。';
    setBackupBusy(backupBusy);
  }
  function openBackup(){
    if(screen==='play')return;
    pendingImport=null;backupStatus('');$('backupExportPanel').classList.add('hidden');showScreen('backupPage');
  }
  function backupText(){return Backup.exportSave(normalizedSave(save));}
  function showBackupText(){
    try{$('backupExportText').value=backupText();$('backupExportPanel').classList.remove('hidden');}
    catch(error){backupStatus(error.message,true);}
  }
  function exportBackup(){
    if(backupBusy)return;
    try{
      const text=backupText();
      if(window.NativeGame&&NativeGame.exportBackup){setBackupBusy(true);NativeGame.exportBackup(text);backupStatus('请选择备份文件的保存位置。');return;}
      const blob=new Blob([text],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='PulseRunner-backup-'+Challenges.localDateKey().replace(/-/g,'')+'.json';link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      backupStatus('已发起备份下载。请保留下载的 JSON 文件，换设备时选择它导入。');
    }catch(error){setBackupBusy(false);showBackupText();backupStatus('无法直接导出文件，请复制下方完整备份文本。',true);}
  }
  function copyBackup(){
    showBackupText();const text=$('backupExportText').value;
    const fallback=()=>{$('backupExportText').focus();$('backupExportText').select();backupStatus('已选中备份文本。电脑按 Ctrl+C，手机长按后选择复制。');};
    try{if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(text).then(()=>backupStatus('完整备份已复制。'),fallback);else fallback();}catch(_){fallback();}
  }
  function chooseBackup(){
    if(backupBusy)return;
    if(window.NativeGame&&NativeGame.importBackup){
      try{setBackupBusy(true);NativeGame.importBackup();backupStatus('请选择之前导出的备份文件。');}catch(_){setBackupBusy(false);backupStatus('文件选择器未能打开，也可以粘贴备份文本。',true);}return;
    }
    $('backupFile').value='';$('backupFile').click();
  }
  function previewBackup(text,recovery){
    if(screen!=='backupPage')return;
    pendingImport=null;
    try{
      const inspected=Backup.inspect(text),baseline=readPrimary();
      if(!baseline.ok)throw new Error('无法读取本机存档，暂不能导入。你仍可以导出备份。');
      pendingImport=Object.assign({},inspected,{recovery:!!recovery});importBaseline=baseline.raw;
      const mode=recovery?'':'<label class="field-label" for="importMode">导入方式</label><select id="importMode" class="comfort-select"><option value="merge">合并进度 · 保留较好的成绩</option><option value="replace">替换本机 · 使用备份里的全部内容</option></select>';
      openModal('importPreview',modalTop(recovery?'RESTORE YOUR SAVE':'CHECK BEFORE IMPORT',true)+'<h2>'+(recovery?'恢复导入前的进度':'先核对这份存档')+'</h2><p class="import-source" id="importSource"></p><div class="backup-summary">'+summaryMarkup(inspected.summary)+'</div><p class="import-detail">已解锁至第 '+inspected.summary.unlocked+' 关 · 保存影子 '+inspected.summary.replayCount+' 条</p>'+mode+'<p id="importOutcome" class="import-detail"></p><p id="importWarning" class="import-warning"></p><p id="importError" class="code-error hidden" role="alert"></p>'+primary(recovery?'确认恢复':'确认合并','confirmImport')+secondary('取消，保持本机存档','cancelImport'));
      $('importSource').textContent=recovery?'恢复点 · 最近一次导入之前':inspected.createdAt?'备份时间：'+new Date(inspected.createdAt).toLocaleString():'旧版存档 · 没有导出时间';
      updateImportPreview();backupStatus('');
    }catch(error){pendingImport=null;backupStatus(error.message||'备份无法读取，本机进度没有改变。',true);}
  }
  function updateImportPreview(){
    if(!pendingImport)return;
    const replace=pendingImport.recovery||$('importMode').value==='replace';
    const next=replace?pendingImport.save:Backup.merge(save,pendingImport.save),summary=Backup.summarize(next);
    $('importOutcome').textContent=(replace?'恢复后':'合并后')+'：主线 '+summary.completed+' 关、'+summary.stars+' 星、'+summary.goalCount+' 项成就。'+(replace?'装备与设置也会采用这份存档。':'保留本机设置与装备，成绩和次数取较大值，不重复累加。');
    $('importWarning').textContent=(pendingImport.recovery?'这会替换当前进度，包括本次导入后新获得的成绩。':replace?'替换可能减少当前进度；确认前会自动保存本机恢复点。':'确认后才会写入；导入前会自动保存本机恢复点。')+(pendingImport.warnings.length?' '+pendingImport.warnings.join(' '):'');
    $('modal').querySelector('[data-do="confirmImport"] span').textContent=pendingImport.recovery?'确认恢复':replace?'确认替换':'确认合并';
  }
  function confirmImport(){
    if(modalKind!=='importPreview'||!pendingImport)return;
    const fail=message=>{$('importError').textContent=message;$('importError').classList.remove('hidden');};
    const current=readPrimary();
    if(!current.ok||current.raw!==importBaseline){fail('本机存档已变化或无法读取。请取消，刷新页面后重新预览。');return;}
    try{
      const recovery=pendingImport.recovery,replace=recovery||$('importMode').value==='replace';
      const next=normalizedSave(replace?pendingImport.save:Backup.merge(save,pendingImport.save));
      const json=JSON.stringify(next),oldRecovery=readRecovery();
      if(!recovery&&!writeRecovery(JSON.stringify(normalizedSave(save)))){fail('无法保存导入前的恢复点，本次导入已停止，当前进度没有改变。');return;}
      if(!writePrimary(json)){
        // A write can succeed even when its verification read fails. Restore
        // primary storage before removing the recovery point or claiming no change.
        const restored=restorePrimary(current.raw);
        if(restored&&!recovery)writeRecovery(oldRecovery);
        renderBackup();
        fail(restored?'存档写入失败，已确认本机进度保持不变，请检查设备存储后再试。':'无法确认存档写入结果，导入前恢复点仍保留。请重新打开游戏后检查进度，必要时使用恢复点。');return;
      }
      save=next;if(recovery)writeRecovery('');pendingImport=null;closeModal();
      sounds.configure(save.sound,save.music);applyAppearance();applyControls();updateHome();theme(1);renderBackup();
      $('backupExportPanel').classList.add('hidden');$('backupImportText').value='';
      backupStatus(recovery?'已恢复导入前的进度。':'导入完成。可以返回首页继续游戏，也可在下方恢复导入前的进度。');
    }catch(error){fail(error.message||'导入未完成，请重新检查备份。');}
  }

  let helpReturn = '';
  function help() {
    helpReturn = modalKind === 'prepare' ? 'prepare' : '';
    openModal('help', modalTop('A QUICK FIELD GUIDE', true) + '<h2 id="modalTitle">快一点，再快一点</h2><p>自动向前奔跑。一次碰撞，重新出发。</p><div class="help-row"><div class="help-icon">' + icon('left') + '</div><div><strong>左右变道</strong><small>滑动达到距离就变道，不必等松手。<br>跨两条轨道需要操作两次。</small></div></div><div class="help-row"><div class="help-icon"><i class="wall-key"></i></div><div><strong>橙红高墙 → 变道躲开</strong><small>高墙不能跳过，看准空位再行动。</small></div></div><div class="help-row"><div class="help-icon"><i class="hurdle-key"></i></div><div><strong>金色矮栏 / 黑色断层 → 跳跃</strong><small>进入金色起跳区时跳跃；落地前轻点，可接上下一跳。</small></div></div><div class="help-row"><div class="help-icon">' + icon('gem') + '</div><div><strong>收集晶体 → 挑战三星</strong><small>通关得 1 星，收集 70% 得 2 星，全部收集得 3 星。连续收集还能连击加分。</small></div></div><p class="help-note">失败后可选择「练习这一段」。练习不解锁关卡，也不改变正式纪录。</p>' + ((session.kind==='trial'||session.kind==='endless')?mechanicGuide():'') + primary('明白了', 'helpDone'));
  }
  function resultStats(record) {
    const r=record||sessionRecord();const best=!run.practice&&r?'<span>历史最高 '+number(r.bestScore)+'</span>':'';
    return '<div class="result-grid result-score"><div><span>本次得分</span><strong>' + number(run.score) + '</strong>' + best + '</div><div><span>最高连击 / 精准跳跃</span><strong>' + run.maxCombo + ' <small>连</small> / ' + run.perfectJumps + ' <small>次</small></strong></div></div>';
  }
  function failureHint() {
    if(run.failure.mechanism==='moving')return '撞上了移动高墙。箭头指向它的最终落点，在它停稳前找到空位。';
    if(run.failure.mechanism==='gate')return '碰到了关闭的闸门。接近后状态会锁定，闭门要变道，不能跳过。';
    if (run.failure.type === 'wall') return '撞上了高墙。提前变道，高墙无法跳过。';
    if (run.failure.lastJumpAgo !== null && run.failure.lastJumpAgo > Engine.JUMP_DURATION / 2) return '这次起跳稍早，接近障碍时已经落地。等它进入金色起跳区再跳。';
    if (run.failure.lastJumpAgo !== null && run.failure.lastJumpAgo < .12) return '这次起跳稍晚。障碍进入金色起跳区时就可以跳了。';
    return run.failure.type === 'gap' ? '落入了断层。黑色裂隙要跳过，留意金色起跳区。' : '被矮栏挡住了。接近金色起跳区时起跳，越过它。';
  }
  function finish() {
    if (!run || storedRun) return;
    storedRun = true;
    const old = sessionRecord() || {progress:0,bestScore:0};
    const earnedBefore=Challenges.getGoals(save).filter(g=>g.unlocked).map(g=>g.id);
    Engine.recordRun(save, run);
    // A very old daily code can rotate out of the bounded save; its result still needs its final record.
    const finalRecord=sessionRecord();
    failureClip=run.status==='failed'&&recorder?recorder.clip(run):null;
    if (!run.practice) {
      save.replays=Replay.store(save.replays,recorder?recorder.track(run):null);
      persist();
    }
    const l = run.level, won = run.status === 'won'; phase = 'result'; $('announcement').innerHTML = '';
    if (run.practice) {
      openModal('result', modalTop('PRACTICE / NO RECORD CHANGES',false) + '<h2>' + (won ? '节奏找到了。' : '把这一段练熟。') + '</h2><p>' + (won ? '练习完成。准备好后，从头正式挑战。' : failureHint()) + '</p><div class="practice-result">练习模式 · 不计星级，不解锁关卡</div>' + resultStats() + primary('开始正式挑战','official') + secondary('再练一次','retry') + (won ? '' : secondary('练习这一段','practiceSection')) + '<button class="text-button" data-do="levels">返回关卡</button>');
    } else if(session.kind==='endless') {
      const r=finalRecord||save.endlessRecord;
      openModal('result',modalTop('ENDLESS / STAGE '+run.stage,false)+'<h2>'+(run.distance>old.bestDistance?'新的距离纪录。':run.status==='finished'?'这段穿行，已保存。':'还可以更远。')+'</h2><p>'+(run.status==='finished'?'主动结束本局，成绩已计入纪录。':failureHint())+'</p><div class="result-number endless-distance">'+number(run.distance)+'<small>米</small></div>'+resultStats(r)+'<div class="result-grid"><div><span>坚持时间 / 阶段</span><strong>'+Math.floor(run.time)+' 秒 / '+run.stage+'</strong></div><div><span>危险路线奖励</span><strong class="bonus-count">'+run.bonusGems+' 次 / +'+number(run.bonusGems*200)+'</strong></div></div><div class="result-summary">历史最远 '+number(r.bestDistance)+' 米 · 第 '+r.attempts+' 次挑战</div>'+primary('同一路线，再挑战','retry','retry')+secondary('换一条路线','newRoute')+shareBlock()+'<button class="text-button" data-do="hub">返回挑战中心</button>');
    } else if(session.kind==='trial') {
      const r=finalRecord;
      openModal('result',modalTop('MECHANISM / '+pad(selected),false)+'<h2>'+(won?'机关试炼完成。':'换个选择，再来。')+'</h2><p>'+pad(selected)+' / '+l.name+'</p>'+(won?stars(run.stars):'<p>'+failureHint()+'</p><div class="result-number">'+Math.floor(run.progress*100)+'<small>%</small></div>')+resultStats(r)+'<div class="result-summary">危险奖励 '+run.bonusGems+' 次 / +'+number(run.bonusGems*200)+' 分 · 完成 '+r.wins+' 次 · 主线进度不变</div>'+primary('再挑战，刷新纪录','retry','retry')+(won?'':secondary('练习这一段','practiceSection'))+shareBlock()+'<button class="text-button" data-do="hub">返回挑战中心</button>');
    } else if(session.kind!=='campaign') {
      const r=finalRecord,isDaily=session.kind==='daily';
      openModal('result',modalTop(isDaily?'DAILY SIGNAL / '+session.dateKey:'REMIX / '+modeName(session.mode),false)+'<h2>'+(won?(isDaily?'每日挑战完成。':'又一种突破。'):'再试一次。')+'</h2><p>'+pad(selected)+' / '+l.name+' · '+modeName(session.mode)+'</p>'+(won?stars(run.stars):'<p>'+failureHint()+'</p><div class="result-number">'+Math.floor(run.progress*100)+'<small>%</small></div>')+resultStats(r)+'<div class="result-summary">完成 '+r.wins+' 次 · 尝试 '+r.attempts+' 次 · 主线进度不变</div>'+primary('再挑战，刷新纪录','retry','retry')+(won?'':secondary('练习这一段','practiceSection'))+shareBlock()+'<button class="text-button" data-do="hub">返回挑战中心</button>');
    } else if (won) {
      const allDone = selected === 15;
      openModal('result', modalTop(allDone ? 'THE OTHER SIDE / 15 OF 15' : run.score > old.bestScore && old.bestScore > 0 ? 'NEW SCORE RECORD' : 'SECTOR CLEAR',false) + '<h2>' + (allDone ? '你穿过了极限。' : '漂亮，继续向前。') + '</h2><p>' + pad(l.id) + ' / ' + l.name + ' · 已完成</p>' + stars(run.stars) + resultStats() + '<div class="result-grid"><div><span>收集晶体</span><strong>' + run.gems + ' / ' + run.totalGems + '</strong></div><div><span>' + (allDone ? '总星数' : '下一段旅程') + '</span><strong>' + (allDone ? totalStars() + ' / 45' : pad(selected+1) + ' / ' + levels[selected].name) + '</strong></div></div>' + (allDone ? '<p class="personal-best">15 关全部完成。' + (totalStars() === 45 ? '45 颗星，属于你的完美穿行。' : '重返赛道，收集全部 45 颗星。') + '</p>' : '') + primary(allDone ? '查看全部关卡' : '进入下一关',allDone ? 'levels' : 'next') + secondary('再次挑战 · 刷新纪录','retry') + (allDone ? '' : '<button class="text-button" data-do="levels">返回关卡</button>'));
    } else {
      openModal('result',modalTop(run.progress > old.progress ? 'NEW PERSONAL BEST' : 'ONE MORE TRY',false) + '<h2>就差一点。</h2><p>' + failureHint() + '</p><div class="result-number">' + Math.floor(run.progress*100) + '<small>%</small></div>' + resultStats() + '<div class="result-summary">最佳进度 ' + Math.floor(save.records[selected].progress*100) + '% · 第 ' + save.records[selected].attempts + ' 次挑战</div>' + primary('立即重试','retry','retry') + secondary('练习这一段','practiceSection') + '<button class="text-button" data-do="levels">返回关卡</button>');
    }
    if(!run.practice){
      const fresh=Challenges.getGoals(save).filter(g=>g.unlocked&&!earnedBefore.includes(g.id));
      if(fresh.length){const note=document.createElement('div');note.className='goal-unlock';const rewards=Rewards.CATALOG.filter(item=>fresh.some(g=>g.id===item.goal));note.textContent='新成就：'+fresh.map(g=>g.title).join(' · ')+'。解锁装扮：'+rewards.map(item=>item.name).join('、')+'（挑战中心 → 装扮收藏）';$('modal').insertBefore(note,$('modal').querySelector('.primary-button'));}
    }
    if(failureClip&&failureClip.end>failureClip.start){
      const button=document.createElement('button');button.className='secondary-button';button.dataset.do='replay';
      button.textContent='慢放最后 '+(failureClip.end-failureClip.start).toFixed(1)+' 秒';
      $('modal').querySelector('.primary-button').insertAdjacentElement('afterend',button);
    }
    resultHtml=$('modal').innerHTML;
  }
  function beginReplay() {
    if(phase!=='result'||!failureClip)return;
    closeModal();sounds.silence();resetTouches();phase='replay';
    replayState={clip:failureClip,start:failureClip.start,end:failureClip.end,time:failureClip.start,playing:true,rate:.5};
    $('play').classList.add('is-replay');$('replayDeck').classList.remove('hidden');
    $('replaySeek').min=replayState.start;$('replaySeek').max=replayState.end;
    $('announcement').innerHTML='';gameRenderer.reset();lastFrame=0;lastDraw=0;
    updateReplayControls();$('replayToggle').focus({preventScroll:true});resize();
  }
  function closeReplay() {
    if(phase!=='replay')return;
    replayState=null;phase='result';$('play').classList.remove('is-replay');$('replayDeck').classList.add('hidden');
    gameRenderer.reset();Object.keys(hudValues).forEach(key=>delete hudValues[key]);updateHud();resize();
    openModal('result',resultHtml);
    const button=$('modal').querySelector('[data-do="replay"]');if(button)button.focus({preventScroll:true});
  }
  function updateReplayControls() {
    if(!replayState)return;
    const state=replayState;
    $('replayLabel').textContent='失败回放 · '+(state.rate===.5?'0.5':'1')+'×';
    $('replayTime').textContent=state.time.toFixed(1)+' / '+state.end.toFixed(1)+' 秒';
    $('replaySeek').value=state.time;
    $('replaySeek').setAttribute('aria-valuetext',state.time.toFixed(1)+' 秒');
    $('replayToggle').textContent=state.playing?'暂停回放':state.time>=state.end?'再看一次':'继续回放';
    $('replayToggle').setAttribute('aria-pressed',String(state.playing));
    $('replayRate').textContent=state.rate===.5?'切换 1×':'切换 0.5×';
  }
  function currentGhost() {
    return run&&save.ghostEnabled&&ghostTrack?Replay.sample(ghostTrack,run.time):null;
  }
  function drawReplay(dt) {
    const state=replayState;
    if(state.playing){state.time=Math.min(state.end,state.time+dt*state.rate);if(state.time>=state.end)state.playing=false;}
    const view=Replay.view(state.clip,state.time);
    if(view){
      gameRenderer.draw(view,dt,'replay',effects());
      textHud('scoreCount',number(view.score));textHud('gemCount',view.gems);
      textHud('runPercent',view.level.endless?number(view.distance)+' 米':Math.floor(view.progress*100)+'%');
      textHud('comboCount',view.combo>=2?view.combo+' 连击':'回看变道与起跳时机');
      $('comboCount').classList.toggle('active',view.combo>=5);
      $('runProgress').style.width=(view.level.endless?view.time%25/25:view.progress)*100+'%';
      if(view.level.endless)textHud('gameSpeed','阶段 '+view.stage+' · 失败前路线');
    }
    updateReplayControls();
  }
  function actionFeedback(action) {
    sounds.play(action);
    if (action === 'jump') { vibrate(10); gameRenderer.emit('jump',run.lane); }
    const button = document.querySelector('[data-action="' + action + '"]');
    button.classList.add('pressed'); setTimeout(() => button.classList.remove('pressed'),100);
  }
  function perform(action) {
    if (phase !== 'running' || !run) return;
    initAudio(); const result = run.input(action);
    if (result === 'performed') actionFeedback(action);
    if (result) updateHud();
  }

  function handleBack() {
    if (phase === 'replay') closeReplay();
    else if (modalKind === 'importPreview') {pendingImport=null;closeModal();}
    else if (modalKind === 'help') { const back = helpReturn; closeModal(); if (back) prepare(selected,session); }
    else if (modalKind === 'prepare' || modalKind === 'settings') { closeModal(); if (screen === 'home') updateHome(); else if (screen === 'levels'||screen==='hub') theme(1); }
    else if (modalKind === 'pause') resume();
    else if (modalKind === 'result') returnToMenu();
    else if (screen === 'controlsPage') closeControls();
    else if (screen === 'backupPage') {backupReadToken++;pendingImport=null;showScreen('home');settings();}
    else if (screen === 'play') pause();
    else if (screen === 'wardrobe') showScreen('hub');
    else if (screen === 'levels'||screen==='hub') showScreen('home');
    else if (window.NativeGame && NativeGame.exit) NativeGame.exit();
  }
  function command(action) {
    initAudio();
    if (['sound','music','vibration','effects','ghostEnabled'].includes(action)) {
      save[action] = !save[action]; persist(); sounds.configure(save.sound,save.music);
      theme(run ? run.level.chapter : levels[save.unlocked-1].chapter);
      if (modalKind === 'settings') settings();
      else if (modalKind === 'pause' && action === 'sound') $('modal').querySelector('[data-do="sound"]').textContent = '音效：' + (save.sound ? '开启' : '关闭');
      else if (modalKind === 'pause' && action === 'ghostEnabled') $('modal').querySelector('[data-do="ghostEnabled"]').textContent='最佳录像影子：'+(save.ghostEnabled?'开启':'关闭');
      if (action === 'sound' && save.sound) sounds.play('gem',1);
      if (action === 'vibration' && save.vibration) vibrate(25);
      return;
    }
    switch (action) {
      case 'home': showScreen('home'); break;
      case 'levels': if(run&&run.level.endless&&phase==='paused'&&run.status==='running'){run.finishEndless();finish();}if(screen==='home')showScreen('levels');else returnToMenu();break;
      case 'hub': showScreen('hub');break;
      case 'wardrobe': showScreen('wardrobe');break;
      case 'replay': beginReplay();break;
      case 'replayBack': closeReplay();break;
      case 'replayToggle': if(replayState){if(replayState.time>=replayState.end)replayState.time=replayState.start;replayState.playing=!replayState.playing;lastFrame=0;updateReplayControls();}break;
      case 'replayRestart': if(replayState){replayState.time=replayState.start;replayState.playing=true;lastFrame=0;updateReplayControls();}break;
      case 'replayRate': if(replayState){replayState.rate=replayState.rate===.5?1:.5;updateReplayControls();}break;
      case 'trial': prepare(trialBase,{kind:'trial',baseId:trialBase,mode:'normal',code:Expedition.encodeTrialCode(trialBase)});break;
      case 'endless': case 'newRoute': newEndless();break;
      case 'endRun': if(run&&run.level.endless&&phase==='paused'&&run.status==='running'){run.finishEndless();sounds.silence();finish();}break;
      case 'daily': refreshDaily();prepare(hubDaily.baseId,hubDaily);break;
      case 'variant': prepare(variantBase,{kind:'level',baseId:variantBase,mode:variantMode,code:Challenges.encodeLevelCode(variantBase,variantMode)});break;
      case 'importCode': importCode();break;
      case 'copyCode': copyCode(session.code,$('outgoingCode'));break;
      case 'copyDaily': refreshDaily();copyCode(hubDaily.code);break;
      case 'continue': prepare(save.unlocked); break;
      case 'start': start(selected); break;
      case 'retry': { const practice = !!(run && run.practice); if(run&&run.level.endless&&phase==='paused'&&run.status==='running'){run.finishEndless();finish();} start(selected, {quick:true,practice,startRow:practiceStartRow}); break; }
      case 'practice': start(selected,{practice:true}); break;
      case 'practiceSection': { const row = run && run.failure ? Math.max(0,run.failure.row-2) : 0; start(selected,{practice:true,startRow:row}); break; }
      case 'official': start(selected); break;
      case 'next': { const nextId = Math.min(15, selected + 1); showScreen('levels'); prepare(nextId); break; }
      case 'pause': pause(); break;
      case 'resume': resume(); break;
      case 'settings': settings(); break;
      case 'controls': openControls();break;
      case 'controlsBack': closeControls();break;
      case 'resetControls': save.controls=Controls.clean(null);persist();renderControls();toast('已恢复默认触控设置');break;
      case 'backup': openBackup();break;
      case 'backupBack': handleBack();break;
      case 'exportBackup': exportBackup();break;
      case 'showBackupText': showBackupText();break;
      case 'copyBackup': copyBackup();break;
      case 'chooseBackup': chooseBackup();break;
      case 'previewBackup': previewBackup($('backupImportText').value,false);break;
      case 'confirmImport': confirmImport();break;
      case 'cancelImport': pendingImport=null;closeModal();break;
      case 'restoreBackup': previewBackup(readRecovery(),true);break;
      case 'help': help(); break;
      case 'helpDone': { const back = helpReturn; closeModal(); if (back) prepare(selected,session); break; }
      case 'close': handleBack(); break;
    }
  }
  document.addEventListener('click', e => {
    const button = e.target.closest('button'); if (!button || button.disabled || (modalKind && !$('modal').contains(button))) return;
    if(button.dataset.equip){equipReward(button.dataset.equip);return;}
    if(button.dataset.controlToggle){const key=button.dataset.controlToggle;changeControl(key,!save.controls[key]);return;}
    if(button.dataset.mode){variantMode=button.dataset.mode;updateVariant();return;}
    if (button.dataset.do) command(button.dataset.do);
    if (button.dataset.level) {
      const id = Number(button.dataset.level);
      if (id > save.unlocked) toast('先完成第 ' + (id - 1) + ' 关，解锁这段旅程'); else prepare(id);
    }
  });
  $('trialLevel').addEventListener('change',()=>{trialBase=Number($('trialLevel').value)||1;updateTrial();});
  document.querySelectorAll('[data-control]').forEach(el=>el.addEventListener('change',()=>changeControl(el.dataset.control,el.dataset.control==='lift'?Number(el.value):el.value)));
  document.addEventListener('change',event=>{if(event.target.id==='importMode')updateImportPreview();});
  $('backupFile').addEventListener('change',()=>{
    const file=$('backupFile').files[0];if(!file)return;
    if(file.size>800000){backupStatus('文件太大，请选择游戏导出的备份文件。',true);return;}
    const token=++backupReadToken,reader=new FileReader();setBackupBusy(true);
    reader.onload=()=>{setBackupBusy(false);if(token===backupReadToken&&screen==='backupPage')previewBackup(String(reader.result),false);};
    reader.onerror=()=>{setBackupBusy(false);if(token===backupReadToken)backupStatus('文件读取失败，也可以粘贴完整备份文本。',true);};
    reader.readAsText(file,'UTF-8');
  });
  $('replaySeek').addEventListener('input',()=>{if(replayState){replayState.time=Math.max(replayState.start,Math.min(replayState.end,Number($('replaySeek').value)));replayState.playing=false;lastFrame=0;updateReplayControls();}});
  $('variantLevel').addEventListener('change',()=>{const n=Number($('variantLevel').value);variantBase=n>=1&&n<=15?n:1;updateVariant();});
  document.querySelectorAll('[data-action]').forEach(button => {
    button.addEventListener('pointerdown', e => { if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault(); perform(button.dataset.action); });
    // Keyboard/assistive activation emits a click without a pointer event.
    button.addEventListener('click', e => { if (e.detail === 0) perform(button.dataset.action); });
  });
  document.querySelectorAll('[data-lab-action]').forEach(button=>{
    button.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'&&event.button!==0)return;event.preventDefault();labAction(button.dataset.labAction);});
    button.addEventListener('click',event=>{if(event.detail===0)labAction(button.dataset.labAction);});
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && modalKind) {
      const focusables = Array.from($('modal').querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])'));
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if(e.key==='Enter' && document.activeElement===$('friendCode')){e.preventDefault();importCode();return;}
    if (e.repeat) return;
    if (e.key === 'Escape') { e.preventDefault(); handleBack(); return; }
    if (modalKind === 'result' && e.key.toLowerCase() === 'r') { e.preventDefault(); command('retry'); return; }
    if (screen !== 'play' || modalKind) return;
    if (phase === 'replay') return;
    const map = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'jump', ' ': 'jump', w: 'jump', W: 'jump' };
    if (map[e.key]) { e.preventDefault(); perform(map[e.key]); }
    if (e.key.toLowerCase() === 'p') pause();
  });
  function attachGesture(element,gesture,enabled,action){
    // These surfaces handle taps and swipes through PointerEvents. Cancel the
    // browser's parallel touch gesture so a short swipe cannot swallow the next
    // menu tap; buttons outside the surface keep their normal native clicks.
    element.addEventListener('touchstart',event=>{if(enabled()&&event.cancelable)event.preventDefault();},{passive:false});
    element.addEventListener('pointerdown',event=>{
      if(!enabled()||(event.pointerType==='mouse'&&event.button!==0))return;
      event.preventDefault();
      if(gesture.begin(event.pointerId,event.clientX,event.clientY,performance.now(),save.controls))try{element.setPointerCapture(event.pointerId);}catch(_){}
    });
    element.addEventListener('pointermove',event=>{if(!enabled()){gesture.cancel();return;}event.preventDefault();const result=gesture.move(event.pointerId,event.clientX,event.clientY);if(result)action(result);});
    element.addEventListener('pointerup',event=>{if(!enabled()){gesture.cancel();return;}const result=gesture.end(event.pointerId,event.clientX,event.clientY,performance.now());if(result)action(result);});
    ['pointercancel','lostpointercapture'].forEach(name=>element.addEventListener(name,()=>gesture.cancel()));
  }
  attachGesture($('gameCanvas'),gameTouch,()=>screen==='play'&&phase==='running'&&!modalKind,perform);
  attachGesture($('controlLab'),labTouch,()=>screen==='controlsPage'&&!modalKind,labAction);
  function backgroundPause() { resetTouches(); pause(); sounds.suspend(); }

  document.addEventListener('visibilitychange', () => { if (document.hidden) backgroundPause(); lastFrame = 0; });
  window.addEventListener('blur', backgroundPause);
  window.addEventListener('nativePause', backgroundPause);
  window.addEventListener('nativeResume', () => { lastFrame = 0; });
  window.addEventListener('nativeBack', handleBack);
  window.addEventListener('nativeBackup',event=>{
    const detail=event.detail||{};if(!['import','export'].includes(detail.kind)||!['ok','cancel','error'].includes(detail.status))return;
    setBackupBusy(false);
    if(screen!=='backupPage')return;
    if(detail.status==='cancel'){backupStatus('已取消，当前进度没有改变。');return;}
    if(detail.status==='error'){backupStatus(typeof detail.message==='string'?detail.message:'备份文件操作未完成，当前进度没有改变。',true);return;}
    if(detail.kind==='export')backupStatus('备份文件已保存，可以把它带到另一台设备导入。');
    else if(typeof detail.text==='string')previewBackup(detail.text,false);
  });

  const heroRenderer = new PulseRenderer($('heroCanvas'),true);
  const gameRenderer = new PulseRenderer($('gameCanvas'),false);
  const wardrobeRenderer = new PulseRenderer($('wardrobeCanvas'),true);
  function resize() { heroRenderer.resize(); gameRenderer.resize(); wardrobeRenderer.resize(); lastDraw=0; }
  window.addEventListener('resize',resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('app'));
  function textHud(id,value) { if (hudValues[id]!==value) { hudValues[id]=value; $(id).textContent=value; } }
  function impact(text,kind) { $('impactLabel').textContent=text; $('impactLabel').dataset.kind=kind||'gem'; $('impactLabel').classList.add('show'); feedbackUntil=ambientTime+.85; }

  function updateHud() {
    if (!run) return;
    const ghost=currentGhost();
    textHud('ghostComparison',!save.ghostEnabled?'最佳录像影子已关闭':ghost?'较影子 '+(run.score>=ghost.score?'+':'−')+number(Math.abs(run.score-ghost.score))+' 分':ghostTrack?'影子记录至 '+ghostTrack.end.toFixed(1)+' 秒':'完成本局，留下操作影子');
    const endless=!!run.level.endless;
    textHud('gemCount',run.gems);textHud('runPercent',endless?number(run.distance)+' 米':Math.floor(run.progress*100)+'%');
    if(endless&&hudValues.stage!==run.stage){
      const previous=hudValues.stage;hudValues.stage=run.stage;theme(run.level.chapter);
      textHud('gameSpeed','阶段 '+run.stage+' · 难度 '+Math.min(8,run.stage)+'/8');
      if(previous&&phase==='running')toast('进入阶段 '+run.stage+' · '+(run.stage>=8?'保持极限节奏':'节奏加快'));
    }
    let cue='';
    if(session.kind==='trial'||endless){
      const row=run.level.rows[run.nextRow],lanes=['左道','中道','右道'];
      if(row&&row.t-run.time<=run.level.lookAhead){
        if(row.motion)cue='↔ 高墙落点：'+lanes[row.motion.to]+' · 提前换道';
        else if(row.gate){const state=Engine.rowState(row,run.time);cue='▥ '+lanes[row.gate.lane]+'闸门：'+(state.gateClosed?'关闭':'开启')+' · '+(state.gateLocked?'状态已锁定':'仍在开合');}
        else if(Number.isInteger(row.bonusGem))cue='◆ 金色奖励 +200 · 跳过障碍，或走普通晶体路线';
      }
    }
    textHud('mechanicHint',cue);
    textHud('scoreCount',number(run.score)); textHud('comboCount',run.combo>=2 ? run.combo+' 连击' : '收集晶体积累连击');
    $('comboCount').classList.toggle('active',run.combo>=5);
    const progress=endless?Math.round((run.time%25)/25*1000)/10:Math.round(run.progress*1000)/10;
    if (hudValues.progress!==progress) { $('runProgress').style.width=progress+'%'; hudValues.progress=progress; }
    const ready=Math.min(1,(run.time-run.jumpedAt)/Engine.JUMP_DURATION), charge=Math.floor(ready*20)*5;
    if (hudValues.charge!==charge) { $('jumpCharge').style.width=charge+'%'; hudValues.charge=charge; }
    textHud('jumpStatusText',run.bufferedJump?'已接续下一跳':ready>=1?'跃迁就绪':'空中 · 即将落地');
    $('jumpStatus').classList.toggle('queued',run.bufferedJump);
    const startTime=run.practice && practiceStartRow ? Math.max(0,run.level.rows[practiceStartRow].t-2.4) : 0;
    $('laneHint').style.opacity=run.time-startTime<6?'1':'0';
  }
  function processEvents() {
    for (const event of run.drainEvents()) {
      if (event.type==='input') actionFeedback(event.action);
      if (event.type==='gem') {
        gameRenderer.emit('gem',event.lane); sounds.play('gem',event.combo);
        if (event.combo>0 && event.combo%5===0) { impact(event.combo+' 连击 / FLOW','combo'); vibrate(18); }
      }
      if (event.perfectJump) { sounds.play('perfect'); impact('精准跃迁 / PERFECT','perfect'); }
      if(event.bonusPoints){impact('危险路线 +'+event.bonusPoints,'perfect');vibrate(20);}
      if (event.type==='crash') { sounds.silence(); gameRenderer.emit('crash',run.lane); vibrate(90); sounds.play('crash'); impact('信号中断','crash'); phase='ending';endDelay=.42; }
      if (event.type==='win') { sounds.silence();gameRenderer.emit('win',run.lane);sounds.play('win');vibrate(35);phase='ending';endDelay=.75; }
    }
  }
  function frame(timestamp) {
    const elapsed=lastFrame?(timestamp-lastFrame)/1000:0;lastFrame=timestamp;
    if (elapsed>.3 && phase==='running') pause();
    const dt=Math.max(0,Math.min(.3,elapsed));ambientTime+=dt;
    if(screen==='hub'&&!modalKind&&timestamp-lastDateCheck>1000){lastDateCheck=timestamp;if(hubDaily.dateKey!==Challenges.localDateKey())refreshDaily();}
    if (feedbackUntil && ambientTime>feedbackUntil) { $('impactLabel').classList.remove('show');feedbackUntil=0; }
    if (screen==='home' && !document.hidden && timestamp-lastDraw>=(effects()?1000/30:250)) {
      heroRenderer.drawHome(ambientTime,levels[save.unlocked-1].chapter,effects());lastDraw=timestamp;
    }
    if(screen==='wardrobe'&&!document.hidden&&(!lastDraw||timestamp-lastDraw>=(effects()?1000/30:250))){
      wardrobeRenderer.drawPreview(ambientTime,Rewards.appearance(save.equipped),effects());lastDraw=timestamp;
    }
    if (screen==='play' && run && !document.hidden) {
      if(phase==='replay'){
        if(elapsed>.3)replayState.playing=false;
        drawReplay(elapsed>.3?0:dt);lastDraw=timestamp;
        requestAnimationFrame(frame);return;
      }
      if (phase==='countdown') {
        countdown-=dt;
        const count=countdownTotal<1?'GO':String(Math.max(1,Math.ceil(countdown/(countdownTotal/3))));
        if (count!==lastCount) { lastCount=count; $('announcement').innerHTML=count+'<small>'+(run.practice?'专注这一段 · 练习模式':countdownTotal<1?'再来一次':run.time>0?'重新对准节奏':'准备穿行')+'</small>';if(count!=='GO')sounds.play('count'); }
        if(countdown<=0){phase='running';$('announcement').innerHTML='';sounds.play('go');}
      } else if(phase==='running') {
        let remain=dt;
        while(remain>1e-7 && run.status==='running'){const step=Math.min(1/120,remain);run.step(step);remain-=step;}
        processEvents();
        const height=run.jumpHeight();
        if(previousJumpHeight>0 && height===0 && run.status==='running'){sounds.play('land');gameRenderer.emit('land',run.lane);vibrate(9);}
        previousJumpHeight=height;
        if(phase==='running')sounds.tick(run.time,run.level.chapter,run.combo);
      } else if(phase==='ending'){endDelay-=dt;if(endDelay<=0)finish();}
      if(timestamp-lastHud>48 || phase==='ending'){updateHud();lastHud=timestamp;}
      const stationary=phase==='paused'||phase==='result';
      if(!stationary || !lastDraw || timestamp-lastDraw>250){gameRenderer.draw(run,dt,phase,effects(),currentGhost());lastDraw=timestamp;}
    }
    requestAnimationFrame(frame);
  }

  applyAppearance(); applyControls(); updateHome(); resize(); requestAnimationFrame(frame);
  // Read-only snapshot for automated smoke checks; no gameplay bypasses are exposed.
  window.PulseGame = Object.freeze({ snapshot: () => ({ version:'1.5.1',distance:run?run.distance:0,stage:run?run.stage:1,bonusGems:run?run.bonusGems:0,rowCount:run?run.level.rows.length:0,session:Object.assign({},session),hubDateKey:hubDaily?hubDaily.dateKey:null,goals:Challenges.getGoals(save).filter(g=>g.unlocked).length,screen,phase,modal:modalKind,selected,time:run?run.time:0,status:run?run.status:null,lane:run?run.lane:null,gems:run?run.gems:0,score:run?run.score:0,combo:run?run.combo:0,maxCombo:run?run.maxCombo:0,jumpHeight:run?run.jumpHeight():0,bufferedJump:run?run.bufferedJump:false,practice:!!(run&&run.practice),practiceStartRow,unlocked:save.unlocked,stars:totalStars(),effects:save.effects,music:save.music,sound:save.sound,chapter:run?run.level.chapter:levels[save.unlocked-1].chapter,
    controls:Object.assign({},save.controls),labLane:labLane,backupBusy:backupBusy,importPending:!!pendingImport,
    equipped:Object.assign({},save.equipped),rewardCount:Rewards.getItems(save).filter(item=>item.goal&&item.unlocked).length,ghostEnabled:save.ghostEnabled,recordedTracks:save.replays.length,
    ghost:{available:!!ghostTrack,visible:!!currentGhost()&&screen==='play'&&phase!=='replay',key:ghostTrack?ghostTrack.key:null,score:ghostTrack?ghostTrack.score:0,end:ghostTrack?ghostTrack.end:0},
    replay:replayState?{start:replayState.start,end:replayState.end,time:replayState.time,playing:replayState.playing,rate:replayState.rate}:null
  }) });
})();
