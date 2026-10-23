const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { buildExportArgs } = require('../src/main/render.js');

test('buildExportArgs correctly constructs filtergraph and args', () => {
  const segments = [{ start: 10, end: 15 }];
  const lines = [
    { outStart: 0, outEnd: 2.5 }
  ];
  const crop = { scale: 1.5, x: 0.6, y: 0.4 };
  const fadeMs = 10;

  // mock fs.writeFileSync
  const originalWrite = fs.writeFileSync;
  let writtenData = '';
  fs.writeFileSync = (path, data) => { writtenData = data; };

  const { args, filtergraph } = buildExportArgs({
    sourcePath: 'in.mp4',
    outPath: 'out.mp4',
    segments,
    lines,
    crop,
    fadeMs,
    tempDir: 'cache/tmp'
  });

  fs.writeFileSync = originalWrite;

  assert.ok(args.includes('-ss'));
  assert.ok(args.includes('9.000'));
  assert.ok(args.includes('16.000'));
  assert.ok(filtergraph.includes('crop='));
  assert.ok(filtergraph.includes('trim=start=1.000:end=6.000'));
  assert.ok(writtenData.includes('file \'line_0.png\''));
});

test('export preserves custom geometry, zero crop position, background and zero fade', () => {
  const originalWrite=fs.writeFileSync;fs.writeFileSync=()=>{};
  try {
    const {filtergraph}=buildExportArgs({sourcePath:'in.mp4',outPath:'out.mp4',segments:[{start:1,end:3}],lines:[],crop:{scale:1,x:0,y:0},fadeMs:0,tempDir:'cache/tmp',theme:{canvas:{background:'#142838'},video:{x:90,y:430,width:900,height:800},fadeInSec:0}});
    assert.ok(filtergraph.includes('scale=900:800'));
    assert.ok(filtergraph.includes('overlay=x=90:y=430'));
    assert.ok(filtergraph.includes('c=0x142838'));
    assert.ok(filtergraph.includes('in_w*0-'));
    assert.ok(filtergraph.includes('in_h*0-'));
    assert.ok(!filtergraph.includes('fade=t=in:st=0:d='));
  } finally {fs.writeFileSync=originalWrite;}
});
test('export rejects empty and invalid segments with useful errors',()=>{
  assert.throws(()=>buildExportArgs({segments:[]}),/남은 영상/);
  assert.throws(()=>buildExportArgs({segments:[{start:3,end:1}]}),/시각/);
});
