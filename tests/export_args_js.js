// Electron render.js buildExportArgs 를 그대로 불러 인자를 만든다 (Rust export_args_parity 시험이 부른다)
//   node tests/export_args_js.js <입력.json>  → stdout 에 [{ args, filtergraph }]
'use strict';
const Module = require('module'); const fs = require('fs');
const stub = { app: { getPath: () => require('os').tmpdir(), isPackaged: false }, ipcMain: { handle() {}, on() {} }, dialog: {}, BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => false } };
const orig = Module._load; Module._load = function (r) { if (r === 'electron') return stub; return orig.apply(this, arguments); };
const R = require('F:/aside/sermon-shorts-app/src/main/render.js');
const V = require('F:/aside/sermon-shorts-app/src/shared/voice.js');
const B = require('F:/aside/sermon-shorts-app/src/shared/bgm.js');
const inp = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outDur = inp.segments.reduce((n, s) => n + s.end - s.start, 0);
const out = inp.cases.map((c) => {
  const bgmPlan = c.bgm ? B.plan(c.bgm, outDur) : null;
  const r = R.buildExportArgs({ sourcePath: inp.source, outPath: inp.out, segments: inp.segments, lines: inp.lines, crop: c.crop, fadeMs: inp.fadeMs, tempDir: inp.temp, theme: c.theme, encoder: c.encoder, bgmFile: c.bgm ? inp.bgmFile : null, bgmPlan, voice: c.voice ? V.normalize(c.voice) : null });
  return { args: r.args, filtergraph: r.filtergraph };
});
process.stdout.write(JSON.stringify(out));