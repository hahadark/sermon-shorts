const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const edl=require('../src/shared/edl');const theme=require('../src/shared/theme');
function setup(words) {
 const writes=[],draws=[],starts=[];let cleared=false;
 const context={clearRect(){cleared=true;}};
 const canvas={getContext:()=>context,toDataURL:()=> 'data:image/png;base64,AA=='};
 const button={textContent:'내보내기',disabled:false,addEventListener(){}};
 const SS={edl,theme,state:{source:{path:'input.mp4',duration:10},words,overrides:{},settings:{padBefore:0,padAfter:0,fadeMs:0,maxLineChars:14},meta:{title:'제목'},activeTheme:theme.normalizeTheme({id:'saved',canvas:{background:'#123456'},video:{x:100,y:500,width:800,height:700}})},drawTemplate(ctx,layers,params){assert.equal(cleared,true,'every transparent image must start cleared');cleared=false;draws.push({layers,params});}};
 const api={getLaunchInfo:async()=>({root:'root'}),mkdir:async()=>{},writeImage:async p=>writes.push(p),writeText:async(p,text)=>writes.push({p,text}),startExport:async p=>{starts.push(p);return {success:true};}};
 const sandbox={window:{SS,api},document:{fonts:{ready:Promise.resolve()},createElement:()=>canvas,getElementById:()=>button},console};vm.runInNewContext(fs.readFileSync(require.resolve('../src/renderer/exporter.js'),'utf8'),sandbox);
 return {SS,writes,draws,starts};
}
test('export uses active theme and same pipeline writes MP4 parameters and SRT',async()=>{const s=setup([{id:0,text:'은혜',start:1,end:2}]);const result=await s.SS.doExport('out.mp4');assert.equal(result.success,true);assert.equal(s.starts[0].theme.id,'saved');assert.equal(s.starts[0].theme.video.x,100);assert.equal(s.starts[0].fadeMs,0);assert.equal(result.duration,1);assert.ok(s.writes.some(w=>w.p==='out.srt'&&w.text.includes('은혜')));assert.ok(s.draws.every(d=>d.params.theme.id==='saved'));});
test('export rejects all-deleted transcript before allocating images or launching FFmpeg',async()=>{const s=setup([{id:0,text:'삭제',start:1,end:2,del:true}]);const r=await s.SS.doExport('out.mp4');assert.equal(r.success,false);assert.match(r.error,/남은 영상/);assert.equal(s.starts.length,0);assert.equal(s.writes.length,0);});
test('export excludes deleted words from subtitle images and SRT',async()=>{const s=setup([{id:0,text:'남김',start:1,end:2},{id:1,text:'삭제문장',start:3,end:4,del:true}]);await s.SS.doExport('out.mp4');const subtitle=s.draws.filter(x=>x.layers.includes('subtitle')).map(x=>x.params.subtitleText).join(' ');assert.ok(subtitle.includes('남김'));assert.ok(!subtitle.includes('삭제문장'));});

test('export applies maximum length and strict word splitting to both frames and SRT',async()=>{const s=setup([{id:0,text:'가나다라마바사아자차',start:1,end:3}]);s.SS.state.settings.maxLineChars=4;s.SS.state.settings.splitLongWords=true;const r=await s.SS.doExport('out.mp4');assert.equal(r.success,true);const texts=s.draws.filter(x=>x.layers.includes('subtitle')).map(x=>x.params.subtitleText);assert.deepEqual(texts,['가나다라','마바사아','자차']);const text=s.writes.find(w=>w.p==='out.srt').text;assert.ok(texts.every(t=>text.includes(t)));assert.equal(s.starts[0].segments.length,1);assert.equal(r.duration,2);});
