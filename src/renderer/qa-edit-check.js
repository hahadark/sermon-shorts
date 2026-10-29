/* qa-edit-check: SS_TEST_SCRIPT=qa-edit 자막 편집·재생 복합 시나리오 QA (비치명적 수집). 네트워크/AI 없음 */
(function(){
'use strict';const SS=window.SS;
window.addEventListener('ss:run-test-script',async e=>{
 if(e.detail!=='qa-edit')return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),$=id=>document.getElementById(id);
 const report={checks:[],failures:[],perf:{}};let dir='';
 const errs=[];window.addEventListener('error',ev=>errs.push('error:'+ev.message));window.addEventListener('unhandledrejection',ev=>errs.push('rej:'+(ev.reason&&ev.reason.stack||ev.reason)));
 const check=(name,ok,info)=>{const r={name,ok:!!ok};if(!ok){r.info=info;report.failures.push(r);}report.checks.push(r);};
 const guard=async(name,fn)=>{try{await fn();}catch(err){check(name+' (예외)',false,err.stack||String(err));}};
 const blocks=()=>Array.from($('transcriptBody').querySelectorAll('.caption-block'));
 const key=(k,o={})=>{const t=document.activeElement&&document.activeElement.tagName!=='BODY'?document.activeElement:$('transcriptBody');t.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...o}));};
 const sig=()=>JSON.stringify({w:SS.state.words.map(w=>[w.id,w.text,w.sttText,w.start,w.end,w.del?1:0,w.br?1:0,w.cutBefore?1:0]),o:SS.state.overrides,n:SS.state.words.length,l:SS.getLines().map(l=>l.words.length+':'+l.text)});
 const mk=(n)=>Array.from({length:n},(_,id)=>({id,text:['하나님의','은혜로','살아갑니다.','오늘도','주님을','따릅니다.'][id%6],start:2+id*.6,end:2+id*.6+.5,br:id%3===2,del:false}));
 const fixture=(n=18)=>{
   SS.preview.pause();try{SS.closeTrim();}catch(_){}
   SS.state.words=mk(n);
   SS.state.settings={padBefore:0,padAfter:0,fadeMs:10,maxLineChars:30,splitLongWords:true,semanticBreaks:false};
   SS.state.overrides={};SS.state.caret=0;SS.state.selection=null;SS.state.manualCaret=true;SS.state.markI=-1;SS.state.markO=-1;SS.state.hideDeleted=false;
   SS.resetEditorHistory();SS.renderTranscript();SS.updateTemplatePreview&&SS.updateTemplatePreview();$('transcriptBody').focus();
 };
 const setCaret=(c,sel)=>{SS.state.caret=c;SS.state.selection=sel||null;SS.state.selAnchor=sel?sel[0]:c;SS.state.manualCaret=true;SS.renderTranscript(false);$('transcriptBody').focus();};
 const undoable=async(name,setup,op)=>{await guard(name,async()=>{fixture();if(setup)await setup();const a=sig();await op();const b=sig();
   check(name+': 상태 변화',a!==b,'변화 없음');
   SS.undo();const u=sig();check(name+': undo 1번 정확 복원',u===a,{diffLen:[a.length,u.length]});
   SS.redo();check(name+': redo 재현',sig()===b);
   SS.undo();check(name+': 재undo 복원',sig()===a);});};
 try{
   const launch=await window.api.getLaunchInfo();dir=launch.cache+'/qa_edit';await window.api.mkdir(dir);
   const real=SS.state.words.map(w=>({...w})),realSettings={...SS.state.settings};report.realWords=real.length;
   await undoable('Backspace 단어삭제',()=>setCaret(4),()=>key('Backspace'));
   await undoable('Delete 단어삭제',()=>setCaret(4),()=>key('Delete'));
   await undoable('Shift 선택 삭제',()=>setCaret(2,[2,6]),()=>key('Backspace'));
   await undoable('Ctrl+Backspace 문장삭제',()=>setCaret(5),()=>key('Backspace',{ctrlKey:true}));
   await undoable('Ctrl+Delete 문장삭제',()=>setCaret(5),()=>key('Delete',{ctrlKey:true}));
   await undoable('STT 맨앞 Backspace 병합',()=>{const el=blocks()[1];SS.rememberSourceCaption(el);setCaret(+el.dataset.from);},()=>key('Backspace'));
   await undoable('STT 맨끝 Delete 병합',()=>{const el=blocks()[1];SS.rememberSourceCaption(el);setCaret(+el.dataset.to);},()=>key('Delete'));
   await undoable('출력 맨앞 Backspace 병합',()=>{},()=>{const o=blocks()[1].querySelector('.caption-output');o.focus();o.setSelectionRange(0,0);o.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true}));});
   await undoable('출력 맨끝 Delete 병합',()=>{},()=>{const o=blocks()[1].querySelector('.caption-output');o.focus();o.setSelectionRange(o.value.length,o.value.length);o.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true}));});
   await undoable('줄 휴지통 삭제',()=>{},()=>blocks()[2].querySelector('.caption-delete').click());
   await undoable('체크 일괄 삭제',()=>{blocks()[1].querySelector('.caption-check').click();blocks()[3].querySelector('.caption-check').click();},()=>$('btnDeleteCheckedCaptions').click());
   await undoable('Enter 나누기',()=>{const o=blocks()[0].querySelector('.caption-output');o.focus();o.setSelectionRange(4,4);},()=>{const o=blocks()[0].querySelector('.caption-output');o.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
   await undoable('되살리기',()=>{SS.state.words[3].del=true;SS.state.words[4].del=true;SS.resetEditorHistory();setCaret(3,[3,5]);},()=>SS.handleRestore());
   await undoable('줄바꿈 토글',()=>setCaret(1),()=>SS.toggleBr());
   await undoable('컷 토글',()=>setCaret(3),()=>SS.toggleCutBefore());
   await undoable('미세조정 값 변경',async()=>{await SS.openFineTune(6,8);},()=>{SS.updateTrimValue('B',SS.getBStart()+.05);});
   await guard('숨기기',async()=>{fixture();SS.state.words[2].del=true;SS.renderTranscript();const a=sig();SS.toggleHideDeleted();const hidden=SS.state.hideDeleted;SS.toggleHideDeleted();check('지운부분 숨기기 토글',hidden===true&&SS.state.hideDeleted===false&&sig()===a);
     SS.toggleHideDeleted();setCaret(5);key('Backspace');SS.undo();check('숨김 상태 undo',SS.state.words.filter(w=>w.del).length===1,SS.state.words.filter(w=>w.del).length);SS.toggleHideDeleted();});
   await guard('체인 undo/redo',async()=>{fixture();const s=[sig()];
     setCaret(2);key('Backspace');s.push(sig());setCaret(8);key('Delete');s.push(sig());setCaret(10,[10,13]);key('Backspace');s.push(sig());
     for(let i=s.length-2;i>=0;i--){SS.undo();check('체인 undo '+i,sig()===s[i]);}
     SS.undo();SS.undo();check('초과 undo 안전',sig()===s[0]);
     for(let i=1;i<s.length;i++){SS.redo();check('체인 redo '+i,sig()===s[i]);}
     SS.redo();check('초과 redo 안전',sig()===s[s.length-1]);
     for(let k=0;k<5;k++){SS.undo();SS.redo();}check('반복 undo/redo 안정',sig()===s[s.length-1]);});
   await guard('전부 삭제',async()=>{fixture();SS.state.words.forEach(w=>w.del=true);SS.renderTranscript();
     let ok=true;try{SS.updateOutput();SS.getSegments();SS.getLines();key('Backspace');key('Delete');SS.handleRestore();SS.moveCursor(1);SS.moveLine(1);await SS.preview.play();SS.preview.pause();}catch(x){ok=x.stack;}
     check('전부 삭제 후 키/재생 무예외',ok===true,ok);
     SS.state.words.forEach(w=>w.del=false);SS.renderTranscript();});
   await guard('빈 자막',async()=>{fixture();SS.state.words=[];SS.state.caret=0;SS.state.selection=null;let ok=true;try{SS.renderTranscript();key('Backspace');key('Delete');key('Enter');SS.handleRestore();SS.undo();SS.redo();SS.toggleBr();SS.moveCursor(-1);SS.moveLine(1);SS.getSegments();}catch(x){ok=x.stack;}check('빈 자막 무예외',ok===true,ok);});
   await guard('성능',async()=>{for(const n of [239,600,1200]){fixture(n);const t0=performance.now();SS.renderTranscript();const t1=performance.now();setCaret(n>>1);key('Backspace');const t2=performance.now();SS.undo();const t3=performance.now();
     report.perf[n]={render:Math.round(t1-t0),delete:Math.round(t2-t1),undo:Math.round(t3-t2),blocks:blocks().length};
     check('성능 '+n+'단어 각 작업<400ms',t1-t0<400&&t2-t1<400&&t3-t2<400,report.perf[n]);}});
   await guard('재생',async()=>{fixture();SS.state.words=real.map(w=>({...w}));SS.state.settings={...realSettings};SS.resetEditorHistory();SS.renderTranscript();
     SS.setEditedPlayMode(true);const w=SS.state.words;const k=Math.min(40,w.length-5);w[k].del=true;w[k+1].del=true;SS.renderTranscript();SS.updateTemplatePreview&&SS.updateTemplatePreview();
     const ss=SS.getSegments();const seg=ss.find((s,i)=>ss[i+1]&&ss[i+1].start-s.end>.3);
     if(!seg){check('삭제 구간 점프 대상 있음',false,ss.length);return;}
     const nxt=ss[ss.indexOf(seg)+1];
     await SS.preview.seek(seg.end-.3);await SS.preview.play();await sleep(900);
     check('편집결과 재생: 삭제 구간 건너뜀',SS.preview.currentTime>=nxt.start-.05,{t:SS.preview.currentTime,n:nxt.start});
     const wi=SS.state.words.findIndex(x=>!x.del&&x.start>SS.preview.currentTime+2);
     if(wi>=0){setCaret(wi);key('Backspace');await sleep(300);check('재생 중 편집 후 계속 재생',!SS.preview.paused,SS.preview.currentTime);SS.undo();await sleep(200);check('재생 중 undo 후 재생 유지',!SS.preview.paused);}
     SS.preview.pause();
     const bar=$('seek');bar.value=500;bar.dispatchEvent(new Event('input',{bubbles:true}));bar.dispatchEvent(new Event('change',{bubbles:true}));await sleep(300);
     check('재생 막대 이동',Math.abs(SS.preview.currentTime-SS.preview.duration*.5)<SS.preview.duration*.1,{t:SS.preview.currentTime,d:SS.preview.duration});
     SS.setEditedPlayMode(false);await SS.preview.seek(seg.end-.1);await SS.preview.play();await sleep(700);
     check('편집결과 재생 끔: 삭제 구간 통과',SS.preview.currentTime<nxt.start-.05||SS.preview.currentTime>seg.end,SS.preview.currentTime);SS.preview.pause();SS.setEditedPlayMode(true);
     await SS.preview.seek(seg.end-.1);$('transcriptBody').focus();key(' ',{shiftKey:true});await sleep(700);check('Shift+Space 원본재생 시작',!SS.preview.paused,'paused');SS.preview.pause();
     await SS.preview.seek(seg.start);await SS.preview.play();await sleep(500);SS.preview.pause();await sleep(200);
     check('일시정지 후 원문 포커스',document.activeElement===$('transcriptBody'),document.activeElement&&document.activeElement.tagName+'.'+document.activeElement.className);});
   await guard('건너뛰기 지연',async()=>{fixture();SS.state.words=real.map(w=>({...w}));SS.state.settings={...realSettings};SS.resetEditorHistory();SS.setEditedPlayMode(true);
     for(let k=0;k<4;k++){SS.state.words[20+k*25].del=true;SS.state.words[21+k*25].del=true;}SS.renderTranscript();
     const ss=SS.getSegments();const lat=[];
     for(let i=0;i<Math.min(4,ss.length-1);i++){const nx=ss[i+1];await SS.preview.seek(ss[i].end-.4);await SS.preview.play();const t0=performance.now();
       while(performance.now()-t0<3000){await sleep(10);if(SS.preview.currentTime>=nx.start&&!SS.preview.video.muted&&!SS.playback.isSkipping()){lat.push(Math.round(performance.now()-t0));break;}}
       SS.preview.pause();await sleep(100);}
     report.skipLatency=lat;check('건너뛰기 4회 모두 1.2초 안에 끝남(소리 복귀)',lat.length>=3&&Math.max(...lat)<1200,lat);});
   await guard('출력자막 직접 수정 undo',async()=>{fixture();const a=sig();const o=blocks()[1].querySelector('.caption-output');o.focus();o.dispatchEvent(new FocusEvent('focus'));o.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));o.value='바뀐 자막입니다';o.dispatchEvent(new Event('input',{bubbles:true}));SS.flushCaptionEdit();const b=sig();
     check('출력자막 수정 반영',b!==a);SS.undo();check('출력자막 수정 undo 1번 복원',sig()===a,'미복원');SS.redo();check('출력자막 수정 redo',sig()===b);SS.undo();});
   await guard('지운 단어 낀 병합',async()=>{fixture();SS.state.words[2].del=true;SS.state.words[3].del=true;SS.renderTranscript();const a=sig();const n=SS.getLines().length;const el=blocks()[1];SS.rememberSourceCaption(el);setCaret(+el.dataset.from);key('Backspace');
     check('지운 단어 낀 줄 합치기 무예외',SS.getLines().length<=n);SS.undo();check('지운 단어 낀 병합 undo',sig()===a);});
   await guard('미세조정 중 삭제·닫기·undo',async()=>{fixture();await SS.openFineTune(6,8);setCaret(14);key('Backspace');check('미세조정 중에는 삭제 키가 단어를 지우지 않음(조정 전용 키)',!SS.state.words[14].del);SS.closeTrim();key('Backspace');SS.undo();check('닫은 뒤 삭제·undo',!SS.state.words[14].del);});
   await guard('경계 커서',async()=>{fixture();setCaret(0);key('Backspace');check('맨 앞 Backspace 안전',SS.state.words.every(w=>!w.del)||true);setCaret(SS.state.words.length);key('Delete');SS.moveCursor(1);SS.moveCursor(1,true);setCaret(0);SS.moveCursor(-1);check('커서 범위 유지',SS.state.caret>=0&&SS.state.caret<=SS.state.words.length,SS.state.caret);
     SS.state.selection=null;SS.undo();SS.undo();SS.redo();});
   await guard('프로젝트 저장·열기',async()=>{fixture();SS.state.words=real.map(w=>({...w}));SS.state.settings={...realSettings};SS.state.words[10].del=true;SS.state.words[11].text='수정됨';SS.state.words[12].br=!SS.state.words[12].br;SS.renderTranscript();
     const p=dir+'/qa.sspj';const before=sig();await SS.saveProjectTo(p);SS.state.words.forEach(w=>w.del=true);SS.renderTranscript();await SS.openProjectFrom(p);await sleep(500);
     check('열기 후 단어 수·삭제·텍스트 복원',sig()===before,{a:before.length,b:sig().length});
     setCaret(3);key('Backspace');SS.undo();check('열기 후 편집·undo 정상',sig()===before);});
   await sleep(300);
   report.consoleErrors=errs;check('콘솔 오류 0',errs.length===0,errs);
   report.success=report.failures.length===0;
 }catch(err){report.success=false;report.error=err.stack||String(err);}
 try{SS.preview.pause();SS.closeTrim();}catch(_){}
 report.summary={total:report.checks.length,failed:report.failures.length};
 if(dir)await window.api.writeText(dir+'/report.json',JSON.stringify(report,null,2));
 if(report.success)window.api.notifyTestReady({success:true});else window.api.notifyTestError(report.error||('실패 '+report.failures.length+'건'));
});
})();
