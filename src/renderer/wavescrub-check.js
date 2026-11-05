/* SS_TEST_SCRIPT=wavescrub : 파형을 끌어 재생선 옮기기(영상이 따라옴·밀리지 않음), 눈금/Shift 끌어 화면 옮기기, 가장자리 따라가기, 마우스 시각, 재생 바 정밀도 */
(function(){window.addEventListener('ss:run-test-script',async e=>{if(e.detail!=='wavescrub')return;const SS=window.SS,A=window.api,$=id=>document.getElementById(id);let dir='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];const ck=(n,ok,info)=>{checks.push({n,ok:!!ok,info:info===undefined?null:info});if(!ok)throw Error(n+' '+JSON.stringify(info));};
const waitFor=async(fn,ms,what)=>{const t0=Date.now();while(!fn()){if(Date.now()-t0>ms)throw Error('시간 초과: '+what);await sleep(30);}};
try{const l=await A.getLaunchInfo();dir=l.cache+'/wavescrub';await A.mkdir(dir);const w=SS.wave,c=$('waveCanvas'),v=SS.preview.video;
 if(SS.setEditedPlayMode)SS.setEditedPlayMode(false);
 await waitFor(()=>w.duration>0&&w.levels,20000,'파형');
 const R=()=>c.getBoundingClientRect();const fire=(type,fx,fy,o={})=>{const r=R();c.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:7,pointerType:'mouse',isPrimary:true,button:o.button??0,buttons:type==='pointerup'?0:1,shiftKey:!!o.shift,clientX:r.left+r.width*fx,clientY:r.top+(fy<1?r.height*fy:fy)}));};
 const tAt=fx=>w.viewStart+w.viewDur*fx;
 let seeks=0;const os=SS.preview.seek.bind(SS.preview);SS.preview.seek=t=>{seeks++;return os(t);};
 // 1) 끌어서 재생선 옮기기
 w.setView(0,w.duration);const vs0=w.viewStart;
 fire('pointerdown',0.2,0.6);ck('누르면 끄는 중',w.scrubbing);
 for(let i=1;i<=40;i++){fire('pointermove',0.2+0.4*i/40,0.6);await sleep(4);}
 ck('끄는 동안 재생선이 손을 따라감',Math.abs(w.playhead-tAt(0.6))<w.viewDur*0.01,{ph:w.playhead,want:tAt(0.6)});
 ck('끄는 동안 화면은 그대로',w.viewStart===vs0);
 fire('pointerup',0.6,0.6);ck('놓으면 끄기 끝',!w.scrubbing);
 await waitFor(()=>!v.seeking&&Math.abs(v.currentTime-tAt(0.6))<0.05,5000,'영상이 놓은 자리로');
 ck('영상이 놓은 자리로',Math.abs(v.currentTime-tAt(0.6))<0.05,{vt:v.currentTime,want:tAt(0.6)});
 ck('위치 이동이 밀리지 않음 (움직임 40번보다 훨씬 적게)',seeks<=20,{seeks});
 // 2) 클릭 한 번
 seeks=0;fire('pointerdown',0.35,0.6);fire('pointerup',0.35,0.6);await waitFor(()=>!v.seeking&&Math.abs(v.currentTime-tAt(0.35))<0.05,5000,'클릭');ck('클릭하면 그 자리로',true,{seeks});
 // 3) 눈금 끌어 화면 옮기기 (재생선은 그대로)
 w.setView(20,20);const ph=w.playhead,vs1=w.viewStart;
 fire('pointerdown',0.5,8);for(let i=1;i<=10;i++){fire('pointermove',0.5-0.3*i/10,8);await sleep(4);}fire('pointerup',0.2,8);
 ck('눈금을 끌면 화면이 옮겨짐',w.viewStart>vs1+3,{from:vs1,to:w.viewStart});ck('눈금 끌기는 재생선을 안 옮김',w.playhead===ph);
 // 4) Shift 끌기도 화면 옮기기
 const vs2=w.viewStart;fire('pointerdown',0.5,0.6,{shift:true});for(let i=1;i<=10;i++){fire('pointermove',0.5+0.3*i/10,0.6,{shift:true});await sleep(4);}fire('pointerup',0.8,0.6,{shift:true});
 ck('Shift+끌기는 화면 옮기기',w.viewStart<vs2-3&&w.playhead===ph,{from:vs2,to:w.viewStart});
 // 5) 가장자리에 대고 있으면 화면이 따라감
 w.setView(10,10);const vs3=w.viewStart;fire('pointerdown',0.5,0.6);fire('pointermove',0.995,0.6);await sleep(600);fire('pointerup',0.995,0.6);
 ck('오른쪽 끝에 대고 있으면 화면이 따라감',w.viewStart>vs3+0.5,{from:vs3,to:w.viewStart});
 // 6) 재생 중에 끌면 멈췄다가 놓은 자리부터 이어서 재생
 v.muted=true;await SS.preview.seek(30);SS.preview.play();await sleep(400);w.setView(0,w.duration);
 fire('pointerdown',0.7,0.6);ck('재생 중에 끌면 잠깐 멈춤',v.paused);fire('pointermove',0.72,0.6);fire('pointerup',0.72,0.6);
 await waitFor(()=>!v.paused,3000,'이어서 재생');await sleep(300);
 ck('놓은 자리부터 이어서 재생',!v.paused&&Math.abs(v.currentTime-tAt(0.72))<1.0,{vt:v.currentTime,want:tAt(0.72)});SS.preview.pause();
 // 7) 마우스 올리면 시각 표시
 fire('pointermove',0.4,0.6);ck('마우스 자리 기억',w._hover!=null);c.dispatchEvent(new PointerEvent('pointerleave'));ck('나가면 지움',w._hover==null);
 // 8) 재생 바: 10만 칸, 마지막 자리로만
 const sk=$('seek');ck('재생 바 10만 칸',Number(sk.max)===100000,sk.max);
 seeks=0;for(let i=0;i<=30;i++){sk.value=String(40000+i*300);sk.dispatchEvent(new Event('input'));}sk.dispatchEvent(new Event('change'));
 const want=(49000/100000)*SS.preview.duration;await waitFor(()=>!v.seeking&&Math.abs(v.currentTime-want)<0.05,5000,'재생 바');
 ck('재생 바를 끌면 마지막 자리로 (밀리지 않음)',seeks<=6,{seeks,vt:v.currentTime,want});
 // 9) 그리기: 재생선만 움직이면 파형은 다시 그리지 않음
 const b0=w.stats.base;for(let i=0;i<30;i++){w.setPlayhead(10+i*0.1,false);w.drawNow();}ck('재생선만 움직일 땐 파형 다시 안 그림',w.stats.base===b0,{base:w.stats.base-b0});
 fire('pointerdown',0.5,0.6);fire('pointermove',0.55,0.6);await sleep(50);await SS.testShot(dir+'/1_scrub.png');fire('pointerup',0.55,0.6);
 await A.writeText(dir+'/report.json',JSON.stringify({success:true,checks},null,2));A.notifyTestReady({success:true});
}catch(err){if(dir){await A.writeText(dir+'/report.json',JSON.stringify({success:false,checks,error:err.stack},null,2));await SS.testShot(dir+'/error.png');}A.notifyTestError(err.stack);}});})();
