'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require.resolve('../src/renderer/source-recover.js'),'utf8');
const SF=require('../src/shared/source-fetch');
function fixture({exists=false,setting,choices=[],download,locate='D:/found.mp4'}={}){
  const dialogs=[],actions=[],downloads=[];let asked=0;const SS={sourceFetch:SF};if(setting!==undefined)SS.appSettings={sourceMissing:setting};
  const doc={body:{appendChild(m){dialogs.push(m);if(m.innerHTML.includes('data-a=')){const choice=choices[asked++]||'cancel';queueMicrotask(()=>{actions.push(choice);m.buttons[choice]?.fn?.();});}}},createElement(){const m={innerHTML:'',buttons:{},addEventListener(){},remove(){this.removed=true;},querySelectorAll(){for(const [,a] of this.innerHTML.matchAll(/data-a="([^"]+)"/g)){this.buttons[a]={dataset:{a},addEventListener(_e,fn){this.fn=fn;},focus(){}};}return Object.values(this.buttons);},querySelector(sel){if(sel.includes('data-a=locate'))return this.buttons.locate;if(sel.includes('.btn.primary'))return this.buttons.download;return {style:{},focus(){}};}};return m;}};
  const api={fileExists:async()=>exists,onProgress:()=>()=>{},openVideoDialog:async()=>locate,ytDownload:async(...args)=>{downloads.push(args);return download?download(...args):{path:'D:/received.mp4',offset:10};},ytFetchPart:async(...args)=>{downloads.push(args);return {path:'D:/received-part.mp4',offset:10};}};
  vm.runInNewContext(code,{window:{SS,api},document:doc,setTimeout:fn=>queueMicrotask(fn)});
  return {SS,dialogs,actions,downloads};
}
const saved=()=>({source:{path:'D:/deleted.mp4',url:'https://youtu.be/jNQXAC9IVRw',offset:10,duration:20,fetch:{kind:'section',start:10,end:30}},words:[{id:0,text:'원본',start:1,end:2,del:true},{id:1,text:'편집',start:3,end:4}],meta:{title:'내 설교'},overrides:{'s:1':3.1},materials:{sermon:'원고'}});
test('원본이 있으면 다운로드·질문 없이 그대로',async()=>{const f=fixture({exists:true}),s=saved();assert.equal(await f.SS.ensureSource(s),s);assert.equal(f.dialogs.length,0);assert.equal(f.downloads.length,0);});
test('설정이 없을 때도 유튜브 원본은 자동 다운로드, 편집·자료 보존',async()=>{const f=fixture(),s=saved(),before=JSON.stringify(s);const r=await f.SS.ensureSource(s);assert.equal(f.downloads.length,1);assert.equal(f.actions.length,0);assert.equal(r.source.path,'D:/received.mp4');assert.equal(JSON.stringify(s),before);assert.deepEqual(r.words,s.words);assert.deepEqual(r.materials,s.materials);assert.equal(f.SS.lastSourceRecovery,'downloaded');});
test('경로가 없어도 유튜브 주소·구간이 남으면 다시 받음',async()=>{const f=fixture(),s=saved();s.source.path='';const r=await f.SS.ensureSource(s);assert.equal(f.downloads.length,1);assert.equal(r.source.path,'D:/received.mp4');});
test('묻기 명시 설정은 유지하며 다시 받기를 고를 수 있음',async()=>{const f=fixture({setting:'ask',choices:['download']});await f.SS.ensureSource(saved());assert.deepEqual(f.actions,['download']);assert.equal(f.downloads.length,1);});
test('자동 다운로드 실패 후 직접 파일 찾기로 전환, 무한 재시도 없음',async()=>{const f=fixture({download:async()=>{throw Error('네트워크 연결 끊김');},choices:['locate']});const r=await f.SS.ensureSource(saved());assert.equal(f.downloads.length,1);assert.equal(r.source.path,'D:/found.mp4');assert.equal(f.SS.lastSourceRecovery,'located');assert.ok(f.dialogs.some(d=>d.innerHTML.includes('네트워크 연결 끊김')));assert.ok(f.dialogs.every(d=>d.removed));});
test('주소 없는 로컬 파일은 다운로드하지 않고 파일 찾기',async()=>{const f=fixture({choices:['locate']}),s=saved();s.source.url='';const r=await f.SS.ensureSource(s);assert.equal(f.downloads.length,0);assert.equal(r.source.path,'D:/found.mp4');});
test('실패 뒤 취소해도 원래 편집을 훼손하지 않음',async()=>{const f=fixture({download:async()=>{throw Error('비공개 영상');},choices:['cancel']}),s=saved(),before=JSON.stringify(s);await assert.rejects(f.SS.ensureSource(s),e=>e.code==='cancelled');assert.equal(JSON.stringify(s),before);assert.equal(f.downloads.length,1);});

test('다시 받아 열기라는 명시적 선택은 묻기 설정에서도 추가 확인 없이 받음',async()=>{const f=fixture({setting:'ask'});const r=await f.SS.ensureSource(saved(),{forceDownload:true});assert.equal(f.actions.length,0);assert.equal(f.downloads.length,1);assert.equal(r.source.path,'D:/received.mp4');});
