/* 미리보기: 9:16 스테이지(1080x1920 템플릿 좌표) + <video> 제어 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});

  const STAGE_W = 1080;
  const STAGE_H = 1920;

  /** 윈도우 경로 → file:// URL (#, ?, 공백, 한글 등 안전하게 인코딩) */
  function toFileUrl(p) {
    let s = String(p).replace(/\\/g, '/');
    if (s.startsWith('//')) { // UNC
      return 'file:' + s.split('/').map((seg, i) => (i < 2 ? seg : encodeURIComponent(seg))).join('/');
    }
    if (!s.startsWith('/')) s = '/' + s;
    return 'file://' + s.split('/').map((seg) => (/^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
  }

  /** 초 → MM:SS.mmm (분은 60 이상도 그대로) */
  function fmtTime(t) {
    if (!isFinite(t) || t < 0) t = 0;
    const ms = Math.round(t * 1000);
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(r).padStart(3, '0');
  }

  class Preview {
    constructor() {
      this.stage = document.getElementById('stage');
      this.inner = document.getElementById('stageInner');
      this.wrap = document.getElementById('stageWrap');
      this.video = document.getElementById('video');
      this.empty = document.getElementById('videoEmpty');
      this.fps = 30;
      this.duration = 0;
      this.path = null;
      this._ro = new ResizeObserver(() => this.fit());
      this._ro.observe(this.wrap);
      this.fit();
    }

    /** 스테이지를 영역에 맞게 9:16으로 축소 */
    fit() {
      const w = this.wrap.clientWidth;
      const h = this.wrap.clientHeight;
      if (!w || !h) return;
      let sw = w;
      let sh = (sw * STAGE_H) / STAGE_W;
      if (sh > h) { sh = h; sw = (sh * STAGE_W) / STAGE_H; }
      sw = Math.floor(sw); sh = Math.floor(sh);
      this.stage.style.width = sw + 'px';
      this.stage.style.height = sh + 'px';
      this.inner.style.transform = 'scale(' + sw / STAGE_W + ')';
    }

    /** 영상 로드. loadedmetadata까지 기다린다. */
    load(path, info) {
      this.path = path;
      this.fps = (info && info.fps) || 30;
      this.duration = (info && info.duration) || 0;
      const v = this.video;
      return new Promise((resolve, reject) => {
        const ok = () => { cleanup(); this.empty.style.display = 'none'; if (!this.duration) this.duration = v.duration; resolve(); };
        const bad = () => { cleanup(); reject(new Error('영상을 불러올 수 없습니다: ' + (v.error ? v.error.message || v.error.code : ''))); };
        const cleanup = () => { v.removeEventListener('loadeddata', ok); v.removeEventListener('error', bad); };
        v.addEventListener('loadeddata', ok);
        v.addEventListener('error', bad);
        v.src = toFileUrl(path);
        v.load();
      });
    }

    get loaded() { return !!this.path && this.video.readyState >= 1; }
    get currentTime() { return this.video.currentTime || 0; }
    get paused() { return this.video.paused; }

    play() { if (this.loaded) return this.video.play().catch(() => {}); }
    pause() { this.video.pause(); }
    toggle() { if (this.video.paused) this.play(); else this.pause(); }

    clamp(t) { return Math.max(0, Math.min(this.duration || this.video.duration || 0, t)); }

    /** 시크 (seeked 이벤트까지 기다리는 Promise) */
    seek(t) {
      if (!this.loaded) return Promise.resolve();
      const v = this.video;
      t = this.clamp(t);
      return new Promise((resolve) => {
        const done = () => { v.removeEventListener('seeked', done); resolve(); };
        v.addEventListener('seeked', done);
        v.currentTime = t;
      });
    }

    /** 프레임 단위 이동 (n 프레임, 프레임 경계에 맞춤) */
    stepFrames(n) {
      const fd = 1 / this.fps;
      const cur = this.currentTime;
      const idx = Math.round(cur / fd);
      return this.seek((idx + n) * fd + fd * 0.01);
    }

    stepSeconds(dt) { return this.seek(this.currentTime + dt); }

    /** 현재 프레임이 실제로 그려질 때까지 대기 */
    waitFrame() {
      const v = this.video;
      return new Promise((resolve) => {
        if (v.requestVideoFrameCallback) {
          let doneFlag = false;
          v.requestVideoFrameCallback(() => { doneFlag = true; resolve(); });
          setTimeout(() => { if (!doneFlag) resolve(); }, 1500);
        } else requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }
  }

  SS.Preview = Preview;
  SS.fmtTime = fmtTime;
  SS.toFileUrl = toFileUrl;
})();
