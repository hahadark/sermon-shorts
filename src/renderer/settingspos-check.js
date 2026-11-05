/* SS_TEST_SCRIPT=settingspos : 설정 창 탭을 바꿔도 창 위치·크기가 그대로인지, 도움말 → 업데이트 확인 */
(function(){window.addEventListener('ss:run-test-script',async e=>{if(e.detail!=='settingspos')return;const SS=window.SS,A=window.api;let dir='';const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{const l=await A.getLaunchInfo();dir=l.cache+'/settingspos';await A.mkdir(dir);
 document.querySelector('.menu-item[data-cmd="settings"]').click();for(let i=0;i<30&&!document.querySelector('.settings-overlay .settings-dialog');i++)await sleep(100);
 const dlg=document.querySelector('.settings-overlay .settings-dialog');const rows=[];
 for(const t of document.querySelectorAll('.settings-overlay .settings-tab')){t.click();await sleep(250);const r=dlg.getBoundingClientRect();rows.push({tab:t.textContent.trim(),top:Math.round(r.top),left:Math.round(r.left),w:Math.round(r.width),h:Math.round(r.height)});}
 await SS.testShot(dir+'/1_settings.png');
 const same=rows.every(r=>r.top===rows[0].top&&r.h===rows[0].h&&r.left===rows[0].left&&r.w===rows[0].w);
 document.querySelector('.settings-overlay .settings-tab').click();await sleep(100);
 const close=document.querySelector('.settings-overlay .modal-close, .settings-overlay [data-close], .settings-overlay #btnSettingsCancel')||[...document.querySelectorAll('.settings-overlay button')].find(b=>/^(닫기|취소)$/.test(b.textContent.trim()));if(close)close.click();await sleep(200);
 const item=document.querySelector('.menu-item[data-cmd="update-check"]');item.click();await sleep(1500);const toast=(document.getElementById('toast')||{}).textContent||'';
 const r={success:same&&!!item&&/버전|확인/.test(toast),same,rows,menu:!!item,toast};await A.writeText(dir+'/report.json',JSON.stringify(r,null,2));if(r.success)A.notifyTestReady({success:true});else A.notifyTestError('설정 창 위치 또는 업데이트 메뉴 실패');
}catch(err){if(dir)await A.writeText(dir+'/report.json',JSON.stringify({success:false,error:err.stack},null,2));A.notifyTestError(err.stack);}});})();
