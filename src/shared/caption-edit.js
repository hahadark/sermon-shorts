/* Output-caption edits are anchored to recognition words. Audio timing and sttText never change. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.SS=root.SS||{};root.SS.captionEdit=api;}})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const sourceText=w=>typeof w.sttText==='string'?w.sttText:(typeof w._oldText==='string'?w._oldText:String(w.text||''));
  function capture(words){for(const w of words)if(typeof w.sttText!=='string')w.sttText=sourceText(w);return words;}
  function apply(words,line,text){
    const parts=line.parts||line.words.map(id=>{const w=words.find(x=>x.id===id);return {id,text:w.text,from:0,to:Array.from(w.text).length};});
    if(!parts.length)return words.map(w=>({...w,sttText:sourceText(w)}));
    const old=[];parts.forEach((p,owner)=>String(p.text||'').trim().split(/\s+/).filter(Boolean).forEach(token=>old.push({token,owner})));
    const fresh=String(text).trim().split(/\s+/).filter(Boolean);
    const dp=Array.from({length:old.length+1},()=>Array(fresh.length+1).fill(0));
    for(let i=0;i<=old.length;i++)dp[i][0]=i;for(let j=0;j<=fresh.length;j++)dp[0][j]=j;
    for(let i=1;i<=old.length;i++)for(let j=1;j<=fresh.length;j++)dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(old[i-1].token===fresh[j-1]?0:1));
    const operations=[];let i=old.length,j=fresh.length;
    while(i||j){
      if(i&&j&&dp[i][j]===dp[i-1][j-1]+(old[i-1].token===fresh[j-1]?0:1)){operations.push({owner:old[i-1].owner,token:fresh[j-1]});i--;j--;}
      else if(i&&dp[i][j]===dp[i-1][j]+1)i--;
      else{operations.push({owner:i?old[i-1].owner:(old[0]?.owner||0),token:fresh[j-1]});j--;}
    }
    const output=parts.map(()=>[]);operations.reverse().forEach(op=>output[op.owner].push(op.token));
    const replacements=new Map();parts.forEach((p,n)=>{if(!replacements.has(p.id))replacements.set(p.id,[]);replacements.get(p.id).push({...p,value:output[n].join(' ')});});
    return words.map(w=>{
      const next={...w,sttText:sourceText(w)};const edits=replacements.get(w.id);if(!edits)return next;
      let chars=Array.from(String(w.text||''));for(const e of edits.sort((a,b)=>b.from-a.from))chars.splice(e.from,e.to-e.from,...Array.from(e.value));
      next.text=chars.join('');if(next.text!==w.text)next._oldText=w._oldText||next.sttText;
      return next;
    });
  }
  function merge(words, previous, current) {
    if (!previous?.parts?.length || !current?.parts?.length) return null;
    const first=previous.parts[0], last=current.parts.at(-1), tail=previous.parts.at(-1), head=current.parts[0];
    const endWord=words.find(w=>w.id===last.id);if(!endWord)return null;
    const join=tail.id===head.id&&tail.to===head.from?'':' ';
    const record={startId:first.id,startOffset:first.from,endId:last.id,endOffset:last.to===Array.from(endWord.text).length?null:last.to};
    const result=words.map(w=>({...w,sttText:sourceText(w)}));const owner=result.find(w=>w.id===last.id);
    owner.captionMerges=[...(owner.captionMerges||[]),record];
    return {words:result,text:previous.text+join+current.text,caret:previous.text.length+join.length,anchor:first};
  }
  function unmerge(words,line){const ids=new Set(line.words);return words.map(w=>{const next={...w};if(ids.has(w.id))delete next.captionMerges;return next;});}
  /**
   * 출력 자막 한 줄을 글자 위치 caret 에서 둘로 나눈다 (출력 자막 칸에서 Enter).
   *  - 단어 사이: 앞 단어에 br(줄 바꿈)
   *  - 단어 가운데(띄어 쓰지 않고 붙은 말, 고친 단어 안의 띄어쓰기): 그 단어의 captionSplits 에 글자 위치
   *  - 손으로 합친 줄이면 합친 기록(captionMerges)도 나눈 자리에서 둘로 나눈다
   * 영상 컷·단어 시각·원문은 바뀜지 않는다.
   * @returns { words, anchor: { id, from } (뒤 줄의 첫 조각) } 또는 null (맨 앞·맨 끝 등 나눌 수 없는 자리)
   */
  function split(words,line,caret){
    if(!line||!Array.isArray(line.parts)||!line.parts.length)return null;
    const text=String(line.text||'');
    caret=Math.max(0,Math.min(text.length,Math.round(Number(caret)||0)));
    if(!text.slice(0,caret).trim()||!text.slice(caret).trim())return null;
    // 줄 글에서 각 조각의 자리 (조각 사이는 띄어쓰기 하나 또는 붙어 있음)
    const spans=[];let pos=0;
    for(const p of line.parts){const t=String(p.text||'').trim();if(!t){spans.push(null);continue;}const at=text.indexOf(t,pos);if(at<0)return null;spans.push({start:at,end:at+t.length});pos=at+t.length;}
    let left=-1,right=-1,mid=-1;
    for(let n=0;n<line.parts.length;n++){const s=spans[n];if(!s)continue;if(caret<=s.start){right=n;break;}if(caret<s.end){mid=n;break;}left=n;}
    const result=words.map(w=>({...w,sttText:sourceText(w)}));
    const byId=new Map(result.map(w=>[w.id,w]));
    const addSplit=(id,offset)=>{const w=byId.get(id);if(!w)return false;const len=Array.from(String(w.text||'')).length;if(!(offset>0&&offset<len))return false;w.captionSplits=Array.from(new Set([...(Array.isArray(w.captionSplits)?w.captionSplits:[]),offset])).sort((a,b)=>a-b);return true;};
    let leftEnd,rightStart;
    if(mid>=0){
      const p=line.parts[mid],s=spans[mid],w=byId.get(p.id);if(!w)return null;
      // 조각 글자 안의 위치 → 단어 글자 위치 (조각 앞 띄어쓰기는 건너뜀, 나눈 자리 뒤 띄어쓰기도 건너뜀)
      const chars=Array.from(String(w.text||''));let offset=p.from;while(offset<p.to&&/\s/.test(chars[offset]))offset++;
      offset+=Array.from(text.slice(s.start,caret)).length;
      while(offset<p.to&&/\s/.test(chars[offset]))offset++;
      if(offset>=p.to)return null;
      if(!addSplit(p.id,offset))return null;
      leftEnd={id:p.id,offset};rightStart={id:p.id,offset};
    }else{
      if(left<0||right<0)return null;
      const L=line.parts[left],R=line.parts[right];
      if(L.id===R.id){if(!addSplit(L.id,R.from))return null;leftEnd={id:L.id,offset:R.from};rightStart={id:R.id,offset:R.from};}
      else{const w=byId.get(L.id);if(!w)return null;w.br=true;const len=Array.from(String(w.text||'')).length;leftEnd={id:L.id,offset:L.to>=len?null:L.to};rightStart={id:R.id,offset:R.from};}
    }
    // 손으로 합친 기록이 나눈 자리를 덮으면 앞·뒤 두 기록으로 나눈다
    const index=new Map(result.map((w,i)=>[w.id,i]));
    const at=(id,offset,end)=>{const i=index.get(id);if(i===undefined)return NaN;const len=Array.from(String(result[i].text||'')).length;return i*1e6+(offset==null?(end?len:0):offset);};
    const cut=at(rightStart.id,rightStart.offset,false);
    const additions=[];
    for(const w of result){
      if(!Array.isArray(w.captionMerges)||!w.captionMerges.length)continue;
      const keep=[];
      for(const m of w.captionMerges){
        const a=at(m.startId,m.startOffset,false),b=at(m.endId,m.endOffset,true);
        if(a<cut&&cut<=b){additions.push({owner:leftEnd.id,record:{startId:m.startId,startOffset:m.startOffset,endId:leftEnd.id,endOffset:leftEnd.offset}});keep.push({startId:rightStart.id,startOffset:rightStart.offset,endId:m.endId,endOffset:m.endOffset});}
        else keep.push(m);
      }
      w.captionMerges=keep;
    }
    for(const x of additions){const o=byId.get(x.owner);if(o)o.captionMerges=[...(o.captionMerges||[]),x.record];}
    return {words:result,anchor:{id:rightStart.id,from:rightStart.offset}};
  }
  return {capture,sourceText,apply,merge,unmerge,split};
});
