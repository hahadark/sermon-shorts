/* SS_TEST_SCRIPT=smoothpreview : 미리보기용 영상 자동 교체 + 건너뛸 때 끊김 + 미리보기 자막 지연 */
(function(){window.addEventListener('ss:run-test-script',async e=>{if(e.detail!=='smoothpreview')return;const SS=window.SS,A=window.api;let dir='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];const ck=(n,ok,info)=>{checks.push({n,ok:!!ok,info});if(!ok)throw Error(n+' '+JSON.stringify(info));};
try{const l=await A.getLaunchInfo();dir=l.cache+'/smoothpreview';await A.mkdir(dir);const st=SS.state,v=SS.preview.video;
 // 1) 미리보기용 영상이 만들어져 미리보기만 바뀌는지
 const t0=performance.now();for(let i=0;i<600&&!(SS.previewProxy.state==='ready');i++)await sleep(200);
 ck('미리보기용 영상 준비',SS.previewProxy.state==='ready',{state:SS.previewProxy.state,ms:Math.round(performance.now()-t0)});
 ck('미리보기는 미리보기용 영상',/[\\/]proxy[\\/][0-9a-f]{16}\.mp4$/.test(SS.preview.mediaPath),SS.preview.mediaPath);
 ck('편집·출력 원본은 그대로',st.source.path===SS.preview.path&&!/proxy/.test(st.source.path),st.source.path);
 const statusEl=document.getElementById('proxyStatus');ck('상태 표시',statusEl&&/부드러운 미리보기/.test(statusEl.textContent),statusEl&&statusEl.textContent);
 // 2) 편집: 3초마다 지우기
 SS.pushUndo();let last=st.words[0].start;for(const w of st.words){if(w.start-last>3){w.del=true;if(w.end-last>3.6)last=w.end;}}SS.renderTranscript();if(SS.setEditedPlayMode)SS.setEditedPlayMode(true);await SS.updateTemplatePreview();
 const segs=SS.getSegments();
 // 3) 재생하며: 건너뛰기 끊김, 자막이 바뀐 순간의 지연(새 방식 실측 / 예전 timeupdate 방식이라면)
 const jumps=[];let pend=null;const os=SS.preview.seek.bind(SS.preview);SS.preview.seek=function(t){if(!v.paused){pend={to:t,t0:performance.now(),ms:null};jumps.push(pend);}return os(t);};
 const onF=(now,m)=>{if(pend&&Math.abs(m.mediaTime-pend.to)<0.25){pend.ms=now-pend.t0;pend=null;}v.requestVideoFrameCallback(onF);};v.requestVideoFrameCallback(onF);
 const lines=SS._cachedLines;const lagNew=[],lagOld=[];let lastKey=SS.captionKeyAt(v.currentTime,st.activeTheme);
 const origUpd=SS.updateTemplatePreview;SS.updateTemplatePreview=async function(){const out=SS.edl.srcToOut(SS._cachedSegs,v.currentTime);const r=await origUpd.apply(this,arguments);const key=SS.captionKeyAt(v.currentTime,st.activeTheme);if(!v.paused&&key!==lastKey&&out!=null){const ln=lines.find(x=>out>=x.outStart&&out<x.outEnd);if(ln&&out-ln.outStart<0.6)lagNew.push((out-ln.outStart)*1000);lastKey=key;}return r;};
 let prevLine=null;const onTU=()=>{if(v.paused)return;const out=SS.edl.srcToOut(SS._cachedSegs,v.currentTime);if(out==null)return;const ln=lines.find(x=>out>=x.outStart&&out<x.outEnd);if(ln&&ln!==prevLine){if(prevLine&&out-ln.outStart<0.6)lagOld.push((out-ln.outStart)*1000);prevLine=ln;}};v.addEventListener('timeupdate',onTU);
 await SS.preview.seek(segs[0].start);await sleep(300);SS.preview.play();await sleep(20000);SS.preview.pause();v.removeEventListener('timeupdate',onTU);SS.updateTemplatePreview=origUpd;
 const stat=a=>{const s=a.slice().sort((x,y)=>x-y);return s.length?{n:s.length,median:Math.round(s[Math.floor(s.length/2)]),p90:Math.round(s[Math.min(s.length-1,Math.floor(s.length*0.9))]),max:Math.round(s[s.length-1])}:{n:0};};
 const J=stat(jumps.filter(j=>j.ms!=null).map(j=>j.ms)),N=stat(lagNew),O=stat(lagOld);
 J.each=jumps.map(j=>j.ms==null?null:Math.round(j.ms));ck('건너뛰기 끊김 0.1초 안',J.n>=3&&J.p90<=100,J);ck('자막 변화 측정됨',N.n>=5,N);ck('자막 지연 한 화면(약 34ms) 안팎',N.p90<=50,N);
 // 4) 출력은 원본으로
 const ex=await SS.doExport(dir+'/out.mp4');ck('출력 성공',ex.success,ex.error);
 const r={success:true,checks,jumps:J,captionLagNew:N,captionLagOldTimeupdate:O,proxy:SS.preview.mediaPath};await A.writeText(dir+'/report.json',JSON.stringify(r,null,2));A.notifyTestReady({success:true});
}catch(err){if(dir)await A.writeText(dir+'/report.json',JSON.stringify({success:false,checks,error:err.stack},null,2));A.notifyTestError(err.stack);}});})();
