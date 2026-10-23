/* 파형 개요 캔버스: peaks(10ms [min,max]) 그리기, 재생선, 클릭 이동, 휠 확대, 드래그 이동 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});

  const RULER_H = 20; // CSS px
  const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

  function fmtRuler(t, step) {
    const neg = t < 0; t = Math.abs(t);
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    let ss;
    if (step < 0.1) ss = s.toFixed(2).padStart(5, '0');
    else if (step < 1) ss = s.toFixed(1).padStart(4, '0');
    else ss = String(Math.floor(s + 1e-6)).padStart(2, '0');
    return (neg ? '-' : '') + String(m).padStart(2, '0') + ':' + ss;
  }

  class Waveform {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onSeek = opts.onSeek || (() => {});
      this.peaks = null;
      this.bucketSec = 0.01;
      this.duration = 0;
      this.gain = 1;
      this.viewStart = 0;
      this.viewDur = 1;
      this.playhead = 0;
      this.dpr = window.devicePixelRatio || 1;
      this._raf = 0;
      this._drag = null;

      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas);
      this._bind();
      this.resize();
    }

    setData(peaks, bucketSec, duration) {
      this.peaks = peaks;
      this.bucketSec = bucketSec || 0.01;
      const n = peaks ? peaks.length / 2 : 0;
      this.duration = duration || n * this.bucketSec;
      // 정규화: 전체 최대 절댓값이 높이의 95%가 되도록 (조용한 녹음도 보이게)
      let gain = 1;
      if (n) {
        let mx = 0;
        for (let i = 0; i < peaks.length; i++) { const a = Math.abs(peaks[i]); if (a > mx) mx = a; }
        gain = 0.95 / Math.max(0.02, Math.min(1, mx));
      }
      this.gain = gain;
      this.viewStart = 0;
      this.viewDur = Math.max(0.05, this.duration);
      this.draw();
    }

    setView(start, dur) {
      const total = Math.max(0.05, this.duration);
      dur = Math.max(0.05, Math.min(total, dur));
      start = Math.max(0, Math.min(total - dur, start));
      this.viewStart = start;
      this.viewDur = dur;
      this.draw();
    }

    /** 재생선 이동. follow면 화면 밖으로 나갈 때 따라감 */
    setPlayhead(t, follow) {
      this.playhead = t;
      if (follow && (t < this.viewStart || t > this.viewStart + this.viewDur)) {
        this.setView(t - this.viewDur * 0.1, this.viewDur);
        return;
      }
      this.draw();
    }

    resize() {
      const c = this.canvas;
      this.dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(c.clientWidth * this.dpr));
      const h = Math.max(1, Math.round(c.clientHeight * this.dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      this.drawNow();
    }

    timeAtX(cssX) {
      const w = this.canvas.clientWidth || 1;
      return this.viewStart + (cssX / w) * this.viewDur;
    }

    draw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.drawNow(); });
    }

    drawNow() {
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0d0f11';
      ctx.fillRect(0, 0, W, H);

      const rulerH = Math.round(RULER_H * dpr);
      ctx.fillStyle = '#16191c';
      ctx.fillRect(0, 0, W, rulerH);

      const vs = this.viewStart;
      const vd = this.viewDur;
      const pxPerSec = W / vd;

      // 눈금
      let step = TICK_STEPS[TICK_STEPS.length - 1];
      for (const s of TICK_STEPS) { if (s * pxPerSec >= 90 * dpr) { step = s; break; } }
      ctx.font = `${Math.round(11 * dpr)}px Consolas, 'Malgun Gothic', monospace`;
      ctx.textBaseline = 'middle';
      const first = Math.ceil(vs / step) * step;
      for (let t = first; t <= vs + vd + 1e-9; t += step) {
        const x = Math.round((t - vs) * pxPerSec) + 0.5;
        ctx.fillStyle = '#3a4047';
        ctx.fillRect(Math.floor(x), rulerH - Math.round(6 * dpr), Math.max(1, Math.round(dpr)), Math.round(6 * dpr));
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(Math.floor(x), rulerH, 1, H - rulerH);
        ctx.fillStyle = '#8b939c';
        ctx.fillText(fmtRuler(t, step), Math.floor(x) + 4 * dpr, rulerH / 2);
      }

      // 파형
      const top = rulerH;
      const waveH = H - rulerH;
      const mid = top + waveH / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, Math.round(mid), W, 1);

      const peaks = this.peaks;
      if (peaks && peaks.length) {
        const n = peaks.length / 2;
        const bs = this.bucketSec;
        ctx.fillStyle = '#3fbf62';
        const secPerPx = vd / W;
        for (let x = 0; x < W; x++) {
          const t0 = vs + x * secPerPx;
          const t1 = t0 + secPerPx;
          let b0 = Math.floor(t0 / bs);
          let b1 = Math.max(b0 + 1, Math.floor(t1 / bs));
          if (b0 >= n || b1 <= 0) continue;
          if (b0 < 0) b0 = 0;
          if (b1 > n) b1 = n;
          let mn = 0, mx = 0;
          for (let b = b0; b < b1; b++) {
            const a = peaks[b * 2], c = peaks[b * 2 + 1];
            if (a < mn) mn = a;
            if (c > mx) mx = c;
          }
          let y0 = mid - Math.min(1, mx * this.gain) * (waveH / 2 - 2 * dpr);
          let y1 = mid - Math.max(-1, mn * this.gain) * (waveH / 2 - 2 * dpr);
          if (y1 - y0 < 1) { y0 = mid - 0.5; y1 = mid + 0.5; }
          ctx.fillRect(x, y0, 1, y1 - y0);
        }
      }

      // 재생선
      if (this.duration > 0) {
        const px = (this.playhead - vs) * pxPerSec;
        if (px >= -2 && px <= W + 2) {
          const lw = Math.max(1, Math.round(1.5 * dpr));
          ctx.fillStyle = '#ff4d4d';
          ctx.fillRect(Math.round(px - lw / 2), 0, lw, H);
          // 상단 삼각형
          ctx.beginPath();
          ctx.moveTo(px - 5 * dpr, 0);
          ctx.lineTo(px + 5 * dpr, 0);
          ctx.lineTo(px, 7 * dpr);
          ctx.closePath();
          ctx.fill();
        }
      }

      // 확대 정보
      if (this.duration > 0) {
        const txt = `보기 ${fmtRuler(vs, 1)} – ${fmtRuler(vs + vd, 1)}  (${vd >= 60 ? (vd / 60).toFixed(1) + '분' : vd.toFixed(vd < 1 ? 3 : 1) + '초'})`;
        ctx.font = `${Math.round(11 * dpr)}px 'Malgun Gothic', sans-serif`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(13,15,17,0.8)';
        ctx.fillRect(W - tw - 14 * dpr, H - 18 * dpr, tw + 14 * dpr, 18 * dpr);
        ctx.fillStyle = '#8b939c';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, W - tw - 7 * dpr, H - 9 * dpr);
      }
    }

    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.duration) return;
        c.setPointerCapture(e.pointerId);
        this._drag = { x: e.clientX, start: this.viewStart, moved: false, id: e.pointerId };
      });
      c.addEventListener('pointermove', (e) => {
        const d = this._drag;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) > 3) { d.moved = true; c.classList.add('dragging'); }
        if (d.moved) {
          const secPerCss = this.viewDur / (c.clientWidth || 1);
          this.setView(d.start - dx * secPerCss, this.viewDur);
        }
      });
      const end = (e) => {
        const d = this._drag;
        if (!d) return;
        this._drag = null;
        c.classList.remove('dragging');
        try { c.releasePointerCapture(d.id); } catch (_) { /* 무시 */ }
        if (!d.moved && e.type === 'pointerup') {
          const r = c.getBoundingClientRect();
          const t = Math.max(0, Math.min(this.duration, this.timeAtX(e.clientX - r.left)));
          this.playhead = t;
          this.draw();
          this.onSeek(t);
        }
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);

      c.addEventListener('wheel', (e) => {
        if (!this.duration) return;
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const cssX = e.clientX - r.left;
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const delta = (e.shiftKey ? e.deltaY : e.deltaX) || e.deltaY;
          this.setView(this.viewStart + (delta / (c.clientWidth || 1)) * this.viewDur, this.viewDur);
          return;
        }
        const tAt = this.timeAtX(cssX);
        const factor = Math.exp(e.deltaY * 0.0015);
        const total = Math.max(0.05, this.duration);
        const nd = Math.max(0.05, Math.min(total, this.viewDur * factor));
        const frac = cssX / (c.clientWidth || 1);
        this.setView(tAt - frac * nd, nd);
      }, { passive: false });
    }
  }

  SS.Waveform = Waveform;
})();
