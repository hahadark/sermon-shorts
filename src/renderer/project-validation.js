/* Offline integration hook: only runs when explicitly requested by SS_TEST_SCRIPT. */
(function(){
  'use strict';
  const SS=window.SS;
  window.addEventListener('ss:run-test-script',async e=>{
    if(!['project-roundtrip','caption-limit','dual-caption','merge-bulk'].includes(e.detail))return;
    const captionMode=e.detail==='caption-limit'; const dualMode=e.detail==='dual-caption'; const mergeMode=e.detail==='merge-bulk';
    const report={startedAt:new Date().toISOString(),assertions:[]};
    const check=(name,actual,expected)=>{const pass=JSON.stringify(actual)===JSON.stringify(expected);report.assertions.push({name,actual,expected,pass});if(!pass)throw Error(name+': '+JSON.stringify(actual));};
    const launch=await window.api.getLaunchInfo();const dir=(launch.cache||launch.root+'/cache')+(mergeMode?'/merge_bulk':dualMode?'/dual_caption':captionMode?'/caption_limit':'/project_roundtrip');
    await window.api.mkdir(dir);
    try{
      SS.preview.pause();const live=SS.state;const start=Math.min(940,live.source.duration-10);
      const spans=[[0,.7],[.9,1.6],[1.7,2.2],[2.3,2.8],[3,3.5],[3.8,4.5],[4.6,5.3]];
      live.words=spans.map(([a,b],id)=>({id,text:['하나님의','은혜가','충분합니다.','지운','문장','믿음으로','살아갑니다.'][id],start:start+a,end:start+b,del:id===3||id===4,br:id===2}));
      if(mergeMode)live.words[5].br=true;
      if(dualMode){live.words[0].text='하나님에';live.words[1].text='은해가';}
      live.settings={padBefore:0,padAfter:0,fadeMs:0,maxLineChars:14,splitLongWords:true};live.overrides={'e:2':start+2.1};
      live.caret=5;live.selAnchor=5;live.selection=null;live.hideDeleted=false;live.markI=0;live.markO=7;
      live.crop={scale:1,x:0,y:.5};live.activeTheme=SS.theme.normalizeTheme({id:'roundtrip-local',name:'저장 복원 검증',canvas:{background:'#142838'},video:{x:90,y:430,width:900,height:800},logo:{show:false},fadeInSec:0});
      live.meta={title:'저장 복원 테스트',verse:'삭제 구간과 테마를 유지합니다',speaker:'테스트'};
      document.getElementById('inpTitle').value=live.meta.title;document.getElementById('inpVerse').value=live.meta.verse;document.getElementById('selSpeaker').value='직접 입력';document.getElementById('inpSpeaker').value=live.meta.speaker;
      SS.resetEditorHistory();SS.applyCrop();await SS.preview.seek(start+.3);await SS.updateTemplatePreview();
      if(mergeMode){
        const body=document.getElementById('transcriptBody'),key=(el,key,opts={})=>el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,...opts}));
        const fields=()=>Array.from(body.querySelectorAll('.caption-output'));
        const source=live.words.map(w=>w.sttText),segs=JSON.stringify(SS.getSegments()),baseline=SS.getLines().map(l=>l.text);
        check('one checkbox per block',body.querySelectorAll('.caption-check').length,body.querySelectorAll('.caption-block').length);
        let el=fields()[0];el.focus();el.setSelectionRange(0,0);key(el,'Backspace');check('first row backspace no-op',SS.getLines().map(l=>l.text),baseline);
        el=fields()[1];el.focus();el.setSelectionRange(0,0);key(el,'Backspace');
        check('two captions merged into one',SS.getLines().length,baseline.length-1);check('merged content',SS.getLines()[0].text,baseline.slice(0,2).join(' '));check('manual merge survives 14-char limit',SS.getLines()[0].manualMerge,true);
        check('merge caret at join',document.activeElement.selectionStart,baseline[0].length+1);check('merge preserves video segments',JSON.stringify(SS.getSegments()),segs);check('merge preserves STT recognition',live.words.map(w=>w.sttText),source);
        key(document.activeElement,'z',{ctrlKey:true});check('focused CtrlZ undoes merge',SS.getLines().map(l=>l.text),baseline);
        window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,shiftKey:true,bubbles:true}));check('redo merge',SS.getLines().length,baseline.length-1);
        await SS.testShot(dir+'/merged.png');
        body.querySelector('.caption-unmerge').click();check('auto split button restores separate captions',SS.getLines().map(l=>l.text),baseline);
        const beforeIds=live.words.filter(w=>w.del).map(w=>w.id);
        const checks=Array.from(body.querySelectorAll('.caption-check')).filter(c=>!c.disabled);checks[0].checked=true;checks[0].dispatchEvent(new Event('change',{bubbles:true}));
        const afterFirst=live.words.filter(w=>w.del).map(w=>w.id);check('checking alone does not delete',afterFirst,beforeIds);
        checks.at(-1).checked=true;checks.at(-1).dispatchEvent(new Event('change',{bubbles:true}));
        check('multiple checkbox selection count',document.getElementById('lblCheckedCaptions').textContent,'2개 선택');
        await SS.testShot(dir+'/checked.png');document.getElementById('btnDeleteCheckedCaptions').click();
        check('bulk delete only selected live words',live.words.filter(w=>w.del).map(w=>w.id),[0,1,2,3,4,6]);check('unchecked middle segment stays',live.words[5].del,false);check('unchecked output remains',SS.getLines().map(l=>l.text),['믿음으로']);
        SS.undo();check('one undo restores entire batch',live.words.filter(w=>w.del).map(w=>w.id),beforeIds);check('bulk undo retains original captions',SS.getLines().map(l=>l.text),baseline);SS.redo();check('redo reapplies batch once',live.words.filter(w=>w.del).map(w=>w.id),[0,1,2,3,4,6]);SS.undo();
        document.getElementById('btnCheckAllCaptions').click();check('select all enables delete',document.getElementById('btnDeleteCheckedCaptions').disabled,false);document.getElementById('btnUncheckCaptions').click();check('clear selection disables delete',document.getElementById('btnDeleteCheckedCaptions').disabled,true);
        el=fields()[1];el.focus();el.setSelectionRange(0,0);key(el,'Backspace');check('final merge prepared for persistence',SS.getLines().length,baseline.length-1);report.mergedCount=baseline.length-1;report.mergedText=SS.getLines()[0].text;
      }
      if(dualMode){
        const body=document.getElementById('transcriptBody');const count=t=>Array.from(t.replace(/\s/g,'')).length;
        const first=()=>body.querySelector('textarea.caption-output');
        const type=text=>{const el=first();el.focus();el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));return el;};
        const key=(el,key)=>el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
        const globalKey=(key,opts={})=>window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,...opts}));
        const beforeCuts=JSON.stringify(SS.getSegments());const source=live.words.map(w=>w.sttText);
        check('multiple separate caption blocks',body.querySelectorAll('.caption-block').length>1,true);
        check('source rows explicitly labelled',body.textContent.includes('STT 원문'),true);
        check('output rows explicitly labelled',body.textContent.includes('출력 자막'),true);
        check('visible initial captions at most 14',Array.from(body.querySelectorAll('textarea.caption-output')).every(e=>count(e.value)<=14),true);
        let el=type('하나님의 은혜가 충분합니다.');
        check('output updates separately',live.words[0].text,'하나님의');check('original recognition preserved',live.words[0].sttText,'하나님에');
        check('original error still displayed',body.querySelector('.caption-source').textContent.includes('하나님에'),true);
        check('live preview uses corrected output',SS.getLines()[0].text,'하나님의 은혜가 충분합니다.');key(el,'Enter');
        globalKey('z',{ctrlKey:true});check('output correction undo',live.words[0].text,'하나님에');globalKey('z',{ctrlKey:true,shiftKey:true});check('output correction redo',live.words[0].text,'하나님의');
        el=type('하나님의 은혜가 충분합니다 오늘도 감사하며 살아갑니다');key(el,'Enter');
        check('long edited sentence reflows into 14-char blocks',SS.getLines().every(l=>count(l.text)<=14),true);
        check('long sentence preserves every inserted token',SS.getLines().map(l=>l.text).join('').replace(/\s/g,'').includes('오늘도감사하며살아갑니다'),true);
        check('all recognition remains unchanged',live.words.map(w=>w.sttText),source);
        globalKey('z',{ctrlKey:true});check('undo whole sentence is one step',SS.getLines()[0].text,'하나님의 은혜가 충분합니다.');
        el=type('취소할 문장');key(el,'Escape');check('escape cancels draft',SS.getLines()[0].text,'하나님의 은혜가 충분합니다.');
        el=type('하나님의 사랑이 충분합니다.');const other=Array.from(body.querySelectorAll('textarea.caption-output')).at(-1);other.focus();await new Promise(r=>setTimeout(r,0));
        check('switching output fields keeps target focused',document.activeElement===other&&other.isConnected,true);
        other.value='믿음으로 걸어갑니다.';other.dispatchEvent(new Event('input',{bubbles:true}));key(other,'Enter');
        check('both output edits preserved',SS.getLines().map(l=>l.text).join(' ').includes('사랑이')&&SS.getLines().map(l=>l.text).join(' ').includes('걸어갑니다.'),true);
        globalKey('z',{ctrlKey:true});check('undo second field separately',SS.getLines().map(l=>l.text).join(' ').includes('사랑이')&&!SS.getLines().map(l=>l.text).join(' ').includes('걸어갑니다.'),true);
        globalKey('z',{ctrlKey:true});check('undo first field separately',SS.getLines()[0].text,'하나님의 은혜가 충분합니다.');
        el=type('');key(el,'Enter');check('blank output does not cut audio',JSON.stringify(SS.getSegments()),beforeCuts);
        check('blank output keeps source visible',body.textContent.includes('하나님에'),true);globalKey('z',{ctrlKey:true});
        live.selection=[0,1];SS.handleDelete(1,false);check('cut changes only deletion state',live.words[0].del,true);SS.undo();check('cut undo retains corrected output',live.words[0].text,'하나님의');
        check('source recognition after cut undo',live.words[0].sttText,'하나님에');live.selection=null;live.caret=0;SS.renderTranscript();
        report.captionText=SS.getLines().map(l=>l.text);report.recognition=live.words.map(w=>w.sttText);
      }
      if(captionMode){
        const input=document.getElementById('inpMaxLineChars'),preset=document.getElementById('selCaptionLength'),split=document.getElementById('chkSplitLongWords');
        const count=text=>Array.from(text.replace(/\s/g,'')).length;
        const duration=SS.edl.segmentsDuration(SS.getSegments());const before=JSON.stringify(live.words);
        const set=n=>{input.value=String(n);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
        split.checked=true;split.dispatchEvent(new Event('change',{bubbles:true}));
        set(8);const narrow=SS.getLines().length;check('input applies 8 chars',live.settings.maxLineChars,8);
        set(20);check('larger limit reduces caption count',SS.getLines().length<narrow,true);
        SS.undo();check('undo caption limit',live.settings.maxLineChars,8);check('undo synchronizes input',input.value,'8');SS.redo();check('redo caption limit',live.settings.maxLineChars,20);
        set(4);check('strict maximum on all captions',SS.getLines().every(l=>count(l.text)<=4),true);
        check('strict split leaves transcript intact',JSON.stringify(live.words),before);
        check('caption length leaves video duration intact',SS.edl.segmentsDuration(SS.getSegments()),duration);
        input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));check('empty input preserves last limit',live.settings.maxLineChars,4);input.dispatchEvent(new Event('change',{bubbles:true}));check('blur restores valid value',input.value,'4');
        set(0);check('lower clamp',live.settings.maxLineChars,1);set(999);check('upper clamp',live.settings.maxLineChars,200);
        preset.value='8';preset.dispatchEvent(new Event('change',{bubbles:true}));check('preset applies limit',input.value,'8');
        SS.syncCaptionUI();await SS.updateTemplatePreview();report.captions=SS.getLines().map(l=>l.text);
      }
      const original=SS.project.snapshot(live,SS.preview.currentTime);const savedPath=dir+'/saved.sshorts';
      await SS.saveProjectTo(savedPath);const disk=await window.api.readJson(savedPath);
      check('saved format version',disk.version,1);check('transient promise absent',Object.hasOwn(disk,'peaksPromise'),false);
      live.words=[];live.overrides={};live.caret=0;live.meta.title='변경됨';live.activeTheme=null;
      await SS.openProjectFrom(savedPath);
      check('stable shared state reference',SS.state===live,true);
      check('words and deletion restored',live.words,original.words);
      check('trim restored',live.overrides,original.overrides);
      if(captionMode){check('saved caption limit restored',live.settings.maxLineChars,8);check('saved input restored',document.getElementById('inpMaxLineChars').value,'8');check('saved strict preference restored',document.getElementById('chkSplitLongWords').checked,true);}
      check('caret restored',live.caret,original.caret);check('theme restored',live.activeTheme.video,original.activeTheme.video);
      check('metadata restored',live.meta,original.meta);check('crop zero restored',live.crop.x,0);
      check('source metadata restored',live.source.path,original.source.path);
      check('playhead restored',Math.abs(SS.preview.currentTime-original.playhead)<.1,true);
      check('transcript visible',new Set(Array.from(document.querySelectorAll('#transcriptBody [data-wid]')).map(e=>e.dataset.wid)).size,7);
      SS.undo();check('load resets undo history',live.words,original.words);
      live.selection=[0,1];SS.handleDelete(1,false);check('new edit deletes word',live.words[0].del,true);SS.undo();check('undo works after load',live.words[0].del,false);
      live.selection=null;live.caret=5;SS.renderTranscript();await SS.updateTemplatePreview();
      await SS.testShot(dir+'/restored.png');
      if(mergeMode){check('saved manual merge restored',SS.getLines().length,report.mergedCount);check('saved merged text restored',SS.getLines()[0].text,report.mergedText);}
      if(dualMode){check('saved source recognition restored',live.words[0].sttText,'하나님에');check('saved output correction restored',live.words[0].text,'하나님의');}
      const exported=await SS.doExport(dir+'/output.mp4');check('MP4 export success',exported.success,true);
      check('edited duration',Math.abs(exported.duration-3.6)<.001,true);
      const safeState=SS.project.snapshot(live,SS.preview.currentTime);let rejected=false;
      try{await SS.importProjectState({...disk,source:{...disk.source,path:dir+'/nonexistent-source.mp4'}});}catch(_){rejected=true;}
      check('missing source rejected',rejected,true);
      check('failed import preserves edit state',SS.project.snapshot(live,SS.preview.currentTime),safeState);
      report.export=exported;report.segments=SS.getSegments();report.success=true;
      document.getElementById('fileName').textContent=live.source.path.split(/[\\/]/).pop();SS.toast('저장·복원·내보내기 검증 완료');
    }catch(err){report.success=false;report.error=err.stack||err.message;}
    report.finishedAt=new Date().toISOString();await window.api.writeText(dir+'/validation.json',JSON.stringify(report,null,2));
    if(report.success)window.api.notifyTestReady({success:true,assertions:report.assertions.length});else window.api.notifyTestError(report.error);
  });
})();
