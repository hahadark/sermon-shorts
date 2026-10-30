'use strict';
// 설교 PPT: 교인 자료의 '설교 PPT' 데이터 → 16:9 파워포인트(.pptx). 글자는 모두 고칠 수 있는 글상자로 넣는다.
// 글꼴은 교회 컴퓨터에 대부분 있는 '맑은 고딕'(맥은 Apple SD 고딕 Neo 로 대체됨). 라이브러리: pptxgenjs (MIT)
const PptxGenJS = require('pptxgenjs');

const THEMES = {
  navy: { bg: '13294B', bg2: '0A1626', text: 'FFFFFF', sub: 'BCD0EE', accent: '60A5FA', line: '2B4C7E' },
  paper: { bg: 'F7F2E8', bg2: 'EFE4CF', text: '2B2620', sub: '8A6D3B', accent: 'B7791F', line: 'E2D6C0' },
  sky: { bg: 'F4F8FF', bg2: 'E4EFFF', text: '0F172A', sub: '2563EB', accent: '2563EB', line: 'C7D7F5' },
  scene: { bg: '111111', bg2: '000000', text: 'FFFFFF', sub: 'E5E7EB', accent: 'FBBF24', line: '444444' },
};
const FONT = 'Malgun Gothic';
// 파워포인트는 한글을 글자 단위로 줄 바꿈해서 단어 가운데가 잘린다 → 긴 글은 가운데 가까운 띄어쓰기에서 미리 나눈다
function balance(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max || t.indexOf('\n') >= 0) return t;
  const mid = t.length / 2; let best = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best > 0 ? t.slice(0, best) + '\n' + t.slice(best + 1) : t;
}
const W = 13.333, H = 7.5;

/**
 * d: { title, verse, slides:[{heading, lines[], ref}], closing }
 * meta: { church, speaker, date, title, verse }
 * opts: { design, sceneData(dataURL, 선택) }
 * 돌려줌: Buffer (pptx)
 */
async function buildPptx(d, meta, opts) {
  d = d || {}; meta = meta || {}; opts = opts || {};
  const th = THEMES[opts.design] || THEMES.navy;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = meta.church || 'SermonShorts';
  pptx.title = String(meta.title || d.title || '설교').replace(/\*/g, '').replace(/\s+\/\s+/g, ' ');
  const title = pptx.title;
  const verse = d.verse || meta.verse || '';
  const scene = opts.design === 'scene' && /^data:image\//.test(opts.sceneData || '') ? opts.sceneData : null;

  const base = (s) => {
    if (scene) {
      s.addImage({ data: scene, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H } });
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: '000000', transparency: 38 }, line: { color: '000000', transparency: 100 } });
    } else s.background = { color: th.bg };
    if (meta.church) s.addText(meta.church, { x: 0.6, y: H - 0.65, w: 6, h: 0.4, fontFace: FONT, fontSize: 14, color: th.sub, bold: true });
    if (title) s.addText(title, { x: W - 6.6, y: H - 0.65, w: 6, h: 0.4, fontFace: FONT, fontSize: 14, color: th.sub, align: 'right' });
  };

  // 1) 제목
  let s = pptx.addSlide(); base(s);
  s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.05, w: 0.12, h: 2.2, fill: { color: th.accent }, line: { color: th.accent } });
  s.addText(balance(title || '설교', 18), { x: 0.95, y: 1.9, w: W - 1.8, h: 1.6, fontFace: FONT, fontSize: 48, bold: true, color: th.text, valign: 'middle', fit: 'shrink' });
  const sub = [verse, meta.speaker, meta.date].filter(Boolean).join('   ·   ');
  if (sub) s.addText(sub, { x: 0.95, y: 3.5, w: W - 1.8, h: 0.8, fontFace: FONT, fontSize: 24, color: th.sub });

  // 2) 본론
  (d.slides || []).forEach((sl, i) => {
    s = pptx.addSlide(); base(s);
    s.addText(String(i + 1).padStart(2, '0'), { x: 0.6, y: 0.55, w: 1.2, h: 0.7, fontFace: FONT, fontSize: 26, bold: true, color: th.accent });
    s.addText(balance(sl.heading || '', 24), { x: 0.6, y: 1.15, w: W - 1.2, h: 1.1, fontFace: FONT, fontSize: 40, bold: true, color: th.text, fit: 'shrink' });
    s.addShape(pptx.ShapeType.line, { x: 0.6, y: 2.35, w: 2.2, h: 0, line: { color: th.accent, width: 3 } });
    const lines = (sl.lines || []).filter(Boolean);
    if (lines.length) {
      s.addText(lines.map((t) => ({ text: t, options: { bullet: { indent: 24 }, paraSpaceAfter: 14 } })),
        { x: 0.6, y: 2.65, w: W - 1.2, h: 3.4, fontFace: FONT, fontSize: 30, color: th.text, valign: 'top', lineSpacingMultiple: 1.15, fit: 'shrink' });
    }
    if (sl.ref) s.addText(sl.ref, { x: W - 5.6, y: H - 1.35, w: 5, h: 0.5, fontFace: FONT, fontSize: 20, color: th.sub, align: 'right', bold: true });
  });

  // 3) 마무리
  if (d.closing) {
    s = pptx.addSlide(); base(s);
    s.addText(balance(d.closing, 20), { x: 1, y: 2.2, w: W - 2, h: 2.4, fontFace: FONT, fontSize: 40, bold: true, color: th.text, align: 'center', valign: 'middle', fit: 'shrink' });
    if (verse) s.addText(verse, { x: 1, y: 4.7, w: W - 2, h: 0.6, fontFace: FONT, fontSize: 22, color: th.sub, align: 'center' });
  }
  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { buildPptx, THEMES };
