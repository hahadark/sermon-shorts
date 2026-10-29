/* 편집 결과로 재생: 지운 부분·잘라 낸 공백을 건너뛰고 완성될 쇼츠 그대로 들려준다.
 *  - 구간(segment) 끝 조금 전에 다음 구간으로 넘어간다. 넘어가는 동안은 소리를 잠깐 끈다 (지운 말이 새어 나오지 않게)
 *  - 지운 곳에서 재생을 누르면 다음 남은 곳부터, 끝까지 들은 뒤 다시 누르면 처음부터
 *  - 마지막 구간이 끝나면 멈춘다 (뒤에 남은 원본을 이어서 틀지 않는다)
 *  - 시간 표시와 재생 막대는 편집 결과 기준 (지운 부분 제외한 쇼츠 길이)
 *  - Shift+Space(원본 재생)는 그 한 번만 원본대로 틀고, 멈추면 다시 편집 결과 재생으로 돌아온다
 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const LOOK = 0.03;      // 구간 끝 이만큼 전에 넘어간다 (화면 한 장 남짓)
  const EDGE = 0.02;      // 구간 시작 앞 이만큼은 구간 안으로 본다

  let rawOnce = false;     // 이번 한 번 원본 재생
  let stopAtOut = null;    // 편집 결과 시각 이 지점에서 멈춤 (미세 조정 미리듣기)
  let pendingStop = null;  // 다음 재생이 시작되면 stopAtOut 으로
  let skipping = false;
  let mutedBySkip = false;
  let timer = 0;
  let skipGen = 0;         // 건너뛰기 세대 (오래된 seek 완료가 최신 상태를 덮지 않게)
  let internalPause = 0;   // 코드가 낸 pause (포커스 이동 제외)
  let stopSig = '';        // pendingStop/stopAtOut 을 정한 때의 구간 구성
  let pendingTimer = 0;

  const video = () => SS.preview && SS.preview.video;
  const segs = () => (SS.getSegments ? SS.getSegments() : []) || [];
  const hasEdit = () => !!(SS.state && SS.state.words && SS.state.words.length && segs().length);

  /** 지금 편집 결과로 재생하는 중인가 (끈 상태·원본 재생 중이면 false) */
  function active() {
    return !rawOnce && !!(SS.getEditedPlayMode && SS.getEditedPlayMode()) && hasEdit();
  }

  /** 원본 시각 t 에서 해야 할 일: ok(그대로) / jump(다음 구간으로) / end(끝) */
  function plan(t) {
    const s = segs();
    for (let i = 0; i < s.length; i++) {
      if (t < s[i].start - EDGE) return { action: 'jump', to: s[i].start };
      if (t < s[i].end - LOOK) return { action: 'ok', seg: i };
      if (i + 1 < s.length && t < s[i + 1].start - EDGE) return { action: 'jump', to: s[i + 1].start };
    }
    return { action: 'end', to: s.length ? s[s.length - 1].end : t };
  }

  function unmute() {
    const v = video();
    if (v && mutedBySkip) v.muted = false;
    mutedBySkip = false;
  }

  function jump(to) {
    const v = video();
    if (!v) return;
    const gen = ++skipGen;
    skipping = true;
    if (!v.muted) { v.muted = true; mutedBySkip = true; }
    const release = () => {
      if (gen !== skipGen) return;   // 더 새로운 건너뛰기가 이어받음
      skipping = false;
      unmute();
      tick();
    };
    // seek 가 끝나지 않아도 잠기지 않도록 안전장치
    const guard = setTimeout(release, 3000);
    SS.preview.seek(to).then(() => { clearTimeout(guard); release(); }, () => { clearTimeout(guard); release(); });
  }

  function finish(to) {
    stopAtOut = null;
    SS.preview.pause();   // 끝에서 멈춤: 그 자막으로 포커스
    unmute();
    // 끝 화면에 멈춰 둔다 (다시 재생을 누르면 처음부터)
    if (Math.abs(SS.preview.currentTime - to) > 0.05) SS.preview.seek(Math.max(0, to - 0.001));
  }

  function sigOf(s) { return s.map((x) => x.start + ':' + x.end).join('|'); }

  function tick() {
    clearTimeout(timer); timer = 0;
    const v = video();
    if (!v || v.paused || skipping || !active()) return;
    const t = v.currentTime;
    const s = segs();
    if (stopAtOut != null) {
      if (stopSig && stopSig !== sigOf(s)) stopAtOut = null;   // 편집으로 구간이 바뀌면 옛 정지 지점은 버린다
      else {
        const out = SS.edl.srcToOut(s, t);
        if (out != null && out >= stopAtOut) { stopAtOut = null; SS.preview.pause(); return; }
      }
    }
    const p = plan(t);
    if (p.action === 'jump') { jump(p.to); return; }
    if (p.action === 'end') { finish(p.to); return; }
    // 구간 끝이 가까우면 그 순간에 맞춰 한 번 더 본다 (화면 갱신 주기보다 정확하게)
    const left = (s[p.seg].end - LOOK - t) / (v.playbackRate || 1);
    if (left < 0.25) timer = setTimeout(tick, Math.max(0, left * 1000 - 2));
  }

  function loop() {
    tick();
    requestAnimationFrame(loop);
  }

  /** 재생 시작: 지운 곳이면 다음 남은 곳, 끝이면 처음부터 */
  function onPlay() {
    if (pendingStop != null) { stopAtOut = pendingStop; pendingStop = null; clearTimeout(pendingTimer); }
    if (!active()) return;
    const s = segs();
    const p = plan(video().currentTime);
    if (p.action === 'end') jump(s[0].start);
    else if (p.action === 'jump') jump(p.to);
    else tick();
  }

  function onPause() {
    clearTimeout(timer); timer = 0;
    if (rawOnce) { rawOnce = false; refreshTime(); }
    stopAtOut = null;
    if (!skipping) unmute();
    if (internalPause > 0) { internalPause--; return; }
    const v = video();
    if (v && !v.ended && SS.focusPlaybackCaption && !skipping) {
      try { SS.focusPlaybackCaption(v.currentTime); } catch (_) {}   // 멈춘 자리의 자막으로 포커스
    }
  }

  // ---------------- 시간 표시 (편집 결과 기준) ----------------
  /** { edited, cur, dur }: 편집 결과로 재생 중이면 쇼츠 기준 시간, 아니면 원본 시간 */
  function timeInfo() {
    const t = SS.preview ? SS.preview.currentTime : 0;
    if (active()) {
      const s = segs();
      let out = SS.edl.srcToOut(s, t);
      if (out == null) { // 지운 곳: 다음 남은 곳의 시각
        const p = plan(t);
        out = p.action === 'end' ? SS.edl.segmentsDuration(s) : (SS.edl.srcToOut(s, p.to) || 0);
      }
      return { edited: true, cur: out, dur: SS.edl.segmentsDuration(s) };
    }
    const off = (SS.state && SS.state.source && SS.state.source.offset) || 0;
    return { edited: false, cur: t + off, dur: (SS.preview && SS.preview.duration) || 0, offset: off };
  }

  /** 재생 막대 비율(0~1) → 원본 시각 */
  function seekFraction(f) {
    f = Math.max(0, Math.min(1, f));
    if (active()) {
      const s = segs();
      const r = SS.edl.outToSrc(s, f * SS.edl.segmentsDuration(s));
      return r ? r.t : 0;
    }
    return f * ((SS.preview && SS.preview.duration) || 0);
  }

  function refreshTime() { if (SS.updateTimeUI) SS.updateTimeUI(); }

  /** 원본 재생 한 번 (Shift+Space): 멈추면 다시 편집 결과 재생 */
  function toggleRaw() {
    if (!SS.preview) return;
    if (!SS.preview.paused) { SS.preview.pause(); return; }
    rawOnce = true; refreshTime();
    SS.preview.play();
  }

  /** 편집 결과의 [fromOut, toOut] 만 재생 (미세 조정 미리듣기). 편집 결과 재생이 꺼져 있어도 이때는 편집 결과로 */
  function playOutRange(fromOut, toOut) {
    const s = segs();
    if (!s.length || !SS.preview) return;
    const total = SS.edl.segmentsDuration(s);
    const a = Math.max(0, Math.min(total, fromOut)), b = Math.max(a, Math.min(total, toOut));
    const r = SS.edl.outToSrc(s, a);
    if (!r) return;
    if (SS.setEditedPlayMode && !SS.getEditedPlayMode()) SS.setEditedPlayMode(true);
    rawOnce = false;
    pendingStop = b;
    stopAtOut = null;
    stopSig = sigOf(s);
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pendingStop = null; }, 4000);   // 재생이 시작되지 않으면 잔류 방지
    if (!SS.preview.paused) { internalPause++; SS.preview.pause(); }
    SS.preview.seek(r.t);      // 자리 옮기기를 기다리지 않고 바로 재생 (준비되는 대로 그 자리부터)
    SS.preview.play();
  }

  function init() {
    const v = video();
    if (!v) { setTimeout(init, 100); return; }
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', () => { if (!v.paused) tick(); });
    requestAnimationFrame(loop);
  }

  SS.playback = { active, plan, timeInfo, seekFraction, toggleRaw, playOutRange, tick, isRaw: () => rawOnce };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);
})();
