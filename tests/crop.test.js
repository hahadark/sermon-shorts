const test=require('node:test');const assert=require('node:assert/strict');const {placement}=require('../src/shared/crop');
const box={width:900,height:800,fit:'cover'};
test('crop edge zero stays at source left instead of falling back to center',()=>{const p=placement(1920,1080,box,{x:0,y:.5,scale:1});assert.equal(p.left,0);assert.equal(p.top,0);assert.equal(p.height,800);});
test('preview cover crop has same center and visible source dimensions as FFmpeg',()=>{const p=placement(1920,1080,box,{x:.5,y:.5,scale:1});const cropW=1080*(900/800);assert.ok(Math.abs(-p.left/p.scale-(1920-cropW)/2)<1e-6);assert.ok(Math.abs(box.width/p.scale-cropW)<1e-6);});
test('right edge and zoom never expose empty space in cover mode',()=>{const p=placement(1920,1080,box,{x:1,y:1,scale:2});assert.ok(Math.abs(p.left+p.width-box.width)<1e-6);assert.ok(Math.abs(p.top+p.height-box.height)<1e-6);});
test('crop waits for valid source dimensions',()=>assert.equal(placement(0,0,box),null));
