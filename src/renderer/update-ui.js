/* 앱 자동 업데이트 알림 줄 (위쪽 도구 막대 오른쪽) */
(function () {
  'use strict';
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  if (!api || !api.onUpdateStatus) return;

  const bar = $('updateBar'), msg = $('updateMsg'), action = $('updateAction');
  let closedFor = '';   // 닫기를 누른 상태(버전)는 다시 띄우지 않는다
  let onAction = null;

  function show(text, label, fn) {
    msg.textContent = text;
    action.textContent = label || '';
    action.classList.toggle('hidden', !label);
    onAction = fn || null;
    bar.classList.remove('hidden');
  }

  function render(s) {
    if (!s) return;
    const key = s.state + ':' + (s.version || '');
    if (key === closedFor) return;
    if (s.state === 'downloading') {
      show(`새 버전 ${s.version} 받는 중… ${s.percent || 0}%`);
    } else if (s.state === 'ready') {
      show(`새 버전 ${s.version} 준비됨 · 닫을 때 설치됩니다`, '지금 다시 시작', () => {
        if (!confirm('저장하지 않은 편집은 사라집니다. 지금 다시 시작해 새 버전을 설치할까요?')) return;
        api.updateInstall();
      });
    } else if (s.state === 'portable') {
      show(`새 버전 ${s.version} 이 나왔습니다`, '내려받기 페이지', () => api.updateOpenPage());
    } else {
      bar.classList.add('hidden');
    }
  }

  action.addEventListener('click', () => { if (onAction) onAction(); });
  $('updateClose').addEventListener('click', () => {
    bar.classList.add('hidden');
    closedFor = msg.dataset.key || '';
  });

  api.onUpdateStatus((s) => { msg.dataset.key = s.state + ':' + (s.version || ''); render(s); });
  api.updateGet().then((s) => { if (s) { msg.dataset.key = s.state + ':' + (s.version || ''); render(s); } }).catch(() => {});
})();
