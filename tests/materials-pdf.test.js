'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfText, MAX_PAGES } = require('../src/main/materials-pdf');

// 합성 PDF: pages = [[{x,y,text}...], ...]; 표준 Helvetica(ASCII)만 사용
function makePdf(pages, { encrypt = false } = {}) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // pages placeholder
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const items of pages) {
    const body = items.length
      ? 'BT /F1 12 Tf ' + items.map((i) => `1 0 0 1 ${i.x ?? 72} ${i.y} Tm (${i.text}) Tj`).join(' ') + ' ET'
      : '';
    const c = add(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    const p = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    kids.push(`${p} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  let enc = '';
  if (encrypt) {
    // R2 표준 보안 사전. 틀린 빈 암호를 거절하는 실제 암호 PDF 구조.
    const id = '00112233445566778899aabbccddeeff';
    const n = objs.length + 1;
    offs.push(pdf.length);
    pdf += n + ' 0 obj\n<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <' + '00'.repeat(32) + '> /U <' + '11'.repeat(32) + '> >>\nendobj\n';
    objs.push('encrypted');
    enc = '/Encrypt ' + n + ' 0 R /ID [<' + id + '><' + id + '>] ';
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R ${enc}>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

test('페이지 순서와 줄바꿈을 지켜 텍스트를 읽는다', async () => {
  const buf = makePdf([
    [{ y: 700, text: 'Hello line one' }, { y: 680, text: 'second line' }, { y: 600, text: 'new paragraph' }],
    [{ y: 700, text: 'Page two text' }],
  ]);
  const t = await pdfText(buf);
  assert.match(t, /Hello line one\nsecond line\n\nnew paragraph/);
  assert.ok(t.indexOf('Hello') < t.indexOf('Page two'));
});

test('빈 페이지가 섞여도 글자 있는 쪽만 읽는다', async () => {
  const t = await pdfText(makePdf([[], [{ y: 700, text: 'only text' }], []]));
  assert.equal(t, 'only text');
});

test('글자가 없는 PDF(스캔본 등)는 OCR 미지원 안내를 한다', async () => {
  await assert.rejects(pdfText(makePdf([[], []])), /읽을 수 있는 글자가 없습니다.*OCR.*하지 않/s);
});

test('손상/비 PDF는 안내 오류', async () => {
  await assert.rejects(pdfText(Buffer.from('not a pdf at all')), /손상|PDF/);
  await assert.rejects(pdfText(Buffer.alloc(0)), /비어/);
});

test('20MB 초과는 거절', async () => {
  await assert.rejects(pdfText(Buffer.alloc(20 * 1024 * 1024 + 1)), /20MB/);
});

test('300쪽 초과는 거절', async () => {
  const pages = Array.from({ length: MAX_PAGES + 1 }, () => [{ y: 700, text: 'x' }]);
  await assert.rejects(pdfText(makePdf(pages)), /300쪽/);
});

test('암호 PDF는 안내 오류', async () => {
  await assert.rejects(pdfText(makePdf([[{ y: 700, text: 'locked' }]], { encrypt: true })), /암호가 걸린 PDF/);
});
