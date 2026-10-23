(function() {
  'use strict';
  const SS = (window.SS = window.SS || {});
  let busy = false;
  SS.doExport = async function(outPath, range = null) {
    if (busy) return {success:false,error:'이미 내보내기가 진행 중입니다.'};
    busy = true;
    try {
      if (SS.flushCaptionEdit) SS.flushCaptionEdit();
      const st = SS.state;
      if (!st?.source || !st.words?.length) throw Error('내보낼 영상과 자막이 없습니다.');
      if (typeof outPath !== 'string' || !/\.mp4$/i.test(outPath)) throw Error('MP4 파일 경로를 선택해 주세요.');
      const words = range ? st.words.filter(w=>w.start>=range[0]&&w.end<=range[1]) : st.words;
      const segments = SS.edl.buildSegments(words, st.settings, st.overrides, st.source.duration);
      if (!segments.length) throw Error('남은 영상 구간이 없습니다. 지운 단어를 먼저 되살려 주세요.');
      const theme = SS.theme.normalizeTheme(st.activeTheme || st.theme);
      const lines = SS.edl.buildLines(words, segments, st.settings);
      const launch = await window.api.getLaunchInfo();
      const tempDir = (launch.cache || launch.root + '/cache') + '/export_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      await window.api.mkdir(tempDir);
      if (SS.ensureFonts) await SS.ensureFonts(theme);
      await document.fonts.ready;
      let logo = theme.logo.path;
      if (/^assets[\\/]images[\\/](sa-)?crest\.png$/i.test(logo)) logo = '';
      if (SS.loadLogoFromPath) await SS.loadLogoFromPath(logo);
      const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1920;
      const ctx=canvas.getContext('2d');
      const meta=st.meta||{};
      const params={title:meta.title||'',verse:meta.verse||'',speaker:meta.speaker||SS.appSettings?.defaultSpeaker||SS.appSettings?.speakers?.[0]||'',churchName:SS.appSettings?.template?.churchName||SS.appSettings?.churchName||'',subtitleText:'',theme};
      const image = async (name,layers,extra={}) => {
        ctx.clearRect(0,0,1080,1920);
        if (layers.length) SS.drawTemplate(ctx,layers,{...params,...extra});
        await window.api.writeImage({dataUrl:canvas.toDataURL('image/png'),filename:tempDir+'/'+name});
      };
      await image('top.png',['top']);
      await image('footer.png',['footer']);
      await image('empty.png',[]);
      for(let i=0;i<lines.length;i++) await image(`line_${i}.png`,['subtitle'],{subtitleText:lines[i].text});
      const result=await window.api.startExport({sourcePath:st.source.path,outPath,segments,lines,crop:st.crop||{scale:1,x:.5,y:.5},fadeMs:st.settings.fadeMs??10,tempDir,theme});
      if (!result.success) return result;
      const srtPath=outPath.replace(/\.mp4$/i,'')+'.srt';
      await window.api.writeText(srtPath,SS.edl.toSRT(lines));
      return {...result,outPath,srtPath,duration:SS.edl.segmentsDuration(segments)};
    } catch(e) { console.error('Export failed',e);return {success:false,error:e.message}; }
    finally { busy=false; if (SS.refreshExportUI) SS.refreshExportUI(); }
  };
  SS.initExporter = function() {
    const btn=document.getElementById('btnExport');
    const refresh=()=>{if(!busy){btn.disabled=!(SS.state?.source&&SS.state.words?.some(w=>!w.del));btn.textContent='내보내기';}};
    SS.refreshExportUI=refresh;
    for(const event of ['ss:transcript-ready','ss:source-loaded','ss:video-opened','ss:words-changed'])window.addEventListener(event,()=>setTimeout(refresh,0));
    window.api.onProgress(p=>{if(p?.task==='export'&&busy&&Number.isFinite(p.pct))btn.textContent='내보내는 중... '+Math.round(p.pct)+'%';});
    btn.addEventListener('click',async()=>{
      if(busy||!SS.state?.source)return;
      const p=await window.api.saveExportDialog({defaultPath:(SS.state.meta?.title||'쇼츠')+'.mp4'});
      if(!p)return;
      btn.disabled=true;btn.textContent='내보내는 중...';
      const result=await SS.doExport(p);
      SS.toast(result.success?'MP4와 SRT를 저장했습니다':'내보내기 실패: '+result.error,result.success?3000:7000);
      refresh();
    });
  };
})();
