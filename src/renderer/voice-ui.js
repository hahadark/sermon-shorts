/* 목소리 크기 칸: 원래대로 / 자동 맞춤(유튜브 기준 -14 LUFS) / 직접(-12~+20 dB), 작은 말소리 고르게, 리미터.
 * 미리보기: 영상 소리를 Web Audio 로 받아 압축기 → 크기 → 리미터 → 미터 순으로 흘린다 (내보내기와 같은 순서, shared/voice.js).
 * 자동 맞춤은 편집이 바뀌면 잠시 뒤 다시 잰다 (main/voice.js, ffmpeg loudnorm). */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const api = window.api;
  const $ = (id) => document.getElementById(id);
  const V = () => SS.voice;
  const cur = () => V().normalize(SS.state && SS.state.voice);
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // ---------------- 미리보기 소리 길 (처음 켤 때 한 번 만든다) ----------------
  let ctx = null, g = null;
  /** DynamicsCompressorNode 는 스스로 소리를 키워(makeup) 주므로 그만큼 다시 줄인다 (내보내기 ffmpeg 와 크기를 맞추려고) */
  function autoMakeupDb(thr, ratio) { const curve0 = thr + (0 - thr) / ratio; return 0.6 * -curve0; }
  function ensureGraph() {
    if (g) return g;
    const video = SS.preview && SS.preview.video; if (!video) return null;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaElementSource(video);
    const comp = ctx.createDynamicsCompressor(), compFix = ctx.createGain();
    const gain = ctx.createGain();
    const meter = ctx.createAnalyser(); meter.fftSize = 2048;
    // 리미터(voice-limiter.js)는 불러오는 대로 gain 과 meter 사이에 끼운다
    src.connect(comp); comp.connect(compFix); compFix.connect(gain); gain.connect(meter); meter.connect(ctx.destination);
    g = { src, comp, compFix, gain, lim: null, limGain: 1, meter, buf: new Float32Array(meter.fftSize) };
    g.ready = ctx.audioWorklet.addModule('voice-limiter.js').then(() => {
      const lim = new AudioWorkletNode(ctx, 'ss-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      lim.port.onmessage = (ev) => { g.limGain = ev.data.minGain; };
      gain.disconnect(); gain.connect(lim); lim.connect(meter);
      g.lim = lim; applyGraph();
    }).catch((e) => console.warn('[voice] 리미터 불러오기 실패', e));
    video.addEventListener('play', () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); });
    applyGraph();
    return g;
  }
  function setComp(node, fix, on, thr, ratio, knee, attack, release, makeupDb) {
    const t = ctx.currentTime;
    if (!on) { node.threshold.setValueAtTime(0, t); node.ratio.setValueAtTime(1, t); node.knee.setValueAtTime(0, t); fix.gain.setValueAtTime(1, t); return; }
    node.threshold.setValueAtTime(thr, t); node.ratio.setValueAtTime(ratio, t); node.knee.setValueAtTime(knee, t);
    node.attack.setValueAtTime(attack, t); node.release.setValueAtTime(release, t);
    fix.gain.setValueAtTime(V().dbToLin(makeupDb - autoMakeupDb(thr, ratio)), t);
  }
  function applyGraph() {
    if (!g) return;
    const p = V().webParams(cur()), c = p.comp;
    setComp(g.comp, g.compFix, p.on && p.even, c.thresholdDb, c.ratio, c.kneeDb, c.attack, c.release, c.makeupDb);
    g.gain.gain.setTargetAtTime(p.on ? p.gain : 1, ctx.currentTime, 0.02);
    // 리미터: 천장 -1.5 dB (앞을 내다보고 줄여 넘지 않음)
    if (g.lim) { g.lim.parameters.get('ceiling').setValueAtTime(V().dbToLin(p.ceilDb), ctx.currentTime); g.lim.parameters.get('enabled').setValueAtTime(p.on ? 1 : 0, ctx.currentTime); }
  }

  // ---------------- 미터 ----------------
  let peakHold = -100, peakAt = 0, meterRaf = 0;
  const stats = { maxPeakDb: -100, frames: 0, nonSilent: 0 };
  function meterLoop() {
    meterRaf = 0;
    const video = SS.preview && SS.preview.video;
    if (!g || !video) return;
    g.meter.getFloatTimeDomainData(g.buf);
    let pk = 0, sum = 0; for (let i = 0; i < g.buf.length; i++) { const a = Math.abs(g.buf[i]); if (a > pk) pk = a; sum += g.buf[i] * g.buf[i]; }
    const pkDb = pk > 0 ? 20 * Math.log10(pk) : -100, rmsDb = sum > 0 ? 10 * Math.log10(sum / g.buf.length) : -100;
    if (!video.paused) { stats.frames++; if (pkDb > -60) stats.nonSilent++; if (pkDb > stats.maxPeakDb) stats.maxPeakDb = pkDb; }
    const now = performance.now();
    if (pkDb > peakHold || now - peakAt > 1500) { peakHold = pkDb; peakAt = now; }
    const pos = (db) => Math.max(0, Math.min(100, (db + 48) / 48 * 100)); // -48 ~ 0 dB
    const fill = $('vmFill'), pkEl = $('vmPeak'), lbl = $('vmLbl');
    if (fill) {
      fill.style.width = pos(rmsDb).toFixed(1) + '%';
      pkEl.style.left = pos(peakHold).toFixed(1) + '%';
      lbl.textContent = peakHold > -60 ? peakHold.toFixed(1) + ' dB' : '-∞';
      $('vmLimit').classList.toggle('on', g.limGain < 0.94); // 0.5 dB 넘게 줄이는 중
    }
    if (!video.paused && !$('voicePane').hidden) meterRaf = requestAnimationFrame(meterLoop);
  }
  function startMeter() { if (!meterRaf && g) meterRaf = requestAnimationFrame(meterLoop); }

  // ---------------- 자동 맞춤: 재기 ----------------
  let measuring = null, measureErr = '', stableKey = '', stableSince = 0;
  function segmentsNow() { try { return SS.getSegments ? SS.getSegments() : []; } catch (_) { return []; } }
  async function measure(force) {
    const st = SS.state; if (!st || !st.source || !st.source.path) return null;
    const v = cur(), segs = segmentsNow(), key = V().segKey(segs);
    if (!segs.length) return null;
    if (!force && V().measuredFits(v, key)) return v.measured;
    if (measuring) return measuring;
    measureErr = ''; render();
    measuring = (async () => {
      try {
        const m = await api.voiceAnalyze({ sourcePath: st.source.path, segments: segs, voice: v });
        const now = cur();
        // 재는 동안 끄거나 고르게 설정을 바꿨으면 버린다
        if (now.even === m.even) { st.voice = { ...now, measured: m }; }
        return m;
      } catch (e) { measureErr = cleanErr(e); return null; }
      finally { measuring = null; applyGraph(); render(); }
    })();
    render();
    return measuring;
  }
  // 편집이 바뀌면: 1초 동안 그대로면 다시 잰다 (자동 맞춤일 때만)
  setInterval(() => {
    const v = cur();
    if (v.mode !== 'auto' || measuring || !SS.state || !SS.state.source) return;
    const key = V().segKey(segmentsNow());
    if (V().measuredFits(v, key)) { stableKey = key; return; }
    if (key !== stableKey) { stableKey = key; stableSince = Date.now(); return; }
    if (Date.now() - stableSince >= 1000) measure();
  }, 500);

  // ---------------- 화면 ----------------
  function render() {
    const pane = $('voicePane'); if (!pane || !V()) return;
    const v = cur(), gdb = V().gainDb(v);
    pane.querySelectorAll('#voiceMode [data-mode]').forEach((b) => { const on = b.dataset.mode === v.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $('voiceAuto').hidden = v.mode !== 'auto';
    $('voiceManual').hidden = v.mode !== 'manual';
    if (document.activeElement !== $('voiceGain')) $('voiceGain').value = String(v.gainDb);
    $('voiceGainLbl').textContent = (v.gainDb > 0 ? '+' : '') + v.gainDb.toFixed(1) + ' dB';
    $('voiceEven').checked = v.even;
    const fits = V().measuredFits(v, V().segKey(segmentsNow()));
    let txt;
    if (measureErr) txt = '<span class="voice-err">' + measureErr.replace(/[<>&]/g, '') + '</span>';
    else if (measuring || (v.mode === 'auto' && !fits && SS.state && SS.state.source)) txt = '<span class="voice-busy"></span>목소리 크기를 재는 중…';
    else if (v.measured) txt = `지금 목소리 <b>${v.measured.i.toFixed(1)} LUFS</b> → 유튜브 기준 ${V().TARGET_LUFS} LUFS 에 맞춰 <b>${gdb > 0 ? '+' : ''}${(gdb || 0).toFixed(1)} dB</b>`;
    else txt = '영상을 열면 목소리 크기를 잽니다.';
    $('voiceAutoMsg').innerHTML = txt;
    $('voiceSum').textContent = V().describe(v);
    $('btnVoiceMeasure').disabled = !!measuring;
  }
  function change(patch, undo) {
    if (undo !== false && SS.pushUndo) SS.pushUndo();
    SS.state.voice = V().normalize({ ...cur(), ...patch });
    if (undo !== false && SS.pushUndo) SS.pushUndo();
    if (V().isOn(SS.state.voice)) ensureGraph();
    applyGraph(); render();
    if (SS.state.voice.mode === 'auto') measure();
    window.dispatchEvent(new Event('ss:voice-changed'));
  }
  function init() {
    if (!$('voicePane')) return;
    $('voiceMode').querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => change({ mode: b.dataset.mode })));
    $('voiceGain').addEventListener('input', () => { SS.state.voice = V().normalize({ ...cur(), gainDb: Number($('voiceGain').value) }); ensureGraph(); applyGraph(); render(); });
    $('voiceGain').addEventListener('change', () => change({ gainDb: Number($('voiceGain').value) }));
    $('voiceEven').addEventListener('change', () => change({ even: $('voiceEven').checked }));
    $('btnVoiceMeasure').addEventListener('click', () => measure(true));
    $('btnVoiceListen').addEventListener('click', () => { const p = SS.preview; if (!p) return; if (p.paused) { ensureGraph(); p.play(); } else p.pause(); });
    const hook = () => {
      const video = SS.preview && SS.preview.video; if (!video) { setTimeout(hook, 200); return; }
      video.addEventListener('play', () => { if (V().isOn(cur())) ensureGraph(); startMeter(); syncListen(); });
      video.addEventListener('pause', syncListen);
    };
    hook();
    // 프로젝트·자동 저장본을 열거나 실행 취소하면 다시 그린다
    ['ss:video-opened', 'ss:source-loaded', 'ss:autosave-opened', 'ss:transcript-ready'].forEach((ev) => window.addEventListener(ev, () => { if (V().isOn(cur())) ensureGraph(); applyGraph(); render(); }));
    const prev = window._testHook_onProjectLoaded;
    window._testHook_onProjectLoaded = function () { if (prev) prev.apply(this, arguments); if (V().isOn(cur())) ensureGraph(); applyGraph(); render(); };
    render();
  }
  function syncListen() {
    const b = $('btnVoiceListen'), p = SS.preview; if (!b || !p) return;
    const on = !p.paused; b.classList.toggle('i-play', !on); b.classList.toggle('i-pause', on); b.textContent = on ? '멈추기' : '들어 보기';
  }
  SS.voiceUi = { render, measure, applyGraph, ensureGraph, stats, get graph() { return g; }, get ctx() { return ctx; }, get measuring() { return measuring; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
