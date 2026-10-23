(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root){root.SS=root.SS||{};root.SS.cropGeometry=api;}})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function placement(sourceW,sourceH,box,crop={}){
    if(!(sourceW>0&&sourceH>0&&box.width>0&&box.height>0))return null;
    const zoom=Math.max(1,Number.isFinite(crop.scale)?crop.scale:1);
    const scale=(box.fit==='contain'?Math.min(box.width/sourceW,box.height/sourceH):Math.max(box.width/sourceW,box.height/sourceH))*zoom;
    const width=sourceW*scale,height=sourceH*scale;
    const x=Number.isFinite(crop.x)?Math.max(0,Math.min(1,crop.x)):.5;
    const y=Number.isFinite(crop.y)?Math.max(0,Math.min(1,crop.y)):.5;
    const axis=(size,full,center)=>full<=size?(size-full)/2:Math.max(size-full,Math.min(0,size/2-full*center));
    return {width,height,left:axis(box.width,width,x),top:axis(box.height,height,y),scale};
  }
  return {placement};
});
