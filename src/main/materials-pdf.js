'use strict';
// PDF 설교 원고 텍스트 읽기. 기기 안에서만 처리(외부 전송·OCR 없음). pdfjs-dist(Apache-2.0).
const path = require('path');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 300;

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

function assetDir(name) {
  const root = path.dirname(require.resolve('pdfjs-dist/package.json'));
  return path.join(root, name).replace(/\\\\/g, '/') + '/';
}

function pageToText(items) {
  const lines = [];
  let cur = '', lastY = null, lastH = 0, lastEnd = null;
  const flush = (blank) => {
    if (cur.trim()) lines.push(cur.replace(/[ \t]+$/g, ''));
    cur = '';
    if (blank && lines.length && lines[lines.length - 1] !== '') lines.push('');
  };
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform ? it.transform[5] : 0;
    const x = it.transform ? it.transform[4] : 0;
    const h = Math.abs(it.height) || Math.abs(it.transform?.[3]) || 10;
    if (lastY !== null && Math.abs(y - lastY) > Math.max(h, lastH) * 0.5) {
      const gap = Math.abs(y - lastY);
      flush(gap > Math.max(h, lastH) * 1.9);
      lastEnd = null;
    }
    if (it.str) {
      // 같은 줄에서 간격이 크게 벌어지면 공백 하나
      if (cur && lastEnd !== null && x - lastEnd > h * 0.25 && !/\s$/.test(cur) && !/^\s/.test(it.str)) cur += ' ';
      cur += it.str;
      lastEnd = x + (it.width || 0);
      lastY = y; lastH = h;
    }
    if (it.hasEOL) { flush(false); lastEnd = null; }
  }
  flush(false);
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

async function pdfText(buffer) {
  if (!buffer || typeof buffer.length !== 'number' && typeof buffer.byteLength !== 'number') {
    throw new Error('PDF 파일 내용을 읽지 못했습니다.');
  }
  const size = buffer.byteLength ?? buffer.length;
  if (size === 0) throw new Error('PDF 파일이 비어 있습니다.');
  if (size > MAX_BYTES) throw new Error('PDF 파일이 너무 큽니다(최대 20MB). 필요한 부분만 나눠 올려 주세요.');
  const data = new Uint8Array(size);
  data.set(buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer);

  const pdfjs = await loadPdfjs();
  let task, doc;
  try {
    task = pdfjs.getDocument({
      data,
      cMapUrl: assetDir('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: assetDir('standard_fonts'),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    doc = await task.promise;
    if (doc.numPages > MAX_PAGES) {
      throw new Error(`PDF 쪽수가 너무 많습니다(${doc.numPages}쪽, 최대 ${MAX_PAGES}쪽). 나눠서 올려 주세요.`);
    }
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      out.push(pageToText(tc.items));
      page.cleanup();
    }
    const text = out.filter(Boolean).join('\n\n').trim();
    if (!text) {
      throw new Error('이 PDF에서 읽을 수 있는 글자가 없습니다. 이미지로 스캔된 PDF일 수 있습니다. 이 앱은 OCR(글자 인식)을 하지 않으니, 글자 선택이 되는 PDF나 텍스트/한글 파일로 올려 주세요.');
    }
    return text;
  } catch (e) {
    if (e && e.name === 'PasswordException') {
      throw new Error('암호가 걸린 PDF입니다. 암호를 해제한 파일로 다시 올려 주세요.');
    }
    if (e && (e.name === 'InvalidPDFException' || e.name === 'FormatError' || e.name === 'MissingPDFException' || e.name === 'UnknownErrorException')) {
      throw new Error('PDF 파일이 손상되었거나 PDF 형식이 아닙니다.');
    }
    throw e;
  } finally {
    try { if (doc) await doc.destroy(); else if (task) await task.destroy(); } catch {}
  }
}

module.exports = { pdfText, MAX_BYTES, MAX_PAGES };


