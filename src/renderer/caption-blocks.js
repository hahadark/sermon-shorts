/* Vrew-style caption cards: immutable recognition row + independently editable output row. */
(function(){
  'use strict';const SS=window.SS;const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let signature='',active=null,needsRender=false,visibleBlocks=[],toolbarReady=false;const checked=new Set();
  const count=text=>Array.from(String(text).replace(/\s/g,'')).length;
  function commit(redraw=true){
    if(active){const pending=active;active=null;if(pending.dirty){SS.pushUndo();needsRender=true;}}
    if(redraw&&needsRender){needsRender=false;SS.renderTranscript();}
  }
  SS.flushCaptionEdit=commit;
  function cancel(){if(!active)return;const a=active;active=null;for(let i=0;i<a.before.length;i++){SS.state.words[i].text=a.before[i].text;if(a.before[i]._oldText===undefined)delete SS.state.words[i]._oldText;else SS.state.words[i]._oldText=a.before[i]._oldText;}SS.renderTranscript(false);SS.updateTemplatePreview();}
  function syncChecks(body=document.getElementById('transcriptBody')){
    const ws=SS.state.words;const alive=new Set(ws.filter(w=>!w.del).map(w=>w.id));for(const id of checked)if(!alive.has(id))checked.delete(id);
    let selected=0;
    body.querySelectorAll('.caption-check').forEach(el=>{const b=visibleBlocks[+el.dataset.checkBlock];const ids=b?b.indices.filter(i=>ws[i]&&!ws[i].del).map(i=>ws[i].id):[];const n=ids.filter(id=>checked.has(id)).length;el.disabled=!ids.length;el.checked=!!ids.length&&n===ids.length;el.indeterminate=n>0&&n<ids.length;if(n)selected++;});
    const button=document.getElementById('btnDeleteCheckedCaptions');if(!button)return;
    button.disabled=!selected;button.textContent=selected?'선택 구간 삭제 ('+selected+'개)':'선택 구간 삭제';
    document.getElementById('btnUncheckCaptions').disabled=!selected;document.getElementById('btnCheckAllCaptions').disabled=!alive.size;document.getElementById('lblCheckedCaptions').textContent=selected+'개 선택';
  }
  SS.clearCheckedCaptions=()=>{checked.clear();if(document.getElementById('transcriptBody'))syncChecks();};
  function connectToolbar(){if(toolbarReady)return;toolbarReady=true;
    document.getElementById('btnCheckAllCaptions').onclick=()=>{commit(false);SS.state.words.filter(w=>!w.del).forEach(w=>checked.add(w.id));syncChecks();};
    document.getElementById('btnUncheckCaptions').onclick=()=>{checked.clear();syncChecks();};
    document.getElementById('btnDeleteCheckedCaptions').onclick=()=>{commit(false);if(!checked.size)return;SS.pushUndo();let n=0;SS.state.words.forEach(w=>{if(checked.has(w.id)&&!w.del){w.del=true;n++;}});checked.clear();SS.renderTranscript();SS.updateTemplatePreview();if(n)SS.toast('선택 구간을 삭제했습니다. Ctrl+Z로 복원할 수 있습니다.');};
  }
  function mergeAtStart(el,body){
    const row=visibleBlocks[+el.dataset.captionEditor]?.editorLine;const first=row?.parts?.[0];commit(false);
    const currentLines=SS.getLines();const index=first?currentLines.findIndex(l=>l.parts.some(p=>p.id===first.id&&p.from===first.from)):-1;
    if(index<=0)return;
    const result=SS.captionEdit.merge(SS.state.words,currentLines[index-1],currentLines[index]);if(!result)return;
    SS.pushUndo();SS.state.words=result.words;needsRender=false;SS.renderTranscript();SS.updateTemplatePreview();
    const anchor=String(result.anchor.id)+':'+result.anchor.from;const target=Array.from(body.querySelectorAll('.caption-output')).find(e=>e.dataset.captionAnchor===anchor);
    if(target){target.focus();target.setSelectionRange(result.caret,result.caret);target.scrollIntoView({block:'nearest'});}
  }
  // 출력 자막 칸에서 Enter: 커서 자리에서 자막을 둘로 나눈다 (영상은 그대로). 맨 끝이면 다음 자막으로, 맨 앞이면 적용만.
  function splitAtCaret(el,body){
    const value=el.value,caret=el.selectionStart,index=+el.dataset.captionEditor;
    if(el.selectionEnd!==caret||!value.slice(0,caret).trim()){commit();body.focus();return;}
    if(!value.slice(caret).trim()){commit();const next=body.querySelector(`[data-caption-editor="${index+1}"]`);if(next){next.focus();next.setSelectionRange(0,0);next.scrollIntoView({block:'nearest'});}else body.focus();return;}
    const first=visibleBlocks[index]?.editorLine?.parts?.[0];
    commit(false);
    const line=first?SS.getLines().find(l=>l.parts.some(p=>p.id===first.id&&p.from===first.from)):null;
    if(!line)return;
    // 입력칸 글과 줄 글의 띄어쓰기가 달라도 맞도록, 커서 앞 글자(공백 제외) 수로 자리를 찾는다
    const want=Array.from(value.slice(0,caret).replace(/\s+/g,'')).length,t=line.text;let pos=0,seen=0;
    while(pos<t.length&&seen<want){if(!/\s/.test(t[pos]))seen++;pos++;}
    if(/\s$/.test(value.slice(0,caret)))while(pos<t.length&&/\s/.test(t[pos]))pos++;
    const result=SS.captionEdit.split(SS.state.words,line,pos);
    if(!result){SS.toast&&SS.toast('여기서는 자막을 나눌 수 없습니다');return;}
    SS.pushUndo();SS.state.words=result.words;needsRender=false;SS.renderTranscript();SS.updateTemplatePreview();
    const anchor=String(result.anchor.id)+':'+result.anchor.from;
    const target=Array.from(body.querySelectorAll('.caption-output')).find(e=>e.dataset.captionAnchor===anchor)||body.querySelector(`[data-caption-editor="${index+1}"]`);
    if(target){target.focus();target.setSelectionRange(0,0);target.scrollIntoView({block:'nearest'});}
  }
  SS.splitCaptionAtCaret=splitAtCaret;
  function style(){
    if(document.getElementById('caption-block-style'))return;
    const s=document.createElement('style');s.id='caption-block-style';s.textContent=`
      @keyframes blink{50%{opacity:0}} .caret-blink{display:inline-block;width:2px;height:1.2em;vertical-align:middle;background:#fff;margin:0 -1px;animation:blink 1s step-end infinite}
      #transcriptBody:focus{outline:none}.caption-block{border:1px solid #3a3e46;border-radius:7px;margin:0 0 9px;padding:8px 11px;background:#1a1c21}
      .caption-block.caret-active{border-color:#6a95b8} .caption-head{display:flex;gap:12px;align-items:center;color:#a6b2c0;font-size:11px;margin-bottom:5px}
      .caption-seek{background:none;border:0;color:#91badb;font:inherit;cursor:pointer;padding:0}
      .caption-track{display:grid;grid-template-columns:76px minmax(0,1fr);gap:6px;align-items:start;margin-top:5px}
      .caption-track-label{font-size:11px;color:#98a5b5;padding-top:3px;user-select:none}
      .caption-source{line-height:1.9;min-height:26px;color:#b6bcc5} .caption-source [data-wid]{cursor:text;padding:1px 3px;border-radius:2px}
      .caption-source .word-selected{background:rgba(255,222,80,.3)} .caption-source .deleted-run{background:rgba(180,65,65,.15);border-radius:3px;color:#be8080}
      .caption-source .deleted-run [data-wid]{text-decoration:line-through;color:#be8080}.restore-run{font-size:10px;padding:0 4px;margin-left:4px;cursor:pointer}
      .caption-output{display:block;width:100%;max-width:640px;box-sizing:border-box;resize:vertical;min-height:34px;line-height:1.6;font:inherit;font-size:16px;padding:4px 7px;color:#fff;background:#222a34;border:1px solid #526278;border-radius:4px}
      .caption-output:focus{outline:1px solid #7bb9e9;border-color:#7bb9e9}.caption-count{margin-left:auto;color:#8aa79b}.caption-count.over-limit{color:#edc17e}
      .caption-word-editor:empty{display:none}.caption-word-editor{margin:5px 0 0 82px;color:#9bc4e6;font-size:11px}
      .caption-empty{color:#8d929b;font-size:12px;padding:4px 0}.hide-scissors,.cut-marker{cursor:pointer;padding:0 4px;background:#343b43;border-radius:3px;font-size:11px}
    `;document.head.appendChild(s);
  }
  function refreshCaret(body){
    body.querySelector('#the-caret')?.remove();const ws=SS.state.words;const r=SS.state.selection;
    body.querySelectorAll('[data-wid]').forEach(el=>el.classList.toggle('word-selected',!!r&&+el.dataset.wid>=Math.min(...r)&&+el.dataset.wid<Math.max(...r)));
    body.querySelectorAll('.caption-block').forEach(el=>el.classList.toggle('caret-active',SS.state.caret>=+el.dataset.from&&(SS.state.caret<+el.dataset.to||SS.state.caret===ws.length&&+el.dataset.to===ws.length)));
    const c=document.createElement('span');c.id='the-caret';c.className='caret-blink';
    const next=body.querySelector(`[data-wid="${SS.state.caret}"]`);if(next)next.before(c);else{const all=body.querySelectorAll('[data-wid]');if(all.length)all[all.length-1].after(c);}
  }
  SS.renderCaptionBlocks=function(body,ws,lines,segments){
    style();connectToolbar();SS.captionEdit.capture(ws);
    const nextSignature=JSON.stringify([ws,lines,SS.state.hideDeleted,SS.state.markI,SS.state.markO,SS.state.source?.offset,SS.state.settings.maxLineChars]);
    if(signature===nextSignature&&body.querySelector('.caption-block')){refreshCaret(body);syncChecks(body);return;}
    signature=nextSignature;const scroll=body.scrollTop;const blocks=[];let cursor=0;
    const ids=new Map(ws.map((w,i)=>[w.id,i]));const max=SS.state.settings.maxLineChars||14;
    function gaps(a,b){let group=[],size=0;for(let i=a;i<b;i++){const len=count(SS.captionEdit.sourceText(ws[i]));if(group.length&&size+len>max){blocks.push({indices:group,line:null});group=[];size=0;}group.push(i);size+=len;}if(group.length)blocks.push({indices:group,line:null});}
    for(const line of lines){const indexes=line.words.map(id=>ids.get(id)).filter(i=>i!==undefined);if(!indexes.length)continue;const a=Math.min(...indexes),b=Math.max(...indexes)+1;if(a>cursor)gaps(cursor,a);blocks.push({indices:Array.from({length:b-a},(_,n)=>a+n),line});cursor=Math.max(cursor,b);}
    if(cursor<ws.length)gaps(cursor,ws.length);
    visibleBlocks=blocks;
    const runs=Caret.runsOf(ws),runMap=new Map();for(const [a,b] of runs)for(let i=a;i<b;i++)runMap.set(i,{a,b});
    const cuts=new Map(SS.edl.cutPoints(segments).map(c=>[c.keyEnd,c]));
    let html='';
    blocks.forEach((block,n)=>{
      const first=ws[block.indices[0]],last=ws[block.indices.at(-1)];const live=block.indices.filter(i=>!ws[i].del);
      const row=block.line||{text:'',words:live.map(i=>ws[i].id),parts:live.map(i=>({id:ws[i].id,text:ws[i].text,from:0,to:Array.from(ws[i].text).length}))};block.editorLine=row;
      html+=`<section class="caption-block" data-block="${n}" data-from="${block.indices[0]}" data-to="${block.indices.at(-1)+1}"><div class="caption-head"><label title="같은 STT 단어를 나눠 표시한 구간은 함께 선택됩니다"><input type="checkbox" class="caption-check" data-check-block="${n}" aria-label="${n+1}번 구간 선택" style="width:auto;cursor:pointer"> <strong>${String(n+1).padStart(3,'0')}</strong></label><button class="caption-seek" data-seek="${first.start}">${esc(SS.fmtTime(first.start+(SS.state.source?.offset||0)))} ~ ${esc(SS.fmtTime(last.end+(SS.state.source?.offset||0)))}</button><span class="caption-count">${count(row.text)} / ${max}자${row.manualMerge?' · 수동 병합':count(row.text)>max?' · 적용 시 자동 분할':''}</span></div>`;
      if(row.manualMerge)html+=`<button class="caption-unmerge" data-unmerge="${n}" style="font-size:11px;margin-bottom:5px">${max}자로 다시 나누기</button>`;
      html+='<div class="caption-track"><span class="caption-track-label">STT 원문</span><div class="caption-source">';
      let openRun=null;
      for(const i of block.indices){const w=ws[i],run=runMap.get(i);if(openRun&&(!w.del||openRun.a!==run?.a)){html+='</span>';openRun=null;}
        if(w.del&&SS.state.hideDeleted){if(i===block.indices[0]||!ws[i-1]?.del)html+=`<span class="hide-scissors" data-runstart="${run.a}">삭제 구간 펼치기</span>`;continue;}
        if(w.del&&!openRun){html+=`<span class="deleted-run" data-runstart="${run.a}">`;openRun=run;}
        const marker=i===SS.state.markI?' title="쇼츠 시작점"':i===SS.state.markO?' title="쇼츠 끝점"':'';
        html+=`<span data-wid="${i}"${marker}>${esc(SS.captionEdit.sourceText(w))}</span> `;
        if(w.del&&(i===block.indices.at(-1)||!ws[i+1]?.del)){html+=`<button class="restore-run" data-runstart="${run.a}">되살리기</button></span>`;openRun=null;}
        const cut=cuts.get('e:'+w.id);if(cut&&!w.del)html+=`<span class="cut-marker" data-c1="${i}" data-c2="${cut.keyStart.slice(2)}" title="컷 정밀 조정 (T)">컷 조정</span>`;
      }
      if(openRun)html+='</span>';
      html+='</div></div><div class="caption-word-editor"></div><div class="caption-track"><span class="caption-track-label" style="color:#9ac7af">출력 자막</span>';
      html+=live.length?`<textarea class="caption-output" rows="1" maxlength="2000" data-caption-editor="${n}" data-caption-anchor="${esc(row.parts[0]?String(row.parts[0].id)+':'+row.parts[0].from:'')}" title="Enter: 커서 자리에서 자막 나누기 · 맨 앞 Backspace: 위 자막과 합치기 · Ctrl+Enter: 적용 · 영상은 유지됩니다" aria-label="${n+1}번 출력 자막" placeholder="빈칸이면 자막만 숨김 · 영상 유지">${esc(row.text)}</textarea>`:'<div class="caption-empty">삭제된 영상 구간 · 되살리면 자막도 복원됩니다</div>';
      html+='</div></section>';
    });
    body.innerHTML=html;body.scrollTop=scroll;
    body.querySelectorAll('.caption-check').forEach(el=>el.onchange=()=>{commit(false);const b=blocks[+el.dataset.checkBlock];b.indices.forEach(i=>{if(!ws[i].del){if(el.checked)checked.add(ws[i].id);else checked.delete(ws[i].id);}});syncChecks(body);});
    body.querySelectorAll('.caption-unmerge').forEach(el=>el.onclick=()=>{commit(false);SS.pushUndo();SS.state.words=SS.captionEdit.unmerge(SS.state.words,blocks[+el.dataset.unmerge].editorLine);needsRender=false;SS.renderTranscript();SS.updateTemplatePreview();});
    body.querySelectorAll('.restore-run').forEach(btn=>btn.onmousedown=e=>{e.preventDefault();e.stopPropagation();commit(false);let i=+btn.dataset.runstart;while(ws[i]?.del)ws[i++].del=false;SS.renderTranscript();SS.updateTemplatePreview();});
    body.querySelectorAll('.caption-seek').forEach(btn=>btn.onclick=()=>{commit(false);SS.preview.seek(+btn.dataset.seek);});
    body.querySelectorAll('.caption-output').forEach(el=>{
      el.addEventListener('focus',()=>{commit(false);SS.preview.pause();SS.state.manualCaret=true;SS.pushUndo();active={el,line:blocks[+el.dataset.captionEditor].editorLine,before:SS.state.words.map(w=>({...w})),dirty:false};const line=active.line;const time=Number.isFinite(line.outStart)?SS.edl.outToSrc(segments,line.outStart)?.t:ws.find(w=>w.id===line.words[0])?.start;if(Number.isFinite(time))SS.preview.seek(time);});
      el.addEventListener('input',()=>{
        if(!active||active.el!==el)return;
        const updated=SS.captionEdit.apply(active.before,active.line,el.value);
        updated.forEach((w,i)=>{SS.state.words[i].text=w.text;SS.state.words[i].sttText=w.sttText;if(w._oldText!==undefined)SS.state.words[i]._oldText=w._oldText;else delete SS.state.words[i]._oldText;});
        active.dirty=JSON.stringify(updated.map(w=>w.text))!==JSON.stringify(active.before.map(w=>w.text));SS.updateOutput();SS.updateTemplatePreview();
        const badge=el.closest('.caption-block').querySelector('.caption-count');badge.textContent=`${count(el.value)} / ${max}자${active.line.manualMerge?' · 수동 병합':count(el.value)>max?' · 적용 시 자동 분할':''}`;badge.classList.toggle('over-limit',count(el.value)>max);
      });
      el.addEventListener('blur',()=>queueMicrotask(()=>{if(active?.el===el)commit();}));
      el.addEventListener('keydown',e=>{if(e.isComposing)return;
        if((e.ctrlKey||e.metaKey)&&!e.altKey&&['z','y'].includes(e.key.toLowerCase())&&!active?.dirty){e.preventDefault();commit(false);if(e.shiftKey||e.key.toLowerCase()==='y')SS.redo();else SS.undo();body.focus();e.stopPropagation();return;}
        if(e.key==='Backspace'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&el.selectionStart===0&&el.selectionEnd===0){e.preventDefault();mergeAtStart(el,body);e.stopPropagation();return;}if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();splitAtCaret(el,body);e.stopPropagation();return;}if(e.key==='Enter'){e.preventDefault();commit();body.focus();}else if(e.key==='Escape'){e.preventDefault();cancel();body.focus();}else if(e.key==='Tab'){e.preventDefault();const index=+el.dataset.captionEditor;commit();body.querySelector(`[data-caption-editor="${index+(e.shiftKey?-1:1)}"]`)?.focus();}e.stopPropagation();});
    });
    refreshCaret(body);syncChecks(body);
  };
})();
