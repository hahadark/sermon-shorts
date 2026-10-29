/* Documentation and packaged-app checks. No STT, YouTube fetch or AI requests. */
(function(){const SS=window.SS;const wait=ms=>new Promise(r=>setTimeout(r,ms));
window.addEventListener('ss:run-test-script',async e=>{
 if(e.detail!=='guide-capture'&&e.detail!=='package-smoke')return;
 const launch=await window.api.getLaunchInfo();const dir=(launch.cache||launch.root+'/cache')+'/guide';await window.api.mkdir(dir);
 const report={startedAt:new Date().toISOString(),packaged:launch.isPackaged,dataRoot:launch.dataRoot,root:launch.root,cache:launch.cache,assertions:[]};
 const check=(name,pass)=>{report.assertions.push({name,pass:!!pass});if(!pass)throw Error(name);};
 try{
   const close=()=>{document.querySelectorAll('.modal-close').forEach(b=>b.click());document.getElementById('yt-cancel')?.click();document.getElementById('btnAiClose')?.click();};
   await window.api.saveSettings({sysCheckSeen:true,template:{churchName:'우리 교회'},speakers:['홍길동 목사'],defaultSpeaker:'홍길동 목사'});SS.appSettings=await window.api.getSettings();close();await wait(500);
   const st=SS.state,start=Math.min(940,st.source.duration-10);const spans=[[0,.7],[.9,1.6],[1.7,2.2],[2.3,2.8],[3,3.5],[3.8,4.5],[4.6,5.3]];
   st.words=spans.map(([a,b],id)=>({id,text:['하나님의','은혜가','충분합니다.','불필요한','말','믿음으로','살아갑니다.'][id],sttText:['하나님에','은해가','충분합니다.','불필요한','말','믿음으로','살아갑니다.'][id],start:start+a,end:start+b,del:id===3||id===4,br:id===2||id===5}));
   st.settings={padBefore:0,padAfter:0,fadeMs:10,maxLineChars:14,splitLongWords:true};st.overrides={};st.caret=0;st.selAnchor=0;st.selection=null;st.hideDeleted=false;st.markI=-1;st.markO=-1;
   st.activeTheme=SS.theme.normalizeTheme({id:'basic-blank',name:'기본 빈 테마',logo:{show:false},churchName:{text:'우리 교회'}});st.crop={scale:1,x:.5,y:.5};st.meta={title:'설교 쇼츠 예제',verse:'설명서용 예제 자막',speaker:'홍길동 목사'};
   document.getElementById('inpTitle').value=st.meta.title;document.getElementById('inpVerse').value=st.meta.verse;document.getElementById('selSpeaker').value='직접 입력';document.getElementById('inpSpeaker').value=st.meta.speaker;
   SS.syncCaptionUI();SS.resetEditorHistory();SS.applyCrop();await SS.preview.seek(start+.2);await SS.updateTemplatePreview();if(SS.refreshExportUI)SS.refreshExportUI();await wait(300);close();
   const shot=async name=>{await SS.testShot(dir+'/'+name+'.png');};
   check('local transcript button available',!!document.getElementById('btnTranscribe'));check('video preview ready',SS.preview.loaded);check('three output captions',SS.getLines().length===3);check('guide available button',!!document.getElementById('btnUserGuide'));
   await shot('01-overview');
   const boxes=Array.from(document.querySelectorAll('.caption-check')).filter(b=>!b.disabled);boxes[0].checked=true;boxes[0].dispatchEvent(new Event('change',{bubbles:true}));boxes.at(-1).checked=true;boxes.at(-1).dispatchEvent(new Event('change',{bubbles:true}));await shot('02-bulk-delete');document.getElementById('btnUncheckCaptions').click();
   let fields=Array.from(document.querySelectorAll('.caption-output'));fields[1].focus();fields[1].setSelectionRange(0,0);fields[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true}));await shot('03-merge');SS.flushCaptionEdit(false);SS.undo();document.getElementById('transcriptBody').focus();
   const cuts=SS.getCuts();check('trim cut exists',cuts.length>0);await SS.openTrimPanel(cuts[0].a,cuts[0].b);await wait(400);await shot('04-trim');SS.closeTrim();
   if(e.detail==='guide-capture'){const blk=document.querySelectorAll('.caption-block')[0];document.getElementById('transcriptBody').scrollTop=0;await SS.openFineTuneBlock(blk);await wait(400);check('fine tune opens',SS.getTrimState()&&SS.getTrimState().kind==='range');await shot('14-fine');SS.closeTrim();}
   const output=await SS.doExport(dir+'/example.mp4');check('real export succeeds',output.success);report.export=output;
   check('no credentials returned',!SS.appSettings.geminiApiKeyEnc&&!SS.appSettings.apiKey);
   if(launch.isPackaged){check('cache outside installed app',!launch.cache.toLowerCase().startsWith(launch.root.toLowerCase()));check('engine excluded and optional',!launch.engineReady);}
   if(e.detail==='guide-capture'){
     await SS.openThemeEditor('basic-blank');await wait(500);await shot('05-theme-editor');document.getElementById('teBtnClose').click();await wait(150);
     await SS.openSettings('church');await wait(200);await shot('06-church-settings');close();
     await SS.openSettings('ai');await wait(200);await shot('07-ai-settings');close();
     await SS.openYoutubeImport();await wait(200);await shot('08-youtube');document.getElementById('yt-cancel')?.click();
     document.getElementById('btnAiRecommend').click();await wait(300);await shot('09-ai-options');document.querySelectorAll('.modal-overlay').forEach(el=>el.remove());
     await SS.openSysCheck();await wait(300);await shot('10-system-check');close();
     // 배경음악 (설명서 그림): 목록 → 곡 넣기(파형) · 교인 자료 스튜디오 (예제 자료, AI 안 부름)
     document.getElementById('tabMusic').click();SS.bgmUi.openLib();await wait(500);await shot('15-bgm-library');SS.bgmUi.closeLib();
     SS.useBgm('meditation-impromptu-01');const tw=Date.now();while(!document.getElementById('bgmWaveMsg').hidden&&Date.now()-tw<40000)await wait(300);
     SS.state.bgm.trackStart=12;SS.state.bgm.trackEnd=40;SS.state.bgm.align='end';SS.bgmUi.render();SS.bgmUi.drawWave();await wait(300);await shot('16-bgm-panel');
     SS.state.bgm=null;document.getElementById('tabDesign').click();
     await SS.openMaterials();await wait(500);await shot('17-materials');
     const ex={title:'은혜로 사는 사람',verse:'고린도후서 12:9',summary:'하나님의 은혜는 우리의 약함 속에서 온전해집니다. 약함을 숨기지 않고 은혜를 의지할 때 믿음으로 살아갑니다.',icebreaker:'요즘 나를 가장 지치게 하는 일은 무엇인가요?',questions:[{q:'설교에서 은혜가 충분하다는 말은 어떤 뜻이었나요?',note:'약함 속에서 온전해지는 능력'},{q:'나의 약함을 하나님 앞에 내어놓기 어려운 까닭은 무엇일까요?',note:''},{q:'이번 주 믿음으로 살아가기 위해 붙들 한 문장을 나눠 봅시다.',note:''}],action:'날마다 감사 한 가지를 적고 함께 나누기',prayer:'주님, 우리의 약함 속에 주님의 은혜가 충분함을 믿고 살게 하소서.'};
     const ms=SS._materialsTest.store();ms.results={smallgroup:{data:SS.materials.normalize('smallgroup',ex),options:ms.options,meta:{church:'우리 교회',title:'설교 쇼츠 예제',verse:'고린도후서 12:9',speaker:'홍길동 목사',date:'2026년 10월 25일'},made:new Date().toISOString(),provider:'예제'}};
     SS._materialsTest.show('results');await wait(400);await shot('18-materials-doc');SS.closeMaterials();SS.state.materials=null;
   }
   SS.toast('오프라인 실행·자막 편집·MP4/SRT 출력 확인 완료');report.success=true;
 }catch(err){report.success=false;report.error=err.stack||err.message;}
 report.finishedAt=new Date().toISOString();await window.api.writeText(dir+'/validation.json',JSON.stringify(report,null,2));if(report.success)window.api.notifyTestReady({success:true});else window.api.notifyTestError(report.error);
});})();
