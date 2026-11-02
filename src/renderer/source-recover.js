/* 원본 영상 되살리기: 프로젝트·자동 저장본을 열 때 원본 영상이 없으면
 *   [유튜브에서 다시 받기]  같은 구간을 다시 받고, 자막·컷 시각을 새 파일에 맞게 옮긴다 (shared/source-fetch.js)
 *   [파일 직접 찾기]        옮겨 둔 원본 파일을 고른다
 * 설정 [일반 → 원본 영상이 없을 때]가 '바로 다시 받기'면 묻지 않고 받는다.
 * SS.ensureSource(saved) → 열 수 있는 프로젝트 데이터 (취소하면 오류) */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const SF = () => SS.sourceFetch;

  function modal(html) {
    const m = document.createElement('div');
    m.className = 'modal-overlay src-recover';
    m.innerHTML = `<div class="modal-dialog" role="dialog" aria-modal="true" style="max-width:520px">${html}</div>`;
    m.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(m);
    return m;
  }

  /** 물어보기 → 'download' | 'locate' | null(취소) */
  function ask(source, plan) {
    return new Promise((resolve) => {
      const name = String(source.path || '').split(/[\\/]/).pop();
      const can = !plan.error;
      const m = modal(`
        <div class="modal-header"><h3>원본 영상을 찾을 수 없습니다</h3></div>
        <div style="padding:4px 20px 8px;font-size:13px;line-height:1.7;color:var(--text-2)">
          <p style="margin:0 0 6px">이 편집의 원본 영상(<b>${esc(name)}</b>)이 지워졌거나 옮겨졌습니다.</p>
          ${can ? `<p style="margin:0 0 6px">유튜브에서 같은 부분을 다시 받으면 편집(자막·컷·미세 조정)을 그대로 이어서 할 수 있습니다.${plan.needsSubs ? ' 예전 버전에서 만든 편집이라 유튜브 자막과 맞춰 위치를 되찾습니다.' : ''}</p>
            <p style="margin:0;color:var(--muted)">${esc(source.title || source.url || '')}</p>` : `<p style="margin:0">${esc(plan.error)}</p>`}
        </div>
        <div class="modal-footer">
          <button class="btn" data-a="cancel">취소</button>
          <button class="btn" data-a="locate">파일 직접 찾기</button>
          ${can ? '<button class="btn primary" data-a="download">유튜브에서 다시 받기</button>' : ''}
        </div>`);
      const done = (v) => { m.remove(); resolve(v); };
      m.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => done(b.dataset.a === 'cancel' ? null : b.dataset.a)));
      m.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
      setTimeout(() => { const b = m.querySelector('.btn.primary') || m.querySelector('[data-a=locate]'); if (b) b.focus(); }, 0);
    });
  }

  function progress() {
    const m = modal(`
      <div class="modal-header"><h3>원본 영상 다시 받는 중</h3></div>
      <div style="padding:6px 20px 18px">
        <div class="src-rec-msg" style="font-size:13px;color:var(--text-2);margin-bottom:8px">준비 중…</div>
        <div style="height:8px;border-radius:4px;background:var(--line,#e5e7eb);overflow:hidden"><div class="src-rec-bar" style="height:100%;width:0;background:var(--accent,#2563eb);transition:width .2s"></div></div>
      </div>`);
    return {
      set(pct, msg) {
        if (msg != null) m.querySelector('.src-rec-msg').textContent = msg;
        if (pct != null) m.querySelector('.src-rec-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
      },
      close() { m.remove(); },
    };
  }

  const cancelled = () => Object.assign(new Error('원본 영상이 없어 열지 않았습니다.'), { code: 'cancelled' });

  /** 다시 받고 시각을 옮긴 프로젝트 데이터 */
  async function redownload(saved, plan, ui) {
    const sf = SF();
    let oldMap = plan.map;
    if (plan.needsSubs) {
      ui.set(2, '유튜브 자막과 맞춰 편집 위치를 찾는 중…');
      const subs = await api.sourceSubWords(plan.url);
      oldMap = sf.recoverClipMap(saved.words, subs);
      if (!oldMap) throw new Error('예전 버전에서 만든 편집이라 위치를 되찾지 못했습니다. 원본 파일이 있다면 [파일 직접 찾기]로 골라 주세요.');
    }
    const f2s = (f) => sf.fileToSrcByMap(oldMap, f);
    const off = api.onProgress((info) => { if (info.task === 'youtube') ui.set(5 + Math.round((info.pct || 0) * 0.9), `영상 받는 중… ${Math.round(info.pct || 0)}%`); });
    let res, newMap, newOffset = 0, fetch;
    try {
      ui.set(5, '영상 받는 중…');
      if (plan.kind === 'clips') {
        const spans = plan.spans || sf.spansFromWords(saved.words, f2s);
        res = await api.chatFetchClips(plan.url, spans);
        newMap = res.map;
        fetch = { kind: 'clips', spans, map: res.map };
      } else if (plan.kind === 'part') {
        res = await api.ytFetchPart(plan.url, plan.start, plan.end);
        newOffset = res.offset || 0;
        newMap = [{ src0: newOffset, src1: newOffset + 1e7, file0: 0 }];
        fetch = { kind: 'part', start: plan.start, end: plan.end };
      } else {
        res = await api.ytDownload(plan.url, plan.start, plan.end);
        newOffset = res.offset || 0;
        newMap = [{ src0: newOffset, src1: newOffset + 1e7, file0: 0 }];
        fetch = { kind: 'section', start: plan.start, end: plan.end };
      }
    } finally { off(); }
    ui.set(97, '자막·컷 위치를 새 영상에 맞추는 중…');
    const r = sf.remapProject(saved, f2s, (s) => sf.srcToFileByMap(newMap, s));
    if (r.moved && r.missing > Math.max(2, r.moved * 0.05)) throw new Error(`다시 받은 영상에 편집 부분 일부가 없습니다 (${r.missing}곳). 원본 파일을 직접 찾아 주세요.`);
    const out = r.data;
    out.source = { ...saved.source, path: res.path, offset: newOffset, fetch };
    delete out.source.duration; delete out.source.fps; delete out.source.width; delete out.source.height;  // 새 파일에서 다시 잰다
    return out;
  }

  SS.ensureSource = async function (saved) {
    const src = (saved && saved.source) || {};
    if (!src.path || (await api.fileExists(src.path))) return saved;
    const plan = SF().plan(src);
    const auto = !plan.error && SS.appSettings && SS.appSettings.sourceMissing === 'auto';
    for (;;) {
      const choice = auto ? 'download' : await ask(src, plan);
      if (!choice) throw cancelled();
      if (choice === 'locate') {
        const p = await api.openVideoDialog();
        if (!p) continue;
        SS.lastSourceRecovery = 'located';
        return { ...saved, source: { ...src, path: p } };
      }
      const ui = progress();
      try {
        const out = await redownload(saved, plan, ui);
        SS.lastSourceRecovery = 'downloaded';
        return out;
      } catch (e) {
        if (auto) throw e;
        alert('원본 영상을 다시 받지 못했습니다.\n' + cleanErr(e));
      } finally { ui.close(); }
    }
  };
})();
