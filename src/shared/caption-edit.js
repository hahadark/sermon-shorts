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
  return {capture,sourceText,apply,merge,unmerge};
});
