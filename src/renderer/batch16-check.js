/* SS_TEST_SCRIPT=batch16: 자막 행 삭제·STT 경계 합치기·미세조정 토글·닫기 경쟁·일시정지 포커스. 네트워크/AI 없음 */
(function(){
'use strict';const SS=window.SS;
window.addEventListener('ss:run-test-script',async e=>{
 if(e.detail!=='batch16')return;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),$=id=>document.getElementById(id);
 const report={checks:[],rects:{}};let dir='';
 const check=(name,ok,info)=>{report.checks.push({name,ok:!!ok,info});if(!ok)throw Error(name+': '+JSON.stringify(info));};
 const blocks=()=>Array.from($('transcriptBody').querySelectorAll('.caption-block'));
 const key=k=>$('transcriptBody').dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));
 const fixture=()=>{
   SS.preview.pause();SS.closeTrim();
   SS.state.words=Array.from({length:18},(_,id)=>({id,text:['하나님의','은혜로','살아갑니다.','오늘도','주님을','따릅니다.'][id%6],start:2+id*.6,end:2+id*.6+.5,br:id%3===2,del:false}));
   SS.state.settings={padBefore:0,padAfter:0,fadeMs:10,maxLineChars:30,splitLongWords:true,semanticBreaks:false};
   SS.state.overrides={};SS.state.caret=0;SS.state.selection=null;SS.state.manualCaret=true;SS.state.markI=-1;SS.state.markO=-1;SS.state.hideDeleted=false;
   SS.resetEditorHistory();SS.renderTranscript();SS.updateTemplatePreview();$('transcriptBody').focus();
 };
 const timing=()=>JSON.stringify(SS.state.words.map(w=>[w.id,w.start,w.end,w.del,w.sttText]));
 const sourcePos=(n,end)=>{const el=blocks()[n];SS.rememberSourceCaption(el);SS.state.caret=+(end?el.dataset.to:el.dataset.from);SS.state.selection=null;SS.state.manualCaret=true;SS.renderTranscript(false);$('transcriptBody').focus();};
 try{
   const launch=await window.api.getLaunchInfo();dir=launch.cache+'/batch16';await window.api.mkdir(dir);
   fixture();check('기준 자막 6줄',SS.getLines().length===6,SS.getLines().length);
   const n=SS.getLines().length,before=timing();sourcePos(1,false);key('Backspace');
   check('STT 맨 앞 Backspace → 위 줄 병합',SS.getLines().length===n-1&&SS.getLines()[0].words.length===6,SS.getLines().map(l=>l.text));
   check('합쳐도 영상·원문 불변',timing()===before);
   check('원문 커서 유지·입력칸으로 이동 안 함',document.activeElement===$('transcriptBody')&&SS.state.caret===3,SS.state.caret);
   SS.undo();check('STT 합치기 되돌리기',SS.getLines().length===n);SS.redo();check('STT 합치기 다시 실행',SS.getLines().length===n-1);
   fixture();const before2=timing();sourcePos(1,true);key('Delete');
   check('STT 맨 끝 Delete → 아래 줄 병합',SS.getLines().length===5&&SS.getLines()[1].words.length===6,SS.getLines().map(l=>l.text));
   check('Delete 병합도 영상·원문 불변',timing()===before2);
   fixture();sourcePos(0,false);key('Backspace');check('첫 줄 맨 앞은 지우지 않음',SS.getLines().length===6&&SS.state.words.every(w=>!w.del));
   sourcePos(5,true);key('Delete');check('마지막 줄 맨 끝은 지우지 않음',SS.getLines().length===6&&SS.state.words.every(w=>!w.del));
   fixture();sourcePos(1,false);SS.state.selection=[3,5];key('Backspace');check('선택한 단어는 병합 아닌 삭제',SS.state.words[3].del&&SS.state.words[4].del&&!SS.state.words[2].del);
   fixture();sourcePos(1,false);SS.state.caret=4;key('Backspace');check('줄 중간 Backspace는 단어 삭제',SS.state.words[3].del&&!SS.state.words[2].del);
   fixture();let out=blocks()[1].querySelector('.caption-output');out.focus();out.setSelectionRange(out.value.length,out.value.length);out.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
   check('출력 자막 맨 끝 Delete도 아래 줄 병합',SS.getLines().length===5&&SS.getLines()[1].words.length===6);
   fixture();blocks()[1].querySelector('.caption-check').click();blocks()[3].querySelector('.caption-delete').click();
   check('선택칸 옆 개별 삭제 단추 있음',!!blocks()[0].querySelector('.caption-delete'));
   check('줄 삭제는 해당 영상·음성 단어만 삭제',SS.state.words.slice(9,12).every(w=>w.del)&&SS.state.words.filter(w=>w.del).length===3);
   check('다른 체크 선택은 유지',blocks()[1].querySelector('.caption-check').checked);
   SS.undo();check('줄 삭제 Ctrl+Z 복원',SS.state.words.every(w=>!w.del));
   fixture();const opening=SS.toggleFineTuneBlock(blocks()[1]);check('아이콘 열기 즉시 상태 켜짐',SS.state.trimOpen);
   SS.toggleFineTuneBlock(blocks()[1]);check('같은 아이콘 다시 눌러 닫힘',!SS.state.trimOpen);
   await opening;await sleep(100);check('늦게 온 파형으로 창 안 살아남',!SS.state.trimOpen&&SS.getTrimState()===null);
   await SS.toggleFineTuneBlock(blocks()[1]);check('미세조정 다시 열기',SS.state.trimOpen&&SS.getTrimState().idxB===3);
   check('아이콘 눌림 상태 표시',blocks()[1].querySelector('.caption-fine').getAttribute('aria-pressed')==='true');
   await SS.toggleFineTuneBlock(blocks()[2]);check('다른 줄 누르면 그 줄 조정',SS.state.trimOpen&&SS.getTrimState().idxB===6);
   SS.closeTrim();
   const a=SS.openFineTune(0,2),b=SS.openFineTune(9,11);await Promise.all([a,b]);check('빠르게 다른 줄 열어도 마지막 요청 유지',SS.getTrimState().idxB===9&&SS.state.trimOpen);
   SS.closeTrim();fixture();SS.setEditedPlayMode(true);await SS.preview.seek(7);await SS.preview.play();await sleep(350);SS.setFollowPlay(false);SS.state.caret=0;SS.renderTranscript(false);$('transcriptBody').focus();const pausedTime=SS.preview.currentTime;SS.preview.pause();await sleep(150);
   check('일시정지하면 해당 구간 커서',Math.abs(SS.state.words[SS.state.caret].start-pausedTime)<.9,{caret:SS.state.caret,time:pausedTime});
   check('일시정지하면 원문에 키보드 포커스',document.activeElement===$('transcriptBody'));
   check('일시정지해도 영상 위치는 바꾸지 않음',Math.abs(SS.preview.currentTime-pausedTime)<.08,[pausedTime,SS.preview.currentTime]);
   const blk=blocks().find(x=>SS.state.caret>=+x.dataset.from&&SS.state.caret<+x.dataset.to);if(blk){const r=blk.getBoundingClientRect(),pr=$('transcriptBody').getBoundingClientRect();check('일시정지한 자막을 화면 안으로',r.top>=pr.top-2&&r.bottom<=pr.bottom+2,[r.top,r.bottom,pr.top,pr.bottom]);}
   // 줄 합치기 → 삭제 → 미세조정 → undo/redo 뒤에도 재생을 반복한다.
   for(let cycle=0;cycle<3;cycle++){
     fixture();sourcePos(1,false);key('Backspace');
     blocks()[2].querySelector('.caption-delete').click();
     await SS.openFineTune(12,14);SS.updateTrimValue('B',SS.getBStart()+.04);SS.closeTrim();
     SS.undo();SS.redo();$('transcriptBody').focus();
     const ss=SS.getSegments(),a=ss[0],next=ss[1];
     await SS.preview.seek(a.end-.25);await SS.preview.play();await sleep(650);
     check('복합 편집 뒤 재생 '+(cycle+1),!SS.preview.paused&&SS.preview.currentTime>=next.start-.05&&!SS.preview.video.muted,{time:SS.preview.currentTime,next:next.start,paused:SS.preview.paused});
     SS.preview.pause();
   }
   await SS.testShot(dir+'/captions.png');
   await SS.toggleFineTuneBlock(blocks()[2]);await SS.testShot(dir+'/fine.png');SS.toggleFineTuneBlock(blocks()[2]);
   report.success=true;
 }catch(err){report.success=false;report.error=err.stack||String(err);}
 SS.preview.pause();SS.closeTrim();
 if(dir)await window.api.writeText(dir+'/report.json',JSON.stringify(report,null,2));
 if(report.success)window.api.notifyTestReady({success:true});else window.api.notifyTestError(report.error);
});
})();
