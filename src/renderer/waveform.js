/* 파형 개요 캔버스: peaks(10ms [min,max]) 그리기, 재생선, 끌어서 재생선 옮기기(스크럽), 휠 확대, 눈금 끌어 화면 옮기기
 *  - 파형·눈금은 화면이 바뀔 때만 따로 그려 두고(캐시), 재생 중에는 그 위에 재생선만 다시 그린다 (재생이 버벅이지 않게)
 *  - 넓게 볼 때도 빠르도록 peaks 를 4배씩 줄인 단계(mip)를 미리 만들어 둔다
 *  - 파형을 누르거나 끌면 재생선이 따라오고 onScrub(t) 로 영상도 따라간다. 놓으면 onSeek(t)
 *  - 위쪽 눈금을 끌거나 Shift/가운데 단추로 끌면 화면을 옮긴다. 휠 = 확대·축소, Shift+휠 = 옆으로
 *  - 마우스를 올리면 그 자리 시각을 보여 준다 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});

  const RULER_H = 20; // CSS px
  const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const EDGE_PX = 28;  // 끌다가 가장자리에 가까우면 화면이 따라 움직인다

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
  function fmtPrecise(t) {
    t = Math.max(0, t);
    const m = Math.floor(t / 60), s = t - m * 60;
    return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
  }

  /** peaks [min,max,…] 를 4개씩 묶어 줄인 단계들 (넓게 볼 때 한 화소에 읽을 칸을 줄인다) */
  function buildLevels(peaks, bs) {
    const levels = [{ bs, p: peaks, n: peaks.length / 2 }];
    let cur = levels[0];
    while (cur.n > 4096) {
      const n = Math.ceil(cur.n / 4), p = new Float32Array(n * 2), src = cur.p;
      for (let i = 0; i < n; i++) {
        let mn = 0, mx = 0;
        const a = i * 4, b = Math.min(cur.n, a + 4);
        for (let k = a; k < b; k++) { const lo = src[k * 2], hi = src[k * 2 + 1]; if (lo < mn) mn = lo; if (hi > mx) mx = hi; }
        p[i * 2] = mn; p[i * 2 + 1] = mx;
      }
      cur = { bs: cur.bs * 4, p, n };
      levels.push(cur);
    }
    return levels;
  }

  class Waveform {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onSeek = opts.onSeek || (() => {});
      this.onScrub = opts.onScrub || this.onSeek;
      this.onScrubStart = opts.onScrubStart || (() => {});
      this.onScrubEnd = opts.onScrubEnd || (() => {});
      this.peaks = null;
      this.levels = null;
      this.bucketSec = 0.01;
      this.duration = 0;
      this.gain = 1;
      this.viewStart = 0;
      this.viewDur = 1;
      this.playhead = 0;
      this.dpr = window.devicePixelRatio || 1;
      this.scrubbing = false;
      this.stats = { base: 0, frames: 0 };   // 시험용: 파형을 새로 그린 횟수 / 재생선만 그린 횟수
      this._raf = 0;
      this._drag = null;
      this._hover = null;      // 마우스가 있는 CSS x
      this._ver = 0;           // 데이터가 바뀔 때마다 늘어 캐시를 새로 그리게
      this._base = document.createElement('canvas');
      this._baseKey = '';
      this._edgeRaf = 0;

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
      this.levels = n ? buildLevels(peaks, this.bucketSec) : null;
      // 정규화: 전체 최대 절댓값이 높이의 95%가 되도록 (조용한 녹음도 보이게)
      let gain = 1;
      if (n) {
        const top = this.levels[this.levels.length - 1];
        let mx = 0;
        for (let i = 0; i < top.p.length; i++) { const a = Math.abs(top.p[i]); if (a > mx) mx = a; }
        gain = 0.95 / Math.max(0.02, Math.min(1, mx));
      }
      this.gain = gain;
      this.viewStart = 0;
      this.viewDur = Math.max(0.05, this.duration);
      this._ver++;
      this.draw();
    }

    setView(start, dur) {
      const total = Math.max(0.05, this.duration);
      dur = Math.max(0.05, Math.min(total, dur));
      start = Math.max(0, Math.min(total - dur, start));
      if (start === this.viewStart && dur === this.viewDur) return;
      this.viewStart = start;
      this.viewDur = dur;
      this.draw();
    }

    /** 재생선 이동. follow면 화면 밖으로 나갈 때 따라감 (끄는 중에는 영상 시각으로 되돌리지 않는다) */
    setPlayhead(t, follow) {
      if (this.scrubbing) return;
      if (t === this.playhead && !follow) return;
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

    /** 눈금·파형(움직이지 않는 부분)을 캐시 캔버스에 그린다 */
    _drawBase(W, H) {
      const b = this._base;
      if (b.width !== W || b.height !== H) { b.width = W; b.height = H; }
      const ctx = b.getContext('2d');
      const dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fbfcfe';
      ctx.fillRect(0, 0, W, H);
      const rulerH = Math.round(RULER_H * dpr);
      ctx.fillStyle = '#f1f4f8';
      ctx.fillRect(0, 0, W, rulerH);
      const vs = this.viewStart, vd = this.viewDur, pxPerSec = W / vd;

      // 눈금
      let step = TICK_STEPS[TICK_STEPS.length - 1];
      for (const s of TICK_STEPS) { if (s * pxPerSec >= 90 * dpr) { step = s; break; } }
      ctx.font = `${Math.round(11 * dpr)}px Consolas, 'Malgun Gothic', monospace`;
      ctx.textBaseline = 'middle';
      const first = Math.ceil(vs / step) * step;
      for (let t = first; t <= vs + vd + 1e-9; t += step) {
        const x = Math.round((t - vs) * pxPerSec) + 0.5;
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(Math.floor(x), rulerH - Math.round(6 * dpr), Math.max(1, Math.round(dpr)), Math.round(6 * dpr));
        ctx.fillStyle = 'rgba(15,23,42,0.05)';
        ctx.fillRect(Math.floor(x), rulerH, 1, H - rulerH);
        ctx.fillStyle = '#64748b';
        ctx.fillText(fmtRuler(t, step), Math.floor(x) + 4 * dpr, rulerH / 2);
      }

      // 파형
      const top = rulerH, waveH = H - rulerH, mid = top + waveH / 2;
      ctx.fillStyle = 'rgba(15,23,42,0.08)';
      ctx.fillRect(0, Math.round(mid), W, 1);
      if (this.levels) {
        const secPerPx = vd / W;
        // 한 화소에 칸이 4개 남짓 들어가는 단계 (가장 촘촘하면서 secPerPx 보다 넓지 않은 것)
        let lv = this.levels[0];
        for (const L of this.levels) { if (L.bs <= secPerPx) lv = L; else break; }
        const { p, n, bs } = lv;
        const amp = waveH / 2 - 2 * dpr, g = this.gain;
        ctx.fillStyle = '#60a5fa';
        for (let x = 0; x < W; x++) {
          const t0 = vs + x * secPerPx;
          let b0 = Math.floor(t0 / bs);
          let b1 = Math.max(b0 + 1, Math.floor((t0 + secPerPx) / bs));
          if (b0 >= n || b1 <= 0) continue;
          if (b0 < 0) b0 = 0;
          if (b1 > n) b1 = n;
          let mn = 0, mx = 0;
          for (let k = b0; k < b1; k++) { const lo = p[k * 2], hi = p[k * 2 + 1]; if (lo < mn) mn = lo; if (hi > mx) mx = hi; }
          let y0 = mid - Math.min(1, mx * g) * amp;
          let y1 = mid - Math.max(-1, mn * g) * amp;
          if (y1 - y0 < 1) { y0 = mid - 0.5; y1 = mid + 0.5; }
          ctx.fillRect(x, y0, 1, y1 - y0);
        }
      }

      // 확대 정보
      if (this.duration > 0) {
        const txt = `보기 ${fmtRuler(vs, 1)} – ${fmtRuler(vs + vd, 1)}  (${vd >= 60 ? (vd / 60).toFixed(1) + '분' : vd.toFixed(vd < 1 ? 3 : 1) + '초'})`;
        ctx.font = `${Math.round(11 * dpr)}px 'Malgun Gothic', sans-serif`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillRect(W - tw - 14 * dpr, H - 18 * dpr, tw + 14 * dpr, 18 * dpr);
        ctx.fillStyle = '#64748b';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, W - tw - 7 * dpr, H - 9 * dpr);
      }
      this.stats.base++;
    }

    drawNow() {
      const ctx = this.ctx;
      const W = this.canvas.width, H = this.canvas.height, dpr = this.dpr;
      const key = W + 'x' + H + '|' + this.viewStart + '|' + this.viewDur + '|' + this._ver + '|' + dpr;
      if (key !== this._baseKey) { this._drawBase(W, H); this._baseKey = key; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this._base, 0, 0);
      this.stats.frames++;
      if (!(this.duration > 0)) return;
      const vs = this.viewStart, pxPerSec = W / this.viewDur;

      // 마우스 자리: 옅은 세로선 + 시각
      if (this._hover != null && !this.scrubbing) {
        const hx = Math.round(this._hover * dpr);
        ctx.fillStyle = 'rgba(15,23,42,0.28)';
        ctx.fillRect(hx, Math.round(RULER_H * dpr), Math.max(1, Math.round(dpr)), H);
        this._label(fmtPrecise(this.timeAtX(this._hover)), hx, '#334155', 'rgba(255,255,255,0.92)');
      }
      // 재생선
      const px = (this.playhead - vs) * pxPerSec;
      if (px >= -2 && px <= W + 2) {
        const lw = Math.max(1, Math.round(1.5 * dpr));
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(Math.round(px - lw / 2), 0, lw, H);
        ctx.beginPath();
        ctx.moveTo(px - 5 * dpr, 0);
        ctx.lineTo(px + 5 * dpr, 0);
        ctx.lineTo(px, 7 * dpr);
        ctx.closePath();
        ctx.fill();
        if (this.scrubbing) this._label(fmtPrecise(this.playhead), px, '#fff', '#ef4444');
      }
    }

    /** 세로선 옆 시각 표 (눈금 줄 바로 아래) */
    _label(text, x, color, bg) {
      const ctx = this.ctx, dpr = this.dpr, W = this.canvas.width;
      ctx.font = `${Math.round(11 * dpr)}px Consolas, 'Malgun Gothic', monospace`;
      const tw = ctx.measureText(text).width, pad = 4 * dpr, h = 16 * dpr, y = Math.round((RULER_H + 2) * dpr);
      let lx = x + 6 * dpr;
      if (lx + tw + pad * 2 > W) lx = x - 6 * dpr - tw - pad * 2;
      ctx.fillStyle = bg;
      ctx.fillRect(lx, y, tw + pad * 2, h);
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx + pad, y + h / 2);
    }

    // ---------------- 손으로 다루기 ----------------
    _cssX(e) { return e.clientX - this.canvas.getBoundingClientRect().left; }
    _scrubTo(cssX) {
      const t = Math.max(0, Math.min(this.duration, this.timeAtX(cssX)));
      this.playhead = t;
      this.draw();
      this.onScrub(t);
      return t;
    }
    /** 끄는 중 가장자리 가까이 있으면 화면을 조금씩 옮기며 재생선도 따라간다 */
    _edgeLoop() {
      this._edgeRaf = 0;
      const d = this._drag;
      if (!d || d.mode !== 'scrub') return;
      const w = this.canvas.clientWidth || 1, x = d.lastX;
      let dir = 0;
      if (x < EDGE_PX) dir = -(EDGE_PX - Math.max(0, x)) / EDGE_PX;
      else if (x > w - EDGE_PX) dir = (Math.min(w, x) - (w - EDGE_PX)) / EDGE_PX;
      if (!dir) return;
      this.setView(this.viewStart + dir * this.viewDur * 0.02, this.viewDur);
      this._scrubTo(Math.max(0, Math.min(w, x)));
      this._edgeRaf = requestAnimationFrame(() => this._edgeLoop());
    }

    _bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', (e) => {
        if ((e.button !== 0 && e.button !== 1) || !this.duration) return;
        e.preventDefault();
        try { c.setPointerCapture(e.pointerId); } catch (_) { /* 창 밖에서 시작한 입력 등 */ }
        const r = c.getBoundingClientRect(), y = e.clientY - r.top, x = e.clientX - r.left;
        const pan = e.button === 1 || e.shiftKey || y < RULER_H;
        this._drag = { mode: pan ? 'pan' : 'scrub', x: e.clientX, lastX: x, start: this.viewStart, moved: false, id: e.pointerId };
        if (!pan) {
          this.scrubbing = true;
          c.classList.add('scrubbing');
          this.onScrubStart();
          this._scrubTo(x);
        }
      });
      c.addEventListener('pointermove', (e) => {
        const d = this._drag;
        const x = this._cssX(e);
        if (!d) {   // 그냥 올려 두면 그 자리 시각을 보인다
          this._hover = x;
          const y = e.clientY - c.getBoundingClientRect().top;
          c.style.cursor = y < RULER_H || e.shiftKey ? 'grab' : 'col-resize';
          this.draw();
          return;
        }
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) > 2) d.moved = true;
        d.lastX = x;
        if (d.mode === 'pan') {
          if (d.moved) { c.classList.add('dragging'); this.setView(d.start - dx * (this.viewDur / (c.clientWidth || 1)), this.viewDur); }
        } else {
          this._scrubTo(Math.max(0, Math.min(c.clientWidth || 1, x)));
          if (!this._edgeRaf) this._edgeRaf = requestAnimationFrame(() => this._edgeLoop());
        }
      });
      c.addEventListener('pointerleave', () => { if (this._hover != null) { this._hover = null; this.draw(); } });
      const end = (e) => {
        const d = this._drag;
        if (!d) return;
        this._drag = null;
        c.classList.remove('dragging', 'scrubbing');
        try { c.releasePointerCapture(d.id); } catch (_) { /* 무시 */ }
        if (this._edgeRaf) { cancelAnimationFrame(this._edgeRaf); this._edgeRaf = 0; }
        if (d.mode === 'scrub') {
          this.scrubbing = false;
          const t = this.playhead;
          this.draw();
          this.onSeek(t);          // 놓은 자리로 정확히
          this.onScrubEnd(t, e.type === 'pointerup');
        } else if (!d.moved && e.type === 'pointerup' && !(e.clientY - c.getBoundingClientRect().top < RULER_H)) {
          const t = Math.max(0, Math.min(this.duration, this.timeAtX(this._cssX(e))));
          this.playhead = t; this.draw(); this.onSeek(t);
        }
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', end);
      c.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

      c.addEventListener('wheel', (e) => {
        if (!this.duration) return;
        e.preventDefault();
        const cssX = this._cssX(e);
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
  SS.waveformLevels = buildLevels;   // 시험용
})();
