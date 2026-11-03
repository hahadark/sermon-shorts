/* 자막 시각으로 보는 전달 점검. 실제 음성 판정이나 신학 평가는 하지 않는다. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.SS=root.SS||{};root.SS.delivery=api;}})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const num=n=>typeof n==='number'&&Number.isFinite(n);
  const plain=s=>String(s||'').replace(/[^가-힣a-zA-Z0-9]/g,'');
  const chars=s=>(String(s||'').match(/[가-힣a-zA-Z0-9]/g)||[]).length;
  function analyze(input){
    const words=(Array.isArray(input)?input:[]).filter(w=>w&&num(w.start)&&num(w.end)&&w.start>=0&&w.end>w.start&&String(w.text||'').trim()).map(w=>({text:String(w.text),start:w.start,end:w.end})).sort((a,b)=>a.start-b.start||a.end-b.end);
    if(!words.length)return null;
    const start=words[0].start,end=Math.max(...words.map(w=>w.end)),duration=end-start;
    const totalChars=words.reduce((n,w)=>n+chars(w.text),0),bins=[],pauses=[],fillers=[],repeats=[];
    for(let t=start;t<end;t+=60)bins.push({start:t,end:Math.min(t+60,end),chars:0,cpm:0});
    let coveredEnd=words[0].end,covered=words[0].end-start;
    words.forEach((w,i)=>{
      // 한 자막이 구간 경계를 넘으면 시간 비율로 나눈다. 잘린 마지막 1분도 실제 길이로 계산.
      const n=chars(w.text);
      for(let b=Math.floor((w.start-start)/60);b<bins.length&&bins[b].start<w.end;b++){
        const bin=bins[b],over=Math.max(0,Math.min(bin.end,w.end)-Math.max(bin.start,w.start));bin.chars+=n*over/(w.end-w.start);
      }
      const c=plain(w.text);
      if(/^(음+|으음+|어+|엄+|흠+|어음)$/.test(c)||(/^(그|이|저|뭐)$/.test(c)&&/(…|\.\.\.|~)$/.test(w.text.trim())))fillers.push({start:w.start,end:w.end,text:w.text});
      if(i){const p=words[i-1];if(c.length>=2&&c===plain(p.text)&&w.start-p.end>=-0.1&&w.start-p.end<=1.2)repeats.push({start:p.start,end:w.end,text:p.text+' '+w.text});
        if(w.start-coveredEnd>=2)pauses.push({start:coveredEnd,end:w.start,seconds:w.start-coveredEnd,text:p.text+' → '+w.text});
        covered+=Math.max(0,w.end-Math.max(w.start,coveredEnd));coveredEnd=Math.max(coveredEnd,w.end);
      }
    });
    bins.forEach(b=>{b.chars=Math.round(b.chars*10)/10;b.cpm=Math.round(b.chars/((b.end-b.start)/60));});
    return {start,end,duration,totalChars,cpm:Math.round(totalChars/(duration/60)),wordCount:words.length,coverage:Math.min(1,covered/duration),bins,pauses,fillers,repeats};
  }
  function time(n){n=Math.max(0,Math.floor(n||0));return (n>=3600?Math.floor(n/3600)+':':'')+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
  function toText(r,label){if(!r)return '시간 정보가 있는 자막이 없습니다.';return ['설교 전달 점검',label||'', '분석 범위: '+time(r.start)+' ~ '+time(r.end),'평균: 분당 '+r.cpm+'자 (한글 음절·영문 글자·숫자, 공백 제외)','2초 이상 자막 사이 공백: '+r.pauses.length+'곳','군더더기 말 후보: '+r.fillers.length+'곳','연속 반복 후보: '+r.repeats.length+'곳','', '자동 자막 기준 참고 자료입니다. 공백은 실제 무음이 아닐 수 있고, 반복과 쉼은 강조·기도·회중 응답일 수 있습니다. 자막 누락·시각 오차가 결과에 영향을 줍니다.', ...r.bins.map(b=>time(b.start)+' ~ '+time(b.end)+': 분당 '+b.cpm+'자'),'',...r.pauses.map(p=>time(p.start)+' 공백 '+p.seconds.toFixed(1)+'초 · '+p.text),...r.fillers.map(p=>time(p.start)+' 군말 후보 · '+p.text),...r.repeats.map(p=>time(p.start)+' 반복 후보 · '+p.text)].join('\n');}
  return {analyze,time,toText};
});
