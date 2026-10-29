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
      // 추가 층: 그라데이션 배경, 영상 밑(색 덮기·그림자), 둥근 모서리 마스크
      const extra=SS.theme.exportLayers(theme);
      if (extra.bgImage) await image('bg.png',['background']);
      if (extra.under) await image('under.png',['under']);
      if (extra.mask) {
        const v=theme.video, m=document.createElement('canvas');m.width=v.width;m.height=v.height;
        SS.drawVideoMask(m.getContext('2d'),v);
        await window.api.writeImage({dataUrl:m.toDataURL('image/png'),filename:tempDir+'/mask.png'});
      }
      await image('top.png',['top']);
      await image('footer.png',['footer']);
      await image('empty.png',[]);
      // 단어 강조(가라오케): 줄마다 단어가 바뀔 때마다 그림을 따로 만든다
      const karaoke=SS.usesKaraoke&&SS.usesKaraoke(theme);
      for(let i=0;i<lines.length;i++){
        const k=karaoke?SS.karaokeOf(lines[i],words,segments):null;
        if(k&&k.frames.length){
          lines[i].images=[];
          for(let j=0;j<k.frames.length;j++){
            const f=k.frames[j],name=`line_${i}_${j}.png`;
            await image(name,['subtitle'],{subtitleText:lines[i].text,subtitleGroups:k.groups,karaokeIndex:f.index});
            lines[i].images.push({name,start:f.start,end:f.end});
          }
        } else await image(`line_${i}.png`,['subtitle'],{subtitleText:lines[i].text});
      }
      const result=await window.api.startExport({sourcePath:st.source.path,outPath,segments,lines,crop:st.crop||{scale:1,x:.5,y:.5},fadeMs:st.settings.fadeMs??10,tempDir,theme,bgm:st.bgm?{...st.bgm}:null});
      if (!result.success) return result;
      const srtPath=outPath.replace(/\.mp4$/i,'')+'.srt';
      await window.api.writeText(srtPath,SS.edl.toSRT(lines));
      return {...result,outPath,srtPath,duration:SS.edl.segmentsDuration(segments)};
    } catch(e) { console.error('Export failed',e);return {success:false,error:String(e&&e.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'')}; }
    finally { busy=false; if (SS.refreshExportUI) SS.refreshExportUI(); }
  };
  // 내보낸 뒤 유튜브 업로드: 로그인되어 있으면 [영상 만들면 바로 올리기]일 때 바로, 아니면 물어보고 올린다
  let uploading=false,refresh=()=>{};
  const cleanIpc=e=>String(e&&e.message||e).replace(/^Error invoking remote method '[^']+': (Error: )?/,'');
  SS.afterExportUpload = async function(outPath) {
    let st; try { st=await window.api.ytupStatus(); } catch(_) { return; }
    if(!st.loggedIn||uploading)return;
    const names={unlisted:'일부공개',private:'비공개',public:'공개'};
    if(!st.autoUpload&&!confirm('유튜브('+(st.channel||'내 채널')+')에 '+(names[st.privacy]||'')+'로 올릴까요?'))return;
    const btn=document.getElementById('btnExport');
    uploading=true;btn.disabled=true;btn.textContent='유튜브 업로드 준비 중...';
    const off=window.api.onProgress(p=>{if(p?.task==='ytupload'&&Number.isFinite(p.pct))btn.textContent='유튜브 업로드 '+p.pct+'%';});
    const meta=SS.state?.meta||{};
    try {
      const r=await window.api.ytupUpload(outPath,{title:meta.title||'',verse:meta.verse||'',speaker:meta.speaker||SS.appSettings?.defaultSpeaker||'',church:SS.appSettings?.template?.churchName||'',credits:SS.state?.bgm&&SS.bgmCredit?SS.bgmCredit():''});
      const forced=r.privacy&&r.privacy!==st.privacy?" (유튜브가 '"+(names[r.privacy]||r.privacy)+"'로 바꿨습니다)":'';
      SS.toast('유튜브에 올렸습니다: '+r.url+forced,9000);
      if(confirm('유튜브에 올렸습니다'+forced+'.\n유튜브 스튜디오에서 확인할까요?'))window.api.ytupOpenUrl(r.studio);
    } catch(e) {
      SS.toast('유튜브 업로드 실패: '+cleanIpc(e),9000);
    } finally { off(); uploading=false; refresh(); }
  };
  SS.initExporter = function() {
    const btn=document.getElementById('btnExport');
    refresh=()=>{if(!busy&&!uploading){btn.disabled=!(SS.state?.source&&SS.state.words?.some(w=>!w.del));btn.textContent='내보내기';}};
    SS.refreshExportUI=refresh;
    for(const event of ['ss:transcript-ready','ss:source-loaded','ss:video-opened','ss:words-changed'])window.addEventListener(event,()=>setTimeout(refresh,0));
    window.api.onProgress(p=>{if(p?.task==='export'&&busy&&Number.isFinite(p.pct))btn.textContent='내보내는 중... '+Math.round(p.pct)+'%';});
    btn.addEventListener('click',async()=>{
      if(busy||!SS.state?.source)return;
      // 파일 이름에 쓸 수 없는 글자(줄바꿈 / , 강조 * 등)는 뺀다
      const base=String(SS.state.meta?.title||'').replace(/\s+\/\s+/g,' ').replace(/[\\/:*?"<>|]/g,'').replace(/\s+/g,' ').trim()||'쇼츠';
      const p=await window.api.saveExportDialog({defaultPath:base+'.mp4'});
      if(!p)return;
      btn.disabled=true;btn.textContent='내보내는 중...';
      const result=await SS.doExport(p);
      SS.toast(result.success?'MP4와 SRT를 저장했습니다':'내보내기 실패: '+result.error,result.success?3000:7000);
      refresh();
      if(result.success&&SS.showExportPlayer)SS.showExportPlayer(result.outPath,{duration:result.duration,srtPath:result.srtPath});
      if(result.success&&SS.afterExportUpload)SS.afterExportUpload(result.outPath);
    });
  };
})();
