/* SS_TEST_SCRIPT=reorder : 칸을 끌어 설교 내용 순서 바꾸기 → 칸 목록·미리보기 재생·미리보기 자막·되돌리기·저장·출력(소리까지) */
(function(){window.addEventListener('ss:run-test-script',async e=>{if(e.detail!=='reorder')return;const SS=window.SS,A=window.api,$=id=>document.getElementById(id);let dir='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];const ck=(n,ok,info)=>{checks.push({n,ok:!!ok,info:info===undefined?null:info});if(!ok)throw Error(n+' '+JSON.stringify(info));};
const waitFor=async(fn,ms,what)=>{const t0=Date.now();while(!fn()){if(Date.now()-t0>ms)throw Error('시간 초과: '+what);await sleep(30);}};
try{const l=await A.getLaunchInfo();dir=l.cache+'/reorder';await A.mkdir(dir);const st=SS.state,v=SS.preview.video,body=$('transcriptBody');
 await waitFor(()=>st.words&&st.words.length>50&&body.querySelector('.caption-grip'),20000,'칸');
 // 앞 30초만 쓰도록 나머지를 지운다 (출력 시험을 짧게)
 SS.pushUndo();for(const w of st.words)if(w.start>30)w.del=true;SS.renderTranscript();await sleep(200);
 if(SS.setEditedPlayMode)SS.setEditedPlayMode(true);
 const sections=()=>Array.from(body.querySelectorAll('.caption-block'));
 const lineSecs=()=>sections().filter(s=>s.querySelector('.caption-grip'));
 const textOf=s=>s.querySelector('.caption-output').value;
 const before=lineSecs().map(textOf);ck('칸 손잡이',before.length>=4,before.length);
 ck('처음엔 원래 순서로 단추 숨김',$('btnResetOrder').hidden);
 // 1) 진짜 끌어 놓기: 셋째 칸을 첫째 칸 위에
 const src=lineSecs()[2],dst=lineSecs()[0];const moved=textOf(src);
 const dt=new DataTransfer();const grip=src.querySelector('.caption-grip');
 grip.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
 const r=dst.getBoundingClientRect();const opt={bubbles:true,cancelable:true,dataTransfer:dt,clientX:r.left+20,clientY:r.top+4};
 dst.dispatchEvent(new DragEvent('dragover',opt));ck('놓일 자리 파란 선',dst.classList.contains('drop-before'));
 dst.dispatchEvent(new DragEvent('drop',opt));grip.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));await sleep(300);
 const after1=lineSecs().map(textOf);
 ck('끌어 놓으면 맨 위로',after1[0]===moved,{after:after1.slice(0,4),moved});
 ck('나머지는 그대로 뒤따름',JSON.stringify(after1.slice(1,3))===JSON.stringify(before.slice(0,2)),after1.slice(0,4));
 ck('순서 기록',Array.isArray(st.order)&&st.order.length>1,st.order);
 ck('원래 순서로 단추·표시',!$('btnResetOrder').hidden&&/순서 바꿈/.test($('lblCaptionStats').textContent));
 ck('칸 번호는 새 순서대로',sections()[0].querySelector('strong').textContent==='001');
 const segs=SS.getSegments();
 ck('구간도 새 순서 (첫 구간이 원본에서 더 뒤)',segs[0].start>segs[1].start,segs.slice(0,3).map(s=>[+s.start.toFixed(2),+s.end.toFixed(2)]));
 const W=st.words,ix=new Map(W.map((w,i)=>[w.id,i]));const nextLive=W[ix.get(segs[0].lastWordId)+1];
 ck('옮긴 칸 끝에 뒤따르던 말소리가 새지 않음',!nextLive||nextLive.del||segs[0].end<=nextLive.start+1e-9,{end:segs[0].end,next:nextLive&&nextLive.start});
 // 2) 미리보기 재생: 첫 구간 → 원본 앞쪽 구간으로 되돌아가 이어 틀기
 v.muted=true;await SS.preview.seek(segs[0].start);const visited=[];let lastI=-1;
 const watch=()=>{const p=SS.playback.plan(v.currentTime);const i=p.action==='ok'?p.seg:-1;if(i>=0&&i!==lastI){visited.push(i);lastI=i;}};
 const iv=setInterval(watch,15);SS.preview.play();
 await waitFor(()=>visited.includes(2)||v.paused,25000,'세 구간 재생');clearInterval(iv);
 const cap=SS.captionKeyAt(v.currentTime,st.activeTheme);SS.preview.pause();
 ck('미리보기가 바뀐 순서로 재생 (0→1→2)',JSON.stringify(visited.slice(0,3))==='[0,1,2]',visited);
 // 3) 미리보기 자막: 첫 구간 안에서는 옮긴 칸의 자막
 await SS.preview.seek(segs[0].start+0.2);await SS.updateTemplatePreview();
 const out=SS.playback.outAt(segs,v.currentTime);const ln=SS.getLines().find(x=>out>=x.outStart&&out<x.outEnd);
 ck('첫 구간의 자막 = 옮긴 칸',ln&&moved.startsWith(ln.text.slice(0,4)),{line:ln&&ln.text,moved});
 // 4) Alt+↓ 로 맨 위 칸을 한 칸 아래로
 const ta=lineSecs()[0].querySelector('.caption-output');ta.focus();await sleep(100);
 ta.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));await sleep(300);
 const after2=lineSecs().map(textOf);
 ck('Alt+↓ 로 한 칸 아래',after2[1]===moved&&after2[0]===before[0],after2.slice(0,4));
 // 5) 되돌리기·다시 실행
 SS.undo();await sleep(200);ck('Ctrl+Z: 바로 앞 순서',lineSecs().map(textOf)[0]===moved);
 SS.redo();await sleep(200);ck('Ctrl+Y: 다시',lineSecs().map(textOf)[1]===moved);
 // 6) 저장·다시 열기 (단어 번호를 다시 매겨도 순서 유지)
 const order0=JSON.stringify(SS.getSegments().map(s=>[s.start,s.end]));
 await SS.saveProjectTo(dir+'/order.sshorts');st.order=null;SS.renderTranscript();
 await SS.openProjectFrom(dir+'/order.sshorts');await sleep(300);
 ck('저장했다 열어도 같은 순서',JSON.stringify(SS.getSegments().map(s=>[s.start,s.end]))===order0&&lineSecs().map(textOf)[1]===moved);
 // 7) 출력: 바뀐 순서 그대로 (자막·길이·소리)
 const segsE=SS.getSegments(),want=segsE.reduce((n,s)=>n+s.end-s.start,0);
 const ex=await SS.doExport(dir+'/out.mp4');ck('출력 성공',ex.success,ex.error);
 ck('출력 길이 = 남긴 구간 합',Math.abs(ex.duration-want)<0.01,{dur:ex.duration,want});
 const srt=await A.readText?await A.readText(ex.srtPath):null;
 // 소리: 출력의 두 번째 구간 시작 1초와, 원본에서 그 구간 1초를 맞대어 본다
 const off1=segsE[0].end-segsE[0].start;
 const pcm=async(p,a,b)=>new Float32Array(await A.getPcm(p,a,b,8000));
 const corr=(x,y)=>{let n=Math.min(x.length,y.length),sx=0,sy=0,sxx=0,syy=0,sxy=0;for(let i=0;i<n;i++){sx+=x[i];sy+=y[i];sxx+=x[i]*x[i];syy+=y[i]*y[i];sxy+=x[i]*y[i];}const c=sxy-sx*sy/n,d=Math.sqrt((sxx-sx*sx/n)*(syy-sy*sy/n));return d?c/d:0;};
 const best=async(outA,srcA)=>{const o=await pcm(ex.outPath,outA,outA+1.2),s=await pcm(st.source.path,srcA-0.1,srcA+1.3);let m=-1;for(let lag=0;lag<=1600;lag+=8)m=Math.max(m,corr(o,s.subarray(lag,lag+o.length)));return +m.toFixed(3);};
 const c0=await best(0.15,segsE[0].start+0.15),c1=await best(off1+0.15,segsE[1].start+0.15),wrong=await best(0.15,segsE[1].start+0.15);
 ck('출력 첫 소리 = 첫 구간(옮긴 칸 다음 순서) 원본',c0>0.8,{c0});ck('출력 둘째 구간 소리 = 그 구간 원본',c1>0.8,{c1});ck('엉뚱한 구간과는 다름',wrong<0.6,{wrong});
 // 8) 원래 순서로
 $('btnResetOrder').click();await sleep(300);
 ck('원래 순서로 단추',st.order==null&&JSON.stringify(lineSecs().map(textOf).slice(0,4))===JSON.stringify(before.slice(0,4))&&$('btnResetOrder').hidden);
 await SS.testShot(dir+'/0_reset.png');
 SS.undo();await sleep(300);await SS.testShot(dir+'/1_reordered.png');
 await A.writeText(dir+'/report.json',JSON.stringify({success:true,checks},null,2));A.notifyTestReady({success:true});
}catch(err){if(dir){await A.writeText(dir+'/report.json',JSON.stringify({success:false,checks,error:err.stack},null,2));await SS.testShot(dir+'/error.png');}A.notifyTestError(err.stack);}});})();
