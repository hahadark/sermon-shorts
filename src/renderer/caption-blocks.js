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
  // STT 원문은 단어 사이 커서로 편집한다. 같은 경계가 앞줄 끝/뒷줄 시작 모두 될 수 있어 클릭한 줄도 기억한다.
  let sourceAnchor = null;
  function anchorOf(b) { const p=b?.editorLine?.parts?.[0]; return p ? p.id+':'+p.from : null; }
  function rememberSource(el) { const b=visibleBlocks[+el?.dataset?.block]; sourceAnchor=anchorOf(b); }
  SS.rememberSourceCaption=rememberSource;
  function sourceBlockAtCaret() {
    const c=SS.state.caret;
    let b=visibleBlocks.find(x=>anchorOf(x)===sourceAnchor && c>=x.indices[0] && c<=x.indices.at(-1)+1);
    if(!b)b=visibleBlocks.find(x=>c>=x.indices[0]&&c<x.indices.at(-1)+1);
    if(!b&&c===SS.state.words.length)b=visibleBlocks.at(-1);
    return b;
  }
  SS.mergeSourceAtBoundary=(dir)=>{
    const sel=SS.state.selection;if(sel&&sel[0]!==sel[1])return false;
    const b=sourceBlockAtCaret();if(!b?.line)return false;
    const c=SS.state.caret;
    if(c!==(dir<0?b.indices[0]:b.indices.at(-1)+1))return false;
    const i=visibleBlocks.indexOf(b),other=visibleBlocks[i+dir];if(!other?.line)return false;
    commit(false);
    const left=dir<0?other:b,right=dir<0?b:other;
    const result=SS.captionEdit.merge(SS.state.words,left.editorLine,right.editorLine);if(!result)return false;
    SS.pushUndo();SS.state.words=result.words;needsRender=false;sourceAnchor=result.anchor.id+':'+result.anchor.from;
    SS.state.caret=right.indices[0];SS.state.selection=null;SS.state.manualCaret=true;
    SS.renderTranscript();SS.updateTemplatePreview();SS.pushUndo();
    const body=document.getElementById('transcriptBody');body.focus({preventScroll:true});
    body.querySelector('#the-caret')?.scrollIntoView({block:'nearest'});return true;
  };
  function mergeAtEnd(el,body){
    const first=visibleBlocks[+el.dataset.captionEditor]?.editorLine?.parts?.[0];commit(false);
    const ls=SS.getLines(),i=first?ls.findIndex(l=>l.parts.some(p=>p.id===first.id&&p.from===first.from)):-1;
    if(i<0||i>=ls.length-1)return;
    const result=SS.captionEdit.merge(SS.state.words,ls[i],ls[i+1]);if(!result)return;
    SS.pushUndo();SS.state.words=result.words;needsRender=false;SS.renderTranscript();SS.updateTemplatePreview();
    const target=Array.from(body.querySelectorAll('.caption-output')).find(e=>e.dataset.captionAnchor===result.anchor.id+':'+result.anchor.from);
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
      @keyframes blink{50%{opacity:0}} .caret-blink{display:inline-block;width:2px;height:1.2em;vertical-align:middle;background:#0f172a;margin:0 -1px;animation:blink 1s step-end infinite}
      #transcriptBody:focus{outline:none}
      .caption-block{border:1px solid #e6ebf2;border-radius:18px;margin:0 0 10px;padding:12px 16px 14px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.03)}
      .caption-block.caret-active{border-color:#93b4f5;box-shadow:0 0 0 3px rgba(37,99,235,.10)}
      .caption-head{display:flex;gap:10px;align-items:center;color:#64748b;font-size:12px;margin-bottom:6px}
      .caption-head label{display:inline-flex;align-items:center;gap:8px}
      .caption-head strong{display:inline-grid;place-items:center;min-width:30px;height:24px;padding:0 8px;border-radius:999px;background:#eaf1fe;color:#2563eb;font-size:12px;font-weight:800}
      .caption-seek{background:#f1f5f9;border:0;color:#475569;font:600 12px var(--font);cursor:pointer;padding:3px 11px;border-radius:999px}
      .caption-seek:hover{background:#e2e8f0;color:#0f172a}
      .caption-track{display:grid;grid-template-columns:76px minmax(0,1fr);gap:6px;align-items:start;margin-top:6px}
      .caption-track-label{font-size:12px;font-weight:600;color:#94a3b8;padding-top:4px;user-select:none}
      .caption-track-label.out{color:#059669}
      .caption-source{line-height:1.95;min-height:26px;color:#334155;font-size:14.5px} .caption-source [data-wid]{cursor:text;padding:1px 3px;border-radius:4px}
      .caption-source .word-selected{background:rgba(37,99,235,.16)} .caption-source .deleted-run{background:#fdecec;border-radius:6px;color:#b91c1c;padding:1px 2px}
      .caption-source .deleted-run [data-wid]{text-decoration:line-through;color:#d46a6a}.restore-run{font:600 11px var(--font);padding:1px 8px;margin-left:4px;cursor:pointer;border-radius:999px;border:1px solid #f5c2c2;background:#fff;color:#b91c1c}
      .caption-output{display:block;width:100%;max-width:680px;box-sizing:border-box;resize:vertical;min-height:38px;line-height:1.6;font:inherit;font-size:16px;font-weight:600;padding:6px 11px;color:#0f172a;background:#f8fafc;border:1px solid #dfe5ee;border-radius:12px}
      .caption-output:focus{outline:none;border-color:#3b82f6;background:#fff;box-shadow:0 0 0 3px rgba(59,130,246,.14)}
      .caption-count{margin-left:auto;color:#64748b;font-weight:600}.caption-count.over-limit{color:#b45309}
      .caption-delete{width:26px;height:26px;color:#b91c1c;flex:0 0 auto}.caption-delete:hover{background:#fef2f2}.caption-fine[aria-pressed="true"]{opacity:1;background:#eaf1fe;color:#2563eb}
      .caption-fine{width:28px;height:26px;opacity:.6}.caption-block:hover .caption-fine,.caption-fine:focus{opacity:1}
      .caption-word-editor:empty{display:none}.caption-word-editor{margin:6px 0 0 82px;color:#2563eb;font-size:12px}
      .caption-empty{color:#94a3b8;font-size:12.5px;padding:5px 0}
      .hide-scissors,.cut-marker{cursor:pointer;padding:1px 9px;background:#eef2f7;border-radius:999px;font-size:11.5px;font-weight:600;color:#475569;border:1px solid #e2e8f0}
      .cut-marker.ico{display:inline-flex;align-items:center;gap:4px;vertical-align:1px;line-height:18px}.cut-marker.ico::before{width:13px;height:13px}
      .cut-marker.gap-cut{background:#fff4dc;color:#b45309;border:1px solid #fcd9a0}
      .caption-source .filler-run{background:#fff4dc;color:#b45309}.caption-source .filler-run [data-wid]{color:#b45309;text-decoration-color:#d97706}
      .run-tag{font-size:10.5px;font-weight:800;color:#fff;background:#f59e0b;border-radius:999px;padding:0 7px;margin:0 3px 0 1px;pointer-events:none}
      .caption-source .filler-live{text-decoration:underline dotted #d97706;text-underline-offset:4px}
      .gap-restore{font:600 11px var(--font);padding:1px 8px;margin:0 2px 0 3px;cursor:pointer;border-radius:999px;border:1px solid #fcd9a0;background:#fff;color:#b45309}
      .pause-chip{font:600 11.5px var(--font);line-height:18px;padding:1px 8px;border-radius:999px;background:#fff;border:1px dashed #cbd5e1;color:#64748b;cursor:pointer;display:inline-flex;align-items:center;gap:4px;vertical-align:1px}
      .pause-chip::before{width:12px;height:12px}
      .pause-chip:hover{border-color:#f59e0b;color:#b45309}
      .caption-unmerge{font:600 11.5px var(--font);border-radius:999px;border:1px solid #cddcfb;background:#eaf1fe;color:#1d4ed8;padding:2px 10px;cursor:pointer}
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
    const nextSignature=JSON.stringify([ws,lines,SS.state.hideDeleted,SS.state.markI,SS.state.markO,SS.state.source?.offset,SS.state.settings.maxLineChars,SS.state.settings.semanticBreaks]);
    if(signature===nextSignature&&body.querySelector('.caption-block')){refreshCaret(body);syncChecks(body);return;}
    signature=nextSignature;const scroll=body.scrollTop;const blocks=[];let cursor=0;
    const ids=new Map(ws.map((w,i)=>[w.id,i]));const max=SS.state.settings.maxLineChars||14;
    function gaps(a,b){let group=[],size=0;for(let i=a;i<b;i++){const len=count(SS.captionEdit.sourceText(ws[i]));if(group.length&&size+len>max){blocks.push({indices:group,line:null});group=[];size=0;}group.push(i);size+=len;}if(group.length)blocks.push({indices:group,line:null});}
    for(const line of lines){const indexes=line.words.map(id=>ids.get(id)).filter(i=>i!==undefined);if(!indexes.length)continue;const a=Math.min(...indexes),b=Math.max(...indexes)+1;if(a>cursor)gaps(cursor,a);blocks.push({indices:Array.from({length:b-a},(_,n)=>a+n),line});cursor=Math.max(cursor,b);}
    if(cursor<ws.length)gaps(cursor,ws.length);
    visibleBlocks=blocks;
    const runs=Caret.runsOf(ws),runMap=new Map();for(const [a,b] of runs)for(let i=a;i<b;i++)runMap.set(i,{a,b});
    const cuts=new Map(SS.edl.cutPoints(segments).map(c=>[c.keyEnd,c]));
    // 군말·공백 표시: 군말만 지운 묶음은 노란 '군말', 이웃 단어 사이에서 잘라 낸 곳은 '공백 0.4초', 남겨 둔 긴 쉼은 '⏸ 0.8초'
    const D=SS.disfluency,isFill=t=>!!(D&&D.isFiller(t)),fillRun=new Map();
    for(const [a,b] of runs){let all=true;for(let i=a;i<b;i++)if(!isFill(ws[i].text)){all=false;break;}fillRun.set(a,all);}
    const pauseAt=new Map();if(D)D.pauses(ws,segments,0.5).forEach(p=>pauseAt.set(p.prev,p));
    const sec=v=>(Math.round(v*100)/100).toFixed(2).replace(/0$/,'');
    let html='';
    blocks.forEach((block,n)=>{
      const first=ws[block.indices[0]],last=ws[block.indices.at(-1)];const live=block.indices.filter(i=>!ws[i].del);
      const row=block.line||{text:'',words:live.map(i=>ws[i].id),parts:live.map(i=>({id:ws[i].id,text:ws[i].text,from:0,to:Array.from(ws[i].text).length}))};block.editorLine=row;
      html+=`<section class="caption-block" data-block="${n}" data-from="${block.indices[0]}" data-to="${block.indices.at(-1)+1}"><div class="caption-head"><label title="같은 STT 단어를 나눠 표시한 구간은 함께 선택됩니다"><input type="checkbox" class="caption-check" data-check-block="${n}" aria-label="${n+1}번 구간 선택" style="width:auto;cursor:pointer"> <strong>${String(n+1).padStart(3,'0')}</strong></label>${live.length?`<button class="caption-delete btn sm ghost icon-only ico i-trash-2" data-delete-block="${n}" title="이 자막 구간 삭제 (영상·음성도 삭제 · Ctrl+Z로 복원)" aria-label="${n+1}번 구간 삭제"></button>`:''}<button class="caption-seek" data-seek="${first.start}">${esc(SS.fmtTime(first.start+(SS.state.source?.offset||0)))} ~ ${esc(SS.fmtTime(last.end+(SS.state.source?.offset||0)))}</button><span class="caption-count">${count(row.text)} / ${max}자${row.manualMerge?' · 수동 병합':count(row.text)>max?' · 적용 시 자동 분할':''}</span>${live.length?`<button class="caption-fine btn sm ghost icon-only ico i-audio-waveform" data-fine="${n}" title="시작·끝 미세 조정 (STT 원문·출력 자막 두 번 누르기)" aria-label="${n+1}번 자막 미세 조정"></button>`:''}</div>`;
      if(row.manualMerge)html+=`<button class="caption-unmerge" data-unmerge="${n}" style="font-size:11px;margin-bottom:5px">${max}자로 다시 나누기</button>`;
      html+='<div class="caption-track"><span class="caption-track-label">STT 원문</span><div class="caption-source">';
      let openRun=null;
      for(const i of block.indices){const w=ws[i],run=runMap.get(i);if(openRun&&(!w.del||openRun.a!==run?.a)){html+='</span>';openRun=null;}
        if(w.del&&SS.state.hideDeleted){if(i===block.indices[0]||!ws[i-1]?.del)html+=`<span class="hide-scissors" data-runstart="${run.a}">삭제 구간 펼치기</span>`;continue;}
        if(w.del&&!openRun){const f=fillRun.get(run.a);html+=`<span class="deleted-run${f?' filler-run':''}" data-runstart="${run.a}"${f?' title="군말(음·어·아)이라 지웠습니다 · 누르면 되살리기"':''}>`+(f?'<span class="run-tag">군말</span>':'');openRun=run;}
        const fill=isFill(w.text);
        const marker=i===SS.state.markI?' title="쇼츠 시작점"':i===SS.state.markO?' title="쇼츠 끝점"':(!w.del&&fill?' title="군말로 보입니다 · 클릭한 뒤 Backspace로 지우기"':'');
        html+=`<span data-wid="${i}"${fill?` class="${w.del?'filler':'filler-live'}"`:''}${marker}>${esc(SS.captionEdit.sourceText(w))}</span> `;
        if(w.del&&(i===block.indices.at(-1)||!ws[i+1]?.del)){html+=`<button class="restore-run" data-runstart="${run.a}">되살리기</button></span>`;openRun=null;}
        const cut=cuts.get('e:'+w.id);
        if(cut&&!w.del){const c2=+cut.keyStart.slice(2),j=SS.idxOfWordId?SS.idxOfWordId(c2):c2,gone=Math.max(0,cut.inStart-cut.outEnd),gap=j===i+1;
          html+=gap?`<span class="cut-marker gap-cut ico xs i-scissors" data-c1="${i}" data-c2="${c2}" title="말 사이 공백 ${sec(gone)}초를 잘라 냈습니다 · 누르면 컷 미세 조정 (T)">공백 ${sec(gone)}초</span>`+(ws[j]?.gapCut?`<button class="gap-restore" data-gap="${j}" title="잘라 낸 공백 되살리기">되살리기</button>`:'')
            :`<span class="cut-marker ico xs i-scissors" data-c1="${i}" data-c2="${c2}" title="여기서 ${sec(gone)}초를 잘라 냈습니다 · 누르면 컷 미세 조정 (T)">${sec(gone)}초</span>`;}
        else if(!w.del&&pauseAt.has(i)){const p=pauseAt.get(i);html+=`<button class="pause-chip ico xs i-pause" data-cutgap="${p.i}" title="말 사이 쉼 ${sec(p.gap)}초 · 누르면 잘라 냅니다">${sec(p.gap)}초</button>`;}
      }
      if(openRun)html+='</span>';
      html+='</div></div><div class="caption-word-editor"></div><div class="caption-track"><span class="caption-track-label out">출력 자막</span>';
      html+=live.length?`<textarea class="caption-output" rows="1" maxlength="2000" data-caption-editor="${n}" data-caption-anchor="${esc(row.parts[0]?String(row.parts[0].id)+':'+row.parts[0].from:'')}" title="Enter: 커서 자리에서 자막 나누기 · 맨 앞 Backspace: 위 자막과 합치기 · 맨 끝 Delete: 아래 자막과 합치기 · Ctrl+Enter: 적용 · 두 번 누르기: 시작·끝 미세 조정" aria-label="${n+1}번 출력 자막" placeholder="빈칸이면 자막만 숨김 · 영상 유지">${esc(row.text)}</textarea>`:'<div class="caption-empty">삭제된 영상 구간 · 되살리면 자막도 복원됩니다</div>';
      html+='</div></section>';
    });
    body.innerHTML=html;body.scrollTop=scroll;
    body.querySelectorAll('.caption-check').forEach(el=>el.onchange=()=>{commit(false);const b=blocks[+el.dataset.checkBlock];b.indices.forEach(i=>{if(!ws[i].del){if(el.checked)checked.add(ws[i].id);else checked.delete(ws[i].id);}});syncChecks(body);});
    body.querySelectorAll('.caption-unmerge').forEach(el=>el.onclick=()=>{commit(false);SS.pushUndo();SS.state.words=SS.captionEdit.unmerge(SS.state.words,blocks[+el.dataset.unmerge].editorLine);needsRender=false;SS.renderTranscript();SS.updateTemplatePreview();});
    body.querySelectorAll('.caption-fine').forEach(btn=>{btn.setAttribute('aria-controls','trimPanel');btn.setAttribute('aria-pressed','false');btn.onclick=()=>{commit(false);SS.toggleFineTuneBlock(btn.closest('.caption-block'));};});
    body.querySelectorAll('.caption-source').forEach(el=>el.addEventListener('mousedown',()=>rememberSource(el.closest('.caption-block'))));
    body.querySelectorAll('.caption-delete').forEach(btn=>btn.onclick=()=>{
      commit(false);const b=blocks[+btn.dataset.deleteBlock];if(!b)return;
      SS.preview.pause();SS.pushUndo();b.indices.forEach(i=>{if(SS.state.words[i]){SS.state.words[i].del=true;checked.delete(SS.state.words[i].id);}});
      if(SS.closeTrim)SS.closeTrim();needsRender=false;SS.state.selection=null;SS.state.caret=b.indices[0];SS.state.manualCaret=true;
      SS.renderTranscript();SS.updateTemplatePreview();SS.pushUndo();body.focus({preventScroll:true});
    });
    body.querySelectorAll('.gap-restore').forEach(btn=>btn.onmousedown=e=>{e.preventDefault();e.stopPropagation();commit(false);SS.restoreGap(+btn.dataset.gap);});
    body.querySelectorAll('.pause-chip').forEach(btn=>btn.onmousedown=e=>{e.preventDefault();e.stopPropagation();commit(false);SS.cutPause(+btn.dataset.cutgap);});
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
        if(e.key==='Delete'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&el.selectionStart===el.value.length&&el.selectionEnd===el.value.length){e.preventDefault();mergeAtEnd(el,body);e.stopPropagation();return;}
        if(e.key==='Backspace'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&el.selectionStart===0&&el.selectionEnd===0){e.preventDefault();mergeAtStart(el,body);e.stopPropagation();return;}if(e.key==='Enter'&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();splitAtCaret(el,body);e.stopPropagation();return;}if(e.key==='Enter'){e.preventDefault();commit();body.focus();}else if(e.key==='Escape'){e.preventDefault();cancel();body.focus();}else if(e.key==='Tab'){e.preventDefault();const index=+el.dataset.captionEditor;commit();body.querySelector(`[data-caption-editor="${index+(e.shiftKey?-1:1)}"]`)?.focus();}e.stopPropagation();});
    });
    refreshCaret(body);syncChecks(body);
  };
})();
