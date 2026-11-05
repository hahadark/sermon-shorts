/* SS_TEST_SCRIPT=ytreview (SS_TEST_YTFAKE=1): 영상 출력 → 완성 영상 창에서 점검하고 유튜브에 올리기 / 바로 올리기 / 올리지 않기 */
(function(){window.addEventListener('ss:run-test-script',async e=>{if(e.detail!=='ytreview')return;const SS=window.SS,A=window.api,$=id=>document.getElementById(id);let dir='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));const checks=[];const ck=(n,ok,info)=>{checks.push({n,ok:!!ok,info:info===undefined?null:info});if(!ok)throw Error(n+' '+JSON.stringify(info));};
const waitFor=async(fn,ms,what)=>{const t0=Date.now();while(!fn()){if(Date.now()-t0>ms)throw Error('시간 초과: '+what);await sleep(100);}};
try{const l=await A.getLaunchInfo();dir=l.cache+'/ytreview';await A.mkdir(dir);await A.saveSettings({sysCheckSeen:true});
 const st=SS.state;st.meta={title:'은혜에 응답하는 삶',verse:'에베소서 2:8',speaker:'시험 사관'};
 // 짧게: 앞 12초만 남긴다
 SS.pushUndo();for(const w of st.words)if(w.start>12)w.del=true;SS.renderTranscript();
 const exportOnce=async(name)=>{const r=await SS.doExport(dir+'/'+name);ck('출력 '+name,r.success,r.error);SS.showExportPlayer(r.outPath,{duration:r.duration,srtPath:r.srtPath,autoUpload:true});return r;};
 // ---- 1) 점검하고 올리기 (기본) ----
 await A.ytupSetOptions({uploadMode:'review'});
 const r1=await exportOnce('review.mp4');
 await waitFor(()=>$('expYtGo'),5000,'유튜브 칸');
 ck('완성 영상 창 옆에 유튜브 칸',!$('expYt').hidden&&document.querySelector('.exp-dialog').classList.contains('with-yt'));
 ck('확인 창 없이 기다림 (자동으로 안 올림)',(await A.ytupTestLog()).length===0);
 ck('제목 미리 채움(#Shorts)',/은혜에 응답하는 삶.*#Shorts/.test($('expYtTitle').value),$('expYtTitle').value);
 ck('설명 미리 채움(본문·설교자)',/에베소서 2:8/.test($('expYtDesc').value)&&/시험 사관/.test($('expYtDesc').value),$('expYtDesc').value);
 ck('점검 전에는 올리기 꺼짐',$('expYtGo').disabled&&/점검 목록/.test($('expYtHint').textContent));
 $('expChk_text').click();$('expChk_sound').click();
 ck('두 개만 체크하면 아직 꺼짐',$('expYtGo').disabled);
 const v=$('expVideo');await waitFor(()=>v.readyState>=1,5000,'완성 영상');v.muted=true;v.playbackRate=4;v.currentTime=0;await v.play();
 await waitFor(()=>$('expChk_watched').checked,15000,'끝까지 재생');
 ck('끝까지 재생하면 저절로 체크',$('expChk_watched').checked);
 ck('모두 체크하면 올리기 켜짐',!$('expYtGo').disabled);
 await SS.testShot(dir+'/1_review.png');
 $('expYtTitle').value='점검한 제목';$('expYtTitle').dispatchEvent(new Event('input'));$('expYtDesc').value='고친 설명';$('expYtPrivacy').value='private';
 $('expYtGo').click();
 await waitFor(()=>document.querySelector('.exp-yt-done'),8000,'올림');
 const log1=await A.ytupTestLog();
 ck('고친 제목·설명·공개 범위로 올림',log1.length===1&&/^점검한 제목/.test(log1[0].title)&&log1[0].description==='고친 설명'&&log1[0].privacy==='private',log1);
 ck('올린 기록이 프로젝트에',st.uploads&&st.uploads.at(-1).privacy==='private'&&/youtu\.be\/fake/.test(st.uploads.at(-1).url),st.uploads);
 ck('링크·스튜디오 단추',!!$('expYtLink')&&!!$('expYtStudio'));
 await SS.testShot(dir+'/2_done.png');
 SS.closeExportPlayer();SS.showExportPlayer(r1.outPath,{duration:r1.duration});await sleep(500);
 ck('같은 영상을 다시 열면 올린 결과만 (두 번 안 올림)',!!document.querySelector('.exp-yt-done')&&!$('expYtGo'));
 SS.closeExportPlayer();
 // ---- 2) 바로 올리기 ----
 await A.ytupSetOptions({uploadMode:'auto'});
 await exportOnce('auto.mp4');
 await waitFor(()=>document.querySelector('.exp-yt-done'),10000,'바로 올림');
 ck('바로 올리기: 열리자마자 올림',(await A.ytupTestLog()).length===2);
 SS.closeExportPlayer();
 // ---- 3) 올리지 않기 ----
 await A.ytupSetOptions({uploadMode:'off'});
 await exportOnce('off.mp4');await sleep(800);
 ck('올리지 않기: 칸 접힘·단추만',$('expYt').hidden&&!$('expYtShow').hidden);
 ck('올리지 않기: 올리지 않음',(await A.ytupTestLog()).length===2);
 $('expYtShow').click();await sleep(200);
 ck('단추를 누르면 칸이 열림',!$('expYt').hidden&&!!$('expYtGo')&&$('expYtGo').disabled);
 await SS.testShot(dir+'/3_off.png');
 SS.closeExportPlayer();
 await A.writeText(dir+'/report.json',JSON.stringify({success:true,checks},null,2));A.notifyTestReady({success:true});
}catch(err){if(dir){await A.writeText(dir+'/report.json',JSON.stringify({success:false,checks,error:err.stack},null,2));await SS.testShot(dir+'/error.png');}A.notifyTestError(err.stack);}});})();
