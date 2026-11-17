/* Rust 판 교인 자료 그리기: Electron 판 materials-doc.js 를 그대로 써서 같은 HTML 을 만든다 (헤드리스 Edge/Chrome 이 PDF·PNG 로).
 * window.__JOB = { kind: 'page'|'cards'|'news'|'slides', type, d, m, design, scene, visuals } */
(function () {
  'use strict';
  var J = window.__JOB, D = window.SS.materialsDoc;
  var st = document.createElement('style'); st.textContent = (J.fontCss || '') + D.DOC_CSS; document.head.appendChild(st);
  var html = '';
  if (J.kind === 'page') html = D.page(J.type, J.d, J.m);
  else if (J.kind === 'cards') html = J.d.cards.map(function (c, i) { return D.card(c, i, J.design, J.m, J.scene); }).join('');
  else if (J.kind === 'news') html = D.newsCards(J.d, J.design, J.m, J.scene).join('');
  else if (J.kind === 'slides') html = D.slides(J.d, J.design, J.m, J.scene).join('');
  document.body.innerHTML = html;
  // 카드별 디자인·사진 (기존 card-visuals.js mount 와 같게)
  var valid = function (s) { return typeof s === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(s); };
  if (J.visuals && (J.kind === 'cards' || J.kind === 'news')) {
    document.querySelectorAll('.mcard').forEach(function (card, i) {
      var p = J.visuals[i] || {};
      var design = valid(p.photo) && (!p.design || p.design === 'scene') ? 'scene' : (D.CARD_DESIGNS.some(function (d) { return d.id === p.design; }) ? p.design : J.design);
      D.CARD_DESIGNS.forEach(function (d) { card.classList.remove(d.id); });
      card.classList.add(design);
      if (design === 'scene' && valid(p.photo)) card.style.backgroundImage = 'url("' + p.photo + '")';
      else if (design !== 'scene') card.style.backgroundImage = '';
    });
  }
  // 내보낼 HTML: 고치기 표시를 뺀다 (기존 cleanForExport)
  document.querySelectorAll('[contenteditable]').forEach(function (x) { x.removeAttribute('contenteditable'); x.removeAttribute('spellcheck'); x.classList.remove('mn-ed'); x.removeAttribute('data-path'); });
  if (J.only != null) { var all = document.querySelectorAll('.mcard, .mslide'); all.forEach(function (x, i) { if (i !== J.only) x.remove(); }); }
})();