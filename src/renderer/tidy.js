/* 군말·공백 정리: 음성 인식 직후(자동) 또는 [자동 정리] 단추.
 *  - 군말(음·어·아·에…)은 지우고 자막 편집에 노란 '군말' 표시로 보인다 (누르면 되살림)
 *  - 말 사이 공백은 실제 소리에서 무음을 찾아 잘라 내고, 그 자리에 '공백 0.4초' 표시와 [되살리기]가 붙는다
 *    (소리를 못 읽으면 단어 시각으로 0.3초 넘는 틈만 자른다)
 *  - 지우지 않은 긴 쉼(0.5초 넘게)은 '⏸ 0.8초' 표시로 보이고, 누르면 그 자리만 잘라 낸다
 * 한 번의 Ctrl+Z 로 정리 전체를 되돌린다.
 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const KEY = 'ss.autoTidy.v1';

  SS.autoTidyEnabled = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (_) { return true; } };
  SS.setAutoTidy = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) { /* 저장 못 해도 이번엔 적용 */ } };

  const D = () => SS.disfluency;
  const dur = () => (SS.preview && SS.preview.duration) || (SS.state.source && SS.state.source.duration);

  /** 군말·공백 지우기. opts: { duplicates: 바로 되풀이한 말도, quiet: 알림 없이 } */
  async function tidy(opts) {
    opts = opts || {};
    const st = SS.state;
    if (!st || !st.words || !st.words.length) return null;
    if (SS.flushCaptionEdit) SS.flushCaptionEdit(false);
    SS.pushUndo();
    let fillers = 0, dups = 0;
    st.words.forEach((w) => { if (!w.del && D().isFiller(w.text)) { w.del = true; fillers++; } });
    if (opts.duplicates) {
      // 바로 되풀이한 같은 말 (1초 안): 앞의 것을 지운다
      let prev = -1;
      for (let i = 0; i < st.words.length; i++) {
        const w = st.words[i];
        if (w.del) continue;
        if (prev >= 0) {
          const a = D().core(st.words[prev].text), b = D().core(w.text);
          if (a && a === b && w.start - st.words[prev].end < 1) { st.words[prev].del = true; dups++; }
        }
        prev = i;
      }
    }
    // 말 사이 공백 (지금 남은 구간 기준)
    let gaps = 0, savedSec = 0, how = 'audio';
    const segs = SS.edl.buildSegments(st.words, st.settings, st.overrides, dur());
    if (segs.length) {
      let plan = null;
      try {
        if (!st.source || !st.source.path || !api || !api.audioSilences) throw new Error('소리 분석 없음');
        const found = await api.audioSilences(st.source.path, { start: Math.max(0, segs[0].start - 0.5), end: segs[segs.length - 1].end + 0.5, minDur: 0.3 });
        plan = SS.gaps.planGapCuts(st.words, segs, found.silences || [], { padBefore: 0.08, padAfter: 0.12, minCut: 0.15 });
      } catch (e) {
        how = 'timing';
        plan = D().gapCutsByTiming(st.words, segs, { minGap: 0.3, padBefore: 0.08, padAfter: 0.12 });
      }
      plan.cutBefore.forEach((i) => { st.words[i].cutBefore = true; st.words[i].gapCut = true; });
      st.overrides = Object.assign({}, st.overrides || {}, plan.overrides);
      gaps = plan.cuts; savedSec = plan.savedSec;
    }
    window.dispatchEvent(new Event('ss:words-changed'));
    if (SS.updateTemplatePreview) SS.updateTemplatePreview();
    const res = { fillers, dups, gaps, savedSec, how };
    if (!opts.quiet && SS.toast) {
      const parts = [];
      if (fillers) parts.push(`군말 ${fillers}개`);
      if (dups) parts.push(`되풀이한 말 ${dups}개`);
      if (gaps) parts.push(`말 사이 공백 ${gaps}곳(${savedSec.toFixed(1)}초)`);
      SS.toast(parts.length ? parts.join(' · ') + '을 지웠습니다. 자막 편집의 노란 표시를 누르면 되살립니다 (전체 취소 Ctrl+Z)' : '지울 군말·공백이 없습니다', parts.length ? 6000 : 3000);
    }
    return res;
  }
  SS.tidy = tidy;

  function idxOfId(id) { const ws = SS.state.words; if (ws[id] && ws[id].id === id) return id; return ws.findIndex((w) => w.id === id); }
  function prevLive(i) { const ws = SS.state.words; for (let k = i - 1; k >= 0; k--) if (!ws[k].del) return k; return -1; }

  /** 잘라 낸 공백 되살리기 (i: 뒤 단어 번호) */
  SS.restoreGap = function (i) {
    const st = SS.state, w = st.words[i];
    if (!w) return;
    const p = prevLive(i);
    if (SS.flushCaptionEdit) SS.flushCaptionEdit(false);
    SS.pushUndo();
    w.cutBefore = false; delete w.gapCut;
    delete st.overrides['s:' + w.id];
    if (p >= 0) delete st.overrides['e:' + st.words[p].id];
    window.dispatchEvent(new Event('ss:words-changed'));
    if (SS.updateTemplatePreview) SS.updateTemplatePreview();
  };

  /** 남겨 둔 긴 쉼 잘라 내기 (i: 쉼 뒤 단어 번호). 말 끝 0.12초·다시 시작 앞 0.08초는 남긴다 */
  SS.cutPause = function (i) {
    const st = SS.state, w = st.words[i], p = prevLive(i);
    if (!w || p < 0) return;
    const A = st.words[p];
    const e0 = A.end + 0.12, s1 = w.start - 0.08;
    if (!(s1 - e0 > 0.05)) return;
    if (SS.flushCaptionEdit) SS.flushCaptionEdit(false);
    SS.pushUndo();
    w.cutBefore = true; w.gapCut = true;
    st.overrides['e:' + A.id] = e0;
    st.overrides['s:' + w.id] = s1;
    window.dispatchEvent(new Event('ss:words-changed'));
    if (SS.updateTemplatePreview) SS.updateTemplatePreview();
  };
  SS.idxOfWordId = idxOfId;
})();
