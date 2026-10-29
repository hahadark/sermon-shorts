/* 디자인 카드에서 바로 고치는 교회 정보: 교회 이름·로고, 직접 입력한 설교자를 목록에 저장.
 * 고치면 미리보기에 바로 보이고, 잠시 뒤 설정(settings.json)에도 저장된다. 자세한 것(설교자 목록·자주 쓰는 말)은 설정 창. */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const DEFAULT_CHURCH = '우리 교회';
  let saveTimer = 0;
  let shownLogo = null;

  function settingsTemplate() {
    SS.appSettings = SS.appSettings || {};
    SS.appSettings.template = SS.appSettings.template || {};
    return SS.appSettings.template;
  }

  async function showLogo(p) {
    const img = $('imgChurchLogo');
    if (!img || p === shownLogo) return;
    shownLogo = p;
    let url = '';
    try { url = await api.getLogoDataUrl(p || ''); } catch (_) { url = ''; }
    img.src = url || '';
    img.style.visibility = url ? '' : 'hidden';
  }

  /** 설정 → 입력칸 (입력 중이면 글자는 건드리지 않는다) */
  function fill(s) {
    const t = (s && s.template) || {};
    const inp = $('inpChurch');
    if (inp && document.activeElement !== inp && !saveTimer) inp.value = t.churchName || '';
    showLogo(t.logoPath || '');
  }

  function saveChurchSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = 0;
      const name = ($('inpChurch').value || '').trim() || DEFAULT_CHURCH;
      try { await api.saveSettings({ template: { churchName: name } }); }
      catch (e) { if (SS.toast) SS.toast('교회 이름 저장 실패: ' + e.message, 5000); }
    }, 500);
  }

  // 설교자: '직접 입력'에 쓴 이름을 목록에 저장하는 + 버튼
  function syncSpeakerButton() {
    const sel = $('selSpeaker'), inp = $('inpSpeaker'), btn = $('btnSaveSpeaker');
    if (!sel || !inp || !btn) return;
    const name = (inp.value || '').trim();
    const list = (SS.appSettings && SS.appSettings.speakers) || [];
    btn.hidden = !(sel.value === '직접 입력' && name && !list.includes(name));
  }
  SS.syncSpeakerButton = syncSpeakerButton;

  async function saveSpeaker() {
    const name = ($('inpSpeaker').value || '').trim();
    if (!name) return;
    const list = ((SS.appSettings && SS.appSettings.speakers) || []).slice();
    if (!list.includes(name)) list.push(name);
    try {
      const s = await api.saveSettings({ speakers: list, defaultSpeaker: (SS.appSettings && SS.appSettings.defaultSpeaker) || name });
      SS.appSettings = s || (await api.getSettings());
      if (SS.refreshSpeakerOptions) SS.refreshSpeakerOptions(SS.appSettings, name);
      if (SS.toast) SS.toast('설교자 목록에 "' + name + '"을(를) 저장했습니다');
    } catch (e) { if (SS.toast) SS.toast('설교자 저장 실패: ' + e.message, 5000); }
    syncSpeakerButton();
  }

  // 지금 테마가 교회 이름·로고를 보이는지 (기본 테마는 숨김). 눈 단추로 이 프로젝트에서만 켜고 끈다
  function churchShown() {
    const t = SS.state && SS.state.activeTheme;
    return !!(t && t.churchName && t.churchName.show);
  }
  function syncShowButton() {
    const b = $('btnChurchShow');
    if (!b) return;
    const on = churchShown();
    b.classList.toggle('i-eye', on); b.classList.toggle('i-eye-off', !on); b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? '쇼츠에 교회 이름·로고를 보이는 중 (누르면 숨김)' : '쇼츠에 교회 이름·로고 보이기 (지금 테마는 숨김)';
  }
  SS.syncChurchShowButton = syncShowButton;
  function toggleShow() {
    const cur = SS.state && SS.state.activeTheme;
    if (!cur || !SS.theme) return;
    const t = SS.theme.normalizeTheme(JSON.parse(JSON.stringify(cur)));
    const on = !t.churchName.show;
    t.churchName.show = on;
    if (t.logo) t.logo.show = on;
    SS.state.activeTheme = t;
    if (SS.updateTemplatePreview) SS.updateTemplatePreview();
    syncShowButton();
    if (SS.toast) SS.toast(on ? '쇼츠에 교회 이름·로고를 보입니다 (이 프로젝트에만. 테마에 저장하려면 [편집])' : '쇼츠에서 교회 이름·로고를 숨겼습니다');
  }

  function init() {
    const inp = $('inpChurch');
    if (!inp || !api) return;
    inp.addEventListener('input', () => {
      settingsTemplate().churchName = inp.value.trim();   // 미리보기는 바로 (비우면 테마 기본값)
      if (SS.updateTemplatePreview) SS.updateTemplatePreview();
      saveChurchSoon();
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } e.stopPropagation(); });
    $('btnChurchLogo').addEventListener('click', async () => {
      try {
        const r = await api.chooseLogo();
        if (!r || !r.path) return;
        settingsTemplate().logoPath = r.path;
        await api.saveSettings({ template: { logoPath: r.path } });   // 저장되면 미리보기 로고도 바뀐다
        SS.toast && SS.toast('로고를 바꿨습니다');
      } catch (e) { if (SS.toast) SS.toast('로고 바꾸기 실패: ' + e.message, 5000); }
    });
    $('btnChurchMore').addEventListener('click', () => { if (SS.openSettings) SS.openSettings('church'); });
    $('btnChurchShow').addEventListener('click', toggleShow);
    // 테마를 바꾸거나 프로젝트를 열면 눈 단추도 맞춘다
    $('selTheme').addEventListener('change', () => setTimeout(syncShowButton, 50));
    window.addEventListener('ss:template-changed', () => setTimeout(syncShowButton, 0));
    setInterval(syncShowButton, 1000);
    $('btnSaveSpeaker').addEventListener('click', saveSpeaker);
    $('inpSpeaker').addEventListener('input', syncSpeakerButton);
    $('selSpeaker').addEventListener('change', syncSpeakerButton);
    api.getSettings().then(fill).catch(() => {});
    if (api.onSettingsChanged) api.onSettingsChanged((s) => { fill(s); if (SS.refreshSpeakerOptions) SS.refreshSpeakerOptions(s); syncSpeakerButton(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
