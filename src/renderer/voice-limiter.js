/* 미리보기용 리미터 (AudioWorklet): 5ms 앞을 내다보고 천장(-1.5 dBFS)을 절대 넘지 않게 소리를 줄인다.
 * 방법: 필요한 줄임 값의 '앞뒤 L+1 샘플 최솟값' → 천천히 되돌리기(release) → L 샘플 평균, 그리고 원래 소리를 L 샘플 늦춘다.
 * 이렇게 하면 큰 소리가 나오는 순간에는 이미 충분히 줄어 있다 (내보내기의 ffmpeg alimiter 와 같은 역할). */
class SsLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ceiling', defaultValue: 0.841, minValue: 0.01, maxValue: 1, automationRate: 'k-rate' }, { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }]; }
  constructor() {
    super();
    this.L = Math.max(16, Math.round(sampleRate * 0.005));
    this.N = this.L + 1;
    this.delay = [new Float32Array(this.L), new Float32Array(this.L)]; this.dpos = 0;
    this.win = new Float32Array(this.N).fill(1); this.wpos = 0; this.wmin = 1;
    this.box = new Float32Array(this.L).fill(1); this.bpos = 0; this.bsum = this.L;
    this.env = 1;
    this.rel = 1 - Math.exp(-1 / (0.08 * sampleRate));
    this.minGain = 1; this.tick = 0;
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const ceil = params.ceiling[0], on = params.enabled[0] >= 0.5;
    const n = inp[0].length, chs = Math.min(2, out.length);
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let c = 0; c < inp.length && c < 2; c++) { const v = Math.abs(inp[c][i]); if (v > a) a = v; }
      const gt = on && a > ceil ? ceil / a : 1;
      // 창 최솟값 (L+1 샘플)
      const leaving = this.win[this.wpos]; this.win[this.wpos] = gt; this.wpos = (this.wpos + 1) % this.N;
      if (gt <= this.wmin) this.wmin = gt;
      else if (leaving <= this.wmin) { let m = 1; for (let k = 0; k < this.N; k++) if (this.win[k] < m) m = this.win[k]; this.wmin = m; }
      // 줄일 때는 바로, 되돌릴 때는 천천히
      this.env = this.wmin < this.env ? this.wmin : this.env + (this.wmin - this.env) * this.rel;
      // L 샘플 평균
      this.bsum += this.env - this.box[this.bpos]; this.box[this.bpos] = this.env; this.bpos = (this.bpos + 1) % this.L;
      const g = Math.min(1, this.bsum / this.L);
      if (g < this.minGain) this.minGain = g;
      for (let c = 0; c < chs; c++) {
        const src = inp[Math.min(c, inp.length - 1)];
        const d = this.delay[c], x = d[this.dpos];
        d[this.dpos] = src[i];
        out[c][i] = x * g;
      }
      this.dpos = (this.dpos + 1) % this.L;
    }
    if (++this.tick >= 16) { this.port.postMessage({ minGain: this.minGain }); this.minGain = 1; this.tick = 0; }
    return true;
  }
}
registerProcessor('ss-limiter', SsLimiter);
