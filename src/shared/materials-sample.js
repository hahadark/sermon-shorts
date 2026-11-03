/* 직접 작성한 체험용 예시. 실제 교회·설교·설교자 자료나 성경 본문을 포함하지 않는다. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.SS=root.SS||{};root.SS.materialsSample=api;}})(typeof window!=='undefined'?window:null,function(){'use strict';
  const SERMON='이 글은 프로그램 체험을 위해 작성한 예시이며 실제 설교가 아닙니다. 본문은 에베소서 2:8-10입니다. 오늘의 주제는 은혜에 응답하는 삶입니다. 먼저 하나님의 은혜는 우리가 이룬 성과가 아니라 하나님께서 주시는 선물입니다. 우리는 잘해서 사랑받는 것이 아니라 먼저 사랑받았기에 감사로 응답합니다. 다음으로 감사는 하나님과의 관계에서 자랍니다. 분주한 하루에도 잠시 멈추어 받은 은혜를 기억하고 하나님께 감사할 수 있습니다. 마지막으로 사랑의 행동은 은혜를 얻기 위한 조건이 아니라 은혜에 응답하는 열매입니다. 이번 주에는 이웃 한 사람의 이야기를 들어 주거나 작은 도움을 건네 보세요. 이웃을 도운 횟수로 믿음을 평가하지 않습니다. 먼저 우리를 사랑하신 하나님을 기억하며 사랑으로 걸어갑시다.';
  function state(M){const meta={church:'샘플 교회',title:'은혜에 응답하는 삶 (체험용)',verse:'에베소서 2:8-10',speaker:'',date:''};
    const points=[{heading:'선물로 주신 은혜',body:'하나님의 은혜는 우리가 이룬 성과가 아니라 하나님께서 주시는 선물입니다.'},{heading:'감사로 하나님께 응답',body:'먼저 사랑받았기에 은혜를 기억하며 하나님께 감사합니다.'},{heading:'사랑은 은혜의 열매',body:'이웃을 돌보는 행동은 은혜를 얻는 조건이 아니라 은혜에 응답하는 열매입니다.'}];
    const data={
      summary:{title:meta.title,verse:meta.verse,theme:'먼저 주신 은혜를 기억하며 감사와 사랑으로 응답합니다.',points,application:'하루에 한 번 받은 은혜를 기억하며 하나님께 감사하세요. 이웃 한 사람의 이야기를 듣거나 작은 도움을 건네 보세요.',prayer:'하나님, 먼저 주신 사랑을 기억하며 감사와 사랑으로 응답하게 하소서.'},
      smallgroup:{title:'은혜를 기억하는 나눔',verse:meta.verse,summary:'하나님은 먼저 은혜를 주십니다. 감사는 하나님과의 관계에서 자라고, 이웃 사랑은 은혜에 응답하는 열매입니다.',icebreaker:'이번 주 고마웠던 순간을 나누어 보세요.',questions:[{q:'선물로 받은 은혜라는 말은 어떤 마음을 주나요?',note:'설교의 첫 대지를 다시 봅니다.'},{q:'받은 은혜를 기억하는 데 무엇이 도움이 될까요?',note:'서로의 경험을 듣습니다.'},{q:'이번 주 어떤 작은 사랑을 실천할 수 있을까요?',note:'은혜를 얻는 조건으로 말하지 않습니다.'}],action:'이웃 한 사람의 이야기를 들어 줍니다.',prayer:'하나님, 은혜를 기억하고 이웃을 사랑하게 하소서.'},
      qt:{title:'은혜에 응답하는 3일',days:points.map((p,i)=>({day:i+1,title:p.heading,passage:meta.verse,meditation:p.body,keyline:i===0?'은혜는 선물입니다.':i===1?'먼저 사랑받았기에 감사합니다.':'사랑은 은혜의 열매입니다.',question:['받은 은혜가 무엇인지 돌아보세요.','오늘 하나님께 감사드릴 일은 무엇인가요?','이웃에게 어떤 작은 사랑을 전할 수 있을까요?'][i],action:['받은 은혜 한 가지를 기록합니다.','잠시 멈추어 감사 기도를 드립니다.','이웃의 이야기를 들어 줍니다.'][i],prayer:'하나님, 주신 은혜에 감사로 응답하게 하소서.'}))},
      quiz:{title:'은혜를 되새기는 퀴즈',items:[{type:'ox',q:'예시 설교는 은혜를 우리가 이룬 성과라고 말합니다.',answer:'X',explain:'은혜는 하나님께서 주시는 선물입니다.'},{type:'mc',q:'사랑의 행동은 무엇인가요?',choices:['은혜를 얻는 조건','믿음을 평가하는 점수','은혜에 응답하는 열매','남과 경쟁하는 방법'],answer:3,explain:'먼저 주신 은혜에 응답하는 열매입니다.'}]},
      family:{title:'함께 기억하는 은혜',verse:meta.verse,opening:'가족이 아는 감사 찬양 한 곡을 함께 부릅니다.',story:points.map(p=>p.body).join(' '),questions:['우리 가족이 받은 은혜는 무엇인가요?','이번 주 누구의 이야기를 들어 줄까요?'],activity:'가족이 한 사람씩 고마웠던 일을 말합니다.',prayer:'하나님, 우리 가족이 주신 사랑을 기억하게 하소서.',blessing:'하나님의 은혜를 기억하며 서로 사랑해요.'},
      cards:{cards:points.map(p=>({headline:p.heading,body:p.body,source:meta.verse})),caption:'먼저 주신 은혜에 감사와 사랑으로 응답합니다. 체험용 예시입니다.',hashtags:['#은혜','#감사','#이웃사랑']},
      cardnews:{title:'은혜에 응답하는 삶',subtitle:'감사에서 이웃 사랑으로',verse:meta.verse,slides:points.map(p=>({heading:p.heading,body:p.body,highlight:p.body.slice(0,12)})),action:'이웃 한 사람의 이야기를 들어 주세요.',closing:'사랑은 은혜에 응답하는 열매입니다.',caption:'하나님께 받은 은혜를 기억하며 감사와 사랑으로 응답합니다. 체험용 예시입니다.',hashtags:['#은혜','#감사','#이웃사랑']},
      leader:{title:'은혜를 기억하는 모임',verse:meta.verse,goal:'은혜를 기억하고 하나님께 감사하며 이웃 사랑으로 응답합니다.',prepare:'예시 원고와 에베소서 2:8-10을 읽습니다.',flow:[{part:'마음 열기',minutes:5,guide:'고마웠던 순간을 나눕니다.'},{part:'말씀 되새기기',minutes:10,guide:'은혜는 선물이라는 첫 대지를 살펴봅니다.'},{part:'나눔',minutes:10,guide:'받은 은혜와 응답을 이야기합니다.'},{part:'기도',minutes:5,guide:'감사와 이웃 사랑을 위해 기도합니다.'}],questions:[{q:'은혜를 조건으로 생각한 적이 있나요?',intent:'선물인 은혜를 되새기기',expected:'첫 대지: 은혜는 성과가 아니라 선물',followup:'먼저 사랑받았다는 것이 어떤 마음을 주나요?'}],tips:['말이 없는 분에게 답을 강요하지 않습니다.','실천 횟수로 믿음을 평가하지 않습니다.'],prayer:'하나님, 받은 은혜를 함께 기억하게 하소서.'},
      slides:{title:'은혜에 응답하는 삶',verse:meta.verse,slides:points.map(p=>({heading:p.heading,lines:[p.body],ref:meta.verse})),closing:'받은 은혜를 기억하며 사랑으로 응답합시다.'},
    };
    const options=M.normOptions({qtDays:3,leaderTime:30}),results={};for(const type of Object.keys(data))results[type]={data:M.normalize(type,data[type]),made:Date.now(),meta:{...meta},options:{...options},sample:true};
    return {source:'manual',sermon:SERMON,meta,options,selected:Object.keys(results),results,design:'navy',verify:true,demoMode:true};
  }
  function enter(current,M){if(current?.demoMode)return current;return {...state(M),demoBackup:JSON.parse(JSON.stringify(current||{}))};}
  function leave(current){return current?.demoMode?JSON.parse(JSON.stringify(current.demoBackup||{})):current;}
  return {SERMON,state,enter,leave};
});
