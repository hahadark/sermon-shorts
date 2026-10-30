'use strict';
// 교인 배포 자료: AI 로 내용 만들기, 설교 원고 가져오기(유튜브 자막·파일), PDF·PNG·인쇄로 내보내기
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ipcMain, dialog, BrowserWindow, shell } = require('electron');
const tools = require('./tools');
const llm = require('./llm');
const M = require('../shared/materials');
const chatPlan = require('../shared/chat-plan');

function fontCss() {
  const font = path.join(tools.root, 'assets', 'fonts', 'PretendardVariable.woff2');
  const url = require('url').pathToFileURL(font).href;
  return `@font-face{font-family:'Pretendard';src:url('${url}') format('woff2');font-weight:45 920;font-display:block}`;
}

/** 렌더러가 보낸 본문·스타일을 완전한 HTML 파일로 (글꼴은 앱 안의 Pretendard) */
function writeDoc(body, css, w) {
  const dir = tools.ensureDir(path.join(tools.cache, 'materials_tmp'));
  const file = path.join(dir, 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.html');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src file: data:; img-src file: data:">
<style>${fontCss()}${css || ''}</style></head><body${w ? ` style="width:${w}px"` : ''}>${body}</body></html>`;
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

async function withWindow(file, { width, height, offscreen }, fn) {
  const win = new BrowserWindow({
    show: false, width: width || 900, height: height || 1200, useContentSize: true,
    webPreferences: { offscreen: !!offscreen, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true },
  });
  try {
    await win.loadFile(file);
    // 글꼴이 다 읽힐 때까지
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 120)))');
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.promises.unlink(file).catch(() => {});
  }
}

async function toPdf(body, css) {
  const file = writeDoc(body, css);
  return withWindow(file, { width: 820, height: 1160 }, (win) => win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 } }));
}

async function toPng(body, css, width, height) {
  const file = writeDoc(body, css, width);
  return withWindow(file, { width, height, offscreen: true }, async (win) => {
    win.webContents.setZoomFactor(1);
    await new Promise((r) => setTimeout(r, 150));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height });
    const size = img.getSize();
    return (size.width !== width || size.height !== height ? img.resize({ width, height, quality: 'best' }) : img).toPNG();
  });
}

// ---- .docx 에서 글만 꺼내기 (zip 안의 word/document.xml) ----
function docxText(buf) {
  // 끝의 '중앙 디렉터리'에서 파일 목록을 읽는다
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Word 파일을 읽지 못했습니다.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), cmtLen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    if (name === 'word/document.xml') {
      const lnl = buf.readUInt16LE(local + 26), lel = buf.readUInt16LE(local + 28);
      const data = buf.slice(local + 30 + lnl + lel, local + 30 + lnl + lel + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
      return xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n').trim();
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error('Word 파일에서 글을 찾지 못했습니다.');
}

async function generate(type, options, ctx) {
  if (!M.typeOf(type)) throw new Error('모르는 자료 종류입니다.');
  if (!ctx || !String(ctx.sermon || '').trim()) throw new Error('설교 원고가 비어 있습니다.');
  const provider = llm.activeProvider();
  if (!provider) throw Object.assign(new Error('AI 가 연결되어 있지 않습니다. 오른쪽 위 [AI 연결]에서 챗GPT·클로드·제미나이 중 하나를 연결해 주세요.'), { code: 'no_provider' });
  const system = M.buildSystem({ ...ctx, options });
  const request = M.buildRequest(type, options);
  const messages = [{ role: 'user', content: request }];
  const t0 = Date.now();
  const first = await llm.complete(provider, { system, messages });
  try {
    return { data: M.parse(type, first.text), provider, ms: Date.now() - t0 };
  } catch (e) {
    if (e.code !== 'format') throw e;
    const fix = await llm.complete(provider, { system, messages: messages.concat([
      { role: 'assistant', content: String(first.text || '').slice(0, 12000) },
      { role: 'user', content: '방금 답은 JSON 형식이 잘못되었거나 비어 있습니다. 같은 내용을 요청한 JSON 하나로만 다시 쓰세요. 문자열 안 따옴표는 \\", 줄바꿈은 \\n.' },
    ]) });
    return { data: M.parse(type, fix.text), provider, ms: Date.now() - t0 };
  }
}

/** 파일 쓰기 실패(열려 있는 파일·권한)를 알아보기 쉬운 말로 */
function writeFileFriendly(f, data) {
  try { fs.writeFileSync(f, data); } catch (e) {
    const why = e && e.code === 'EBUSY' || e && e.code === 'EPERM' || e && e.code === 'EACCES' ? '같은 이름의 파일이 다른 프로그램에서 열려 있거나 쓸 수 없는 위치입니다. 파일을 닫거나 다른 이름·폴더로 저장해 주세요.' : (e && e.code === 'ENOSPC' ? '저장 공간이 부족합니다.' : String(e && e.message || e));
    throw new Error('저장하지 못했습니다. ' + why);
  }
}
/** 이미 있는 파일을 덮어쓰지 않게 '이름 (2)' 로 */
function freeBase(folder, base, count) {
  const has = (b) => { for (let i = 1; i <= count; i++) if (fs.existsSync(path.join(folder, `${b}_${String(i).padStart(2, '0')}.png`))) return true; return false; };
  if (!has(base)) return base;
  for (let n = 2; n < 100; n++) if (!has(`${base} (${n})`)) return `${base} (${n})`;
  return base + ' ' + Date.now();
}
function safeName(s) { return String(s || '자료').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || '자료'; }

function initMaterials() {
  ipcMain.handle('materials:generate', (_e, type, options, ctx) => generate(String(type), options || {}, ctx || {}));
  // 유튜브 대화에서 불러온 설교 전체 자막 (AI 가 설교 범위를 찾았으면 그 범위)
  ipcMain.handle('materials:sermon', () => {
    const src = llm.sermonSource ? llm.sermonSource() : null;
    if (!src || !src.words.length) return null;
    return { url: src.url, title: src.title, text: M.sermonText(src.words), whole: src.whole, minutes: Math.round((src.words[src.words.length - 1].end - src.words[0].start) / 60) };
  });
  ipcMain.handle('materials:readFile', async (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(w, { title: '설교 원고 불러오기', properties: ['openFile'], filters: [{ name: '설교 원고', extensions: ['txt', 'md', 'docx', 'srt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const f = r.filePaths[0];
    const buf = fs.readFileSync(f);
    if (buf.length > 20 * 1024 * 1024) throw new Error('파일이 너무 큽니다 (20MB 이하).');
    let text;
    if (/\.docx$/i.test(f)) text = docxText(buf);
    else {
      text = buf.toString('utf8').replace(/^\uFEFF/, '');
      // 윈도우 메모장 옛 저장(ANSI=CP949) 한글 파일은 깨져 보이므로 한 번 더 시도
      if (text.includes('\uFFFD')) { try { const alt = new TextDecoder('euc-kr').decode(buf); if ((alt.match(/\uFFFD/g) || []).length < (text.match(/\uFFFD/g) || []).length) text = alt; } catch (_) { /* */ } }
      if (/\.srt$/i.test(f)) text = text.replace(/^\d+\s*$/gm, '').replace(/^[\d:,]+\s*-->\s*[\d:,]+\s*$/gm, '').replace(/\n{2,}/g, '\n');
    }
    return { name: path.basename(f), text: text.trim().slice(0, 200000) };
  });
  ipcMain.handle('materials:pdf', async (event, { body, css, name }) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showSaveDialog(w, { title: 'PDF 로 저장', defaultPath: safeName(name) + '.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    const pdf = await toPdf(String(body), String(css || ''));
    writeFileFriendly(r.filePath, pdf);
    return r.filePath;
  });
  ipcMain.handle('materials:print', async (_e, { body, css }) => {
    const file = writeDoc(String(body), String(css || ''));
    const win = new BrowserWindow({ show: false, width: 820, height: 1160, webPreferences: { sandbox: true, contextIsolation: true } });
    await win.loadFile(file);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => 1)');
    return new Promise((resolve) => win.webContents.print({ printBackground: true }, (ok, reason) => {
      if (!win.isDestroyed()) win.destroy();
      fs.promises.unlink(file).catch(() => {});
      resolve({ ok, reason: reason || '' });
    }));
  });
  // 카드 그림 여러 장 → 고른 폴더에 PNG
  ipcMain.handle('materials:png', async (event, { items, css, name }) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    const r = await dialog.showOpenDialog(w, { title: '카드 그림을 저장할 폴더', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const out = [];
    name = freeBase(r.filePaths[0], safeName(name), items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const png = await toPng(String(it.body), String(css || ''), it.width | 0 || 1080, it.height | 0 || 1350);
      const f = path.join(r.filePaths[0], `${name}_${String(i + 1).padStart(2, '0')}.png`);
      writeFileFriendly(f, png);
      out.push(f);
    }
    return { folder: r.filePaths[0], files: out };
  });
  ipcMain.handle('materials:openPath', (_e, p) => shell.showItemInFolder(String(p)));
  // 설교 PPT (.pptx)
  ipcMain.handle('materials:pptx', async (event, { data, meta, design, sceneData, name, file }) => {
    let target = file && process.env.SS_TEST_SCRIPT ? String(file) : null; // 시험에서는 정한 경로로
    if (!target) {
      const w = BrowserWindow.fromWebContents(event.sender);
      const r = await dialog.showSaveDialog(w, { title: '설교 PPT 로 저장', defaultPath: safeName(name) + '.pptx', filters: [{ name: 'PowerPoint', extensions: ['pptx'] }] });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    const buf = await require('./materials-pptx').buildPptx(data, meta, { design, sceneData });
    writeFileFriendly(target, buf);
    return target;
  });
  // 글 파일 저장 (홈페이지 말씀 요약 .md 등)
  ipcMain.handle('materials:saveText', async (event, { text, name, ext, title, file }) => {
    let target = file && process.env.SS_TEST_SCRIPT ? String(file) : null;
    if (!target) {
      const w = BrowserWindow.fromWebContents(event.sender);
      ext = String(ext || 'md').replace(/[^a-z0-9]/gi, '') || 'md';
      const r = await dialog.showSaveDialog(w, { title: title || '저장', defaultPath: safeName(String(name || '자료').replace(/\.[a-z0-9]+$/i, '')) + '.' + ext, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    writeFileFriendly(target, Buffer.from(String(text || ''), 'utf8'));
    return target;
  });
  // 시험용: 대화 상자 없이 정해진 경로로 (캐시 폴더 안만)
  ipcMain.handle('materials:renderTest', async (_e, { kind, body, css, width, height, file }) => {
    const target = require('./fs-guard').check(file);
    const data = kind === 'pdf' ? await toPdf(String(body), String(css || '')) : await toPng(String(body), String(css || ''), width, height);
    fs.writeFileSync(target, data);
    return target;
  });
}

module.exports = { initMaterials, docxText, toPdf, toPng, generate };
void chatPlan;
