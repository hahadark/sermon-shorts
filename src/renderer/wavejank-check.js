/* SS_TEST_SCRIPT=wavejank : 2시간 설교 길이 파형으로 그리기 시간과 재생 중 화면 끊김(긴 프레임)을 잰다 */
(function(){window.addEventListener('ss:run-test-script',async e=>{if(e.detail!=='wavejank')return;const SS=window.SS,A=window.api;let dir='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{const l=await A.getLaunchInfo();dir=l.cache+'/wavejank';await A.mkdir(dir);const w=SS.wave;const mode=l.testUrl||'normal';l.testTag=mode;
 const lt=[];try{new PerformanceObserver(li=>{for(const en of li.getEntries())lt.push(Math.round(en.duration));}).observe({type:'longtask',buffered:false});}catch(_){}
 const stubs={nowave:()=>{w.drawNow=()=>{};},nocap:()=>{SS.updateTemplatePreview=async()=>{};},notime:()=>{SS.updateTimeUI=()=>{};},none:()=>{w.drawNow=()=>{};SS.updateTemplatePreview=async()=>{};}};
 const D=7200,n=D*100,pk=new Float32Array(n*2);for(let i=0;i<n;i++){const a=Math.abs(Math.sin(i*0.013)*Math.sin(i*0.00071))*0.8;pk[2*i]=-a;pk[2*i+1]=a;}
 const realPeaks=w.peaks,realBs=w.bucketSec,realDur=w.duration;
 w.setData(pk,0.01,D);
 const time=(fn,k)=>{const t0=performance.now();for(let i=0;i<k;i++)fn();return (performance.now()-t0)/k;};
 const full=time(()=>{w.setView(0,D);w.drawNow();},20);
 const mid=time(()=>{w.setView(3000,120);w.drawNow();},20);
 const near=time(()=>{w.setView(3000,8);w.drawNow();},20);
 const playheadOnly=time(()=>{w.setView(0,D);w.playhead=(w.playhead+1)%D;w.drawNow();},20);
 // 재생 중: 전체 보기 상태로 5초 재생하며 화면 간격 측정
 if(stubs[mode])stubs[mode]();lt.length=0;
 w.setView(0,D);const gaps=[];let last=performance.now(),run=true;const loop=t=>{gaps.push(t-last);last=t;if(run)requestAnimationFrame(loop);};
 SS.preview.video.muted=true;await SS.preview.seek(1);SS.preview.play();await sleep(300);requestAnimationFrame(t=>{last=t;requestAnimationFrame(loop);});await sleep(5000);run=false;SS.preview.pause();
 const g=gaps.slice(2).sort((a,b)=>a-b);const long=g.filter(x=>x>25).length;
 const r={success:true,drawMs:{full2h:+full.toFixed(2),view2min:+mid.toFixed(2),view8s:+near.toFixed(2),playheadMoveFull:+playheadOnly.toFixed(2)},play:{frames:g.length,median:+g[Math.floor(g.length/2)].toFixed(1),p95:+g[Math.floor(g.length*0.95)].toFixed(1),max:+g[g.length-1].toFixed(1),longFrames:long,longTasks:lt.length,longTaskMs:lt.slice(0,12)},mode};
 w.setData(realPeaks,realBs,realDur);
 await A.writeText(dir+'/report-'+(l.testTag||'x')+'.json',JSON.stringify(r,null,2));await A.writeText(dir+'/report.json',JSON.stringify(r,null,2));A.notifyTestReady({success:true});
}catch(err){if(dir)await A.writeText(dir+'/report.json',JSON.stringify({success:false,error:err.stack},null,2));A.notifyTestError(err.stack);}});})();
