'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),D=require('../src/shared/delivery');
const w=(text,start,end)=>({text,start,end});
test('빈 자막·잘못된 시각은 분석하지 않음',()=>{assert.equal(D.analyze([]),null);assert.equal(D.analyze([w('a',NaN,5),w('b',2,1)]),null);});
test('시각 정렬·전체 길이·공백·군말·반복 후보',()=>{const r=D.analyze([w('기도',5,6),w('기도',6.2,7),w('음',0,1)]);assert.equal(r.duration,7);assert.equal(r.totalChars,5);assert.equal(r.fillers.length,1);assert.equal(r.repeats.length,1);assert.equal(r.pauses.length,1);assert.equal(r.pauses[0].seconds,4);assert.equal(r.cpm,43);});
test('원본 자막의 삭제 표시는 원본 전달 점검에 영향 없음',()=>{assert.equal(D.analyze([{...w('말씀',0,1),del:true}]).totalChars,2);});
test('겹친 자막은 가짜 공백을 만들지 않음',()=>{const r=D.analyze([w('긴말',0,10),w('말',1,2),w('다음',11,12)]);assert.equal(r.pauses.length,0);assert.ok(r.coverage<=1);});
test('분 경계와 마지막 짧은 구간의 속도는 실제 길이 기준',()=>{const r=D.analyze([w('가'.repeat(120),0,120),w('나'.repeat(30),120,150)]);assert.deepEqual(r.bins.map(b=>b.cpm),[60,60,60]);assert.equal(r.cpm,60);});
test('글자 수는 공백·구두점 제외, 아/에 단어는 군말로 단정하지 않음',()=>{const r=D.analyze([w('아! 에, 사랑.',0,6)]);assert.equal(r.totalChars,4);assert.equal(r.fillers.length,0);assert.match(D.toText(r),/실제 무음이 아닐/);assert.equal(D.time(3661),'1:01:01');});
