/* SS_TEST_SCRIPT=skipgap : 편집 결과 재생에서 지운 곳을 건너뛸 때 끊기는 시간을 잰다.
 * 건너뛸 때마다 [넘어가기 시작 → 새 위치 화면이 실제로 그려짐] 시간과, 소리가 꺼져 있던 시간을 기록한다. */
(function(){window.addEventListener('ss:run-test-script',async e=>{if(e.detail!=='skipgap')return;const SS=window.SS,A=window.api;let dir='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{const l=await A.getLaunchInfo();dir=l.cache+'/skipgap';await A.mkdir(dir);const st=SS.state;const W=st.words;
 // 3초마다 0.6초 남짓 지운다 (말 사이를 자른 편집처럼 구간이 많게)
 SS.pushUndo();let last=W[0].start;for(const w of W){if(w.start-last>3){w.del=true;if(w.end-last>3.6)last=w.end;}}SS.renderTranscript();
 if(SS.setEditedPlayMode)SS.setEditedPlayMode(true);const segs=SS.getSegments();const v=SS.preview.video;
 const jumps=[];const os=SS.preview.seek.bind(SS.preview);let pend=null;
 SS.preview.seek=function(t){const j={from:v.currentTime,to:t,t0:performance.now(),frame:null};if(!v.paused){jumps.push(j);pend=j;}return os(t);};
 const onFrame=(now,meta)=>{if(pend&&Math.abs(meta.mediaTime-pend.to)<0.25){pend.frame=now-pend.t0;pend=null;}v.requestVideoFrameCallback(onFrame);};v.requestVideoFrameCallback(onFrame);
 let mutedMs=0,lastT=performance.now();const mm=setInterval(()=>{const n=performance.now();if(v.muted)mutedMs+=n-lastT;lastT=n;},5);
 await SS.preview.seek(segs[0].start);await sleep(300);const t0=performance.now();SS.preview.play();await sleep(Number(l.testSeconds)||20000);SS.preview.pause();clearInterval(mm);
 const wall=performance.now()-t0;const fr=jumps.filter(j=>j.frame!=null).map(j=>j.frame).sort((a,b)=>a-b);const q=p=>fr.length?Math.round(fr[Math.min(fr.length-1,Math.floor(p*fr.length))]):null;
 const r={success:true,source:SS.preview.path.split(/[\\/]/).pop(),segments:segs.length,jumps:jumps.length,measured:fr.length,median_ms:q(0.5),p90_ms:q(0.9),max_ms:fr.length?Math.round(fr[fr.length-1]):null,muted_ms_total:Math.round(mutedMs),wall_ms:Math.round(wall),muted_ratio:+(mutedMs/wall).toFixed(3)};
 await A.writeText(dir+'/report-'+r.source+'.json',JSON.stringify(r,null,2));A.notifyTestReady({success:true});}catch(err){if(dir)await A.writeText(dir+'/error.json',JSON.stringify({error:err.stack}));A.notifyTestError(err.stack);}});})();
