/* 교인 자료 문서 그리기 (A4 인쇄 자료와 1080×1350 묵상카드). 화면 미리보기와 PDF·PNG 내보내기가 같은 HTML·CSS 를 쓴다.
 * 디자인: 만나로 스튜디오처럼 남색 머리띠(빛나는 십자가) · 흰 바탕 · 둥근 회청색 칸 · 파란 표시 */
(function () {
  'use strict';
  const SS = (window.SS = window.SS || {});
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const br = (v) => esc(v).replace(/\n/g, '<br>');

  const DOC_CSS = `
*{box-sizing:border-box} body{margin:0;background:#fff;font-family:'Pretendard','Malgun Gothic',sans-serif;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:0}
.doc{width:794px;min-height:1123px;background:#fff;position:relative;padding:0 0 70px;font-size:14.5px;line-height:1.7;letter-spacing:-.1px;word-break:keep-all}
.doc .dh{position:relative;overflow:hidden;color:#fff;padding:46px 56px 40px;background:linear-gradient(135deg,#0a1626 0%,#13294b 55%,#1d3d6e 100%)}
.doc .dh::before{content:'';position:absolute;right:92px;top:-30px;width:16px;height:230px;border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,.0),rgba(255,255,255,.55) 35%,rgba(255,255,255,.12));box-shadow:0 0 40px 10px rgba(147,197,253,.18)}
.doc .dh::after{content:'';position:absolute;right:42px;top:44px;width:116px;height:14px;border-radius:7px;background:linear-gradient(90deg,rgba(255,255,255,.08),rgba(255,255,255,.55),rgba(255,255,255,.08));box-shadow:0 0 40px 10px rgba(147,197,253,.16)}
.doc .dh-top{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;color:#bcd0ee;position:relative}
.doc .dh-kind{display:inline-block;padding:4px 12px;border-radius:999px;background:rgba(96,165,250,.2);border:1px solid rgba(147,197,253,.35);color:#dbeafe;font-weight:700}
.doc .dh-dot{width:6px;height:6px;border-radius:50%;background:#c8102e;display:inline-block}
.doc .dh-title{position:relative;margin:16px 0 10px;font-size:34px;line-height:1.3;font-weight:800;letter-spacing:-.8px;max-width:600px}
.doc .dh-sub{position:relative;font-size:14.5px;color:#cfe0f7;display:flex;flex-wrap:wrap;gap:6px 14px}
.doc .dh-sub .v{color:#93c5fd;font-weight:700}
.doc .db{padding:34px 56px 0}
.doc .sec{margin:0 0 22px;break-inside:avoid}
.doc .lbl{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:#eaf1fe;color:#1d4ed8;font-size:12.5px;font-weight:800;margin-bottom:10px}
.doc .box{background:#f5f7fb;border:1px solid #e6ebf2;border-radius:18px;padding:18px 22px}
.doc .box.blue{background:#eef4ff;border-color:#d6e3fb}
.doc .quote{position:relative;padding:22px 26px 22px 30px;border-radius:18px;background:linear-gradient(135deg,#eef4ff,#f8fbff);border:1px solid #d6e3fb;font-size:20px;font-weight:800;line-height:1.5;color:#1e3a8a;letter-spacing:-.4px}
.doc .quote::before{content:'';position:absolute;left:0;top:18px;bottom:18px;width:5px;border-radius:0 4px 4px 0;background:#2563eb}
.doc .pt{display:flex;gap:16px;margin-bottom:16px;break-inside:avoid}
.doc .pt-n{flex:0 0 40px;height:40px;border-radius:13px;background:#0f1b33;color:#fff;display:grid;place-items:center;font-weight:800;font-size:15px}
.doc .pt-h{font-size:17px;font-weight:800;margin:6px 0 4px;letter-spacing:-.3px}
.doc .pt-b{color:#334155}
.doc .q{display:flex;gap:14px;margin-bottom:14px;break-inside:avoid}
.doc .q-n{flex:0 0 30px;height:30px;border-radius:50%;background:#2563eb;color:#fff;display:grid;place-items:center;font-weight:800;font-size:13.5px;margin-top:2px}
.doc .q-t{font-weight:700;font-size:15.5px}
.doc .q-note{font-size:13px;color:#64748b;margin-top:3px}
.doc .lines{margin-top:8px}
.doc .lines i{display:block;height:28px;border-bottom:1.5px dotted #c9d3e1}
.doc .day{border:1px solid #e3e9f2;border-radius:20px;padding:20px 24px;margin-bottom:18px;break-inside:avoid}
.doc .day-h{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.doc .day-n{padding:4px 11px;border-radius:9px;background:#0f1b33;color:#fff;font-size:12.5px;font-weight:800;letter-spacing:.3px}
.doc .day-t{font-size:17px;font-weight:800}
.doc .day-p{margin-left:auto;font-size:13px;font-weight:700;color:#1d4ed8;background:#eaf1fe;padding:3px 10px;border-radius:999px}
.doc .key{margin:10px 0;padding:10px 14px;border-radius:12px;background:#fff8e6;border:1px solid #fde7b0;color:#92400e;font-weight:700}
.doc .sm{font-size:13.5px;color:#475569}
.doc .qz{display:flex;gap:14px;margin-bottom:16px;break-inside:avoid}
.doc .ox{display:flex;gap:10px;margin-top:8px}
.doc .ox span{width:44px;height:36px;border-radius:10px;border:1.5px solid #cbd5e1;display:grid;place-items:center;font-weight:800;color:#64748b}
.doc .ch{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin-top:8px;color:#334155}
.doc .ch span::before{content:attr(data-n);display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;border:1.5px solid #94a3b8;font-size:12px;font-weight:800;margin-right:8px;color:#475569}
.doc .ans{margin-top:26px;padding:16px 20px;border-radius:16px;border:1.5px dashed #cbd5e1;font-size:13px;color:#475569;break-inside:avoid}
.doc .ans b{color:#0f172a}
.doc .step{display:flex;gap:16px;margin-bottom:14px;break-inside:avoid}
.doc .step-n{flex:0 0 66px;text-align:center;padding:6px 0;border-radius:12px;background:#eef4ff;color:#1d4ed8;font-size:12.5px;font-weight:800;height:fit-content}
.doc .step-b{flex:1}
.doc .df{position:absolute;left:56px;right:56px;bottom:26px;display:flex;justify-content:space-between;font-size:11.5px;color:#94a3b8;border-top:1px solid #edf1f6;padding-top:10px}
/* 묵상카드 1080x1350 */
.mcard{width:1080px;height:1350px;position:relative;overflow:hidden;font-family:'Pretendard',sans-serif;word-break:keep-all;display:flex;flex-direction:column;padding:120px 110px 110px}
.mcard .c-top{display:flex;align-items:center;gap:16px;font-size:30px;font-weight:700;letter-spacing:-.2px}
.mcard .c-cross{width:46px;height:46px;position:relative;flex:0 0 46px}
.mcard .c-cross::before{content:'';position:absolute;left:20px;top:0;width:7px;height:46px;border-radius:3px;background:currentColor}
.mcard .c-cross::after{content:'';position:absolute;left:8px;top:12px;width:31px;height:7px;border-radius:3px;background:currentColor}
.mcard .c-mid{margin:auto 0;padding:40px 0}
.mcard .c-head{font-size:76px;line-height:1.32;font-weight:800;letter-spacing:-2px}
.mcard .c-body{margin-top:40px;font-size:38px;line-height:1.6;font-weight:500;letter-spacing:-.5px}
.mcard .c-src{display:inline-block;margin-top:40px;font-size:30px;font-weight:700;padding:10px 26px;border-radius:999px}
.mcard .c-foot{display:flex;justify-content:space-between;align-items:center;font-size:26px;font-weight:600;opacity:.8}
.mcard.navy{color:#fff;background:linear-gradient(160deg,#0a1626 0%,#13294b 55%,#1d3d6e 100%)}
.mcard.navy::before{content:'';position:absolute;right:170px;top:-80px;width:26px;height:560px;border-radius:13px;background:linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,.4) 40%,rgba(255,255,255,.05));box-shadow:0 0 90px 30px rgba(147,197,253,.16)}
.mcard.navy::after{content:'';position:absolute;right:76px;top:110px;width:214px;height:24px;border-radius:12px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.4),rgba(255,255,255,.05));box-shadow:0 0 80px 26px rgba(147,197,253,.14)}
.mcard.navy .c-top{color:#bcd0ee} .mcard.navy .c-src{background:rgba(96,165,250,.2);color:#dbeafe;border:2px solid rgba(147,197,253,.35)} .mcard.navy .c-body{color:#d6e4f7}
.mcard.paper{color:#2b2620;background:#f7f2e8}
.mcard.paper::before{content:'';position:absolute;inset:44px;border:3px solid #e2d6c0;border-radius:36px;pointer-events:none}
.mcard.paper .c-top{color:#8a6d3b} .mcard.paper .c-src{background:#efe4cf;color:#6b5427} .mcard.paper .c-head{color:#2b2620}
.mcard.sky{color:#0f172a;background:linear-gradient(170deg,#e4efff 0%,#f6f9ff 55%,#ffffff 100%)}
.mcard.sky::before{content:'';position:absolute;right:-160px;top:-160px;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle,rgba(96,165,250,.35),rgba(96,165,250,0) 70%)}
.mcard.sky .c-top{color:#2563eb} .mcard.sky .c-src{background:#2563eb;color:#fff} .mcard.sky .c-body{color:#334155}
.mcard.scene{color:#fff;background:#111 center/cover no-repeat}
.mcard.scene::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,.25) 40%,rgba(0,0,0,.78) 100%)}
.mcard.scene>*{position:relative} .mcard.scene .c-src{background:rgba(255,255,255,.16);border:2px solid rgba(255,255,255,.35)}
`;

  const DESIGNS = [
    { id: 'navy', label: '새벽 남색', swatch: 'linear-gradient(160deg,#0a1626,#1d3d6e)' },
    { id: 'paper', label: '종이', swatch: '#f7f2e8' },
    { id: 'sky', label: '하늘', swatch: 'linear-gradient(170deg,#e4efff,#ffffff)' },
    { id: 'scene', label: '영상 장면', swatch: 'linear-gradient(180deg,#555,#111)' },
  ];

  /** 고칠 수 있는 칸 (화면에서만 contenteditable; 내보낼 때는 지운다) */
  function ed(path, text, tag, cls) {
    tag = tag || 'div';
    return `<${tag} class="${cls || ''} mn-ed" contenteditable="true" spellcheck="false" data-path="${esc(path)}">${br(text)}</${tag}>`;
  }
  const lines = (n) => `<div class="lines">${'<i></i>'.repeat(n)}</div>`;

  function head(kind, d, m) {
    const sub = [];
    const verse = d.verse || m.verse;
    if (verse) sub.push(`<span class="v">${esc(verse)}</span>`);
    if (m.speaker) sub.push(`<span>${esc(m.speaker)}</span>`);
    if (m.date) sub.push(`<span>${esc(m.date)}</span>`);
    return `<header class="dh"><div class="dh-top">${m.church ? `<span class="dh-dot"></span><span>${esc(m.church)}</span>` : ''}<span class="dh-kind">${esc(kind)}</span></div>`
      + ed('title', d.title || m.title || kind, 'h1', 'dh-title') + `<div class="dh-sub">${sub.join('')}</div></header>`;
  }
  function foot(m) { return `<footer class="df"><span>${esc(m.church || '')}</span><span>${esc((m.title || '').replace(/\*/g, '').replace(/\s+\/\s+/g, ' '))}</span></footer>`; }

  const PAGES = {
    summary(d, m) {
      let h = head('설교 요약', d, m) + '<main class="db">';
      if (d.theme) h += `<section class="sec">${ed('theme', d.theme, 'div', 'quote')}</section>`;
      d.points.forEach((p, i) => { h += `<div class="pt"><div class="pt-n">${String(i + 1).padStart(2, '0')}</div><div>${ed(`points.${i}.heading`, p.heading, 'div', 'pt-h')}${ed(`points.${i}.body`, p.body, 'div', 'pt-b')}</div></div>`; });
      if (d.application) h += `<section class="sec"><span class="lbl">삶의 적용</span><div class="box blue">${ed('application', d.application)}</div></section>`;
      if (d.prayer) h += `<section class="sec"><span class="lbl">함께 드리는 기도</span><div class="box">${ed('prayer', d.prayer)}</div></section>`;
      return h + '</main>' + foot(m);
    },
    smallgroup(d, m) {
      let h = head('소그룹 나눔', d, m) + '<main class="db">';
      if (d.summary) h += `<section class="sec"><span class="lbl">말씀 요약</span><div class="box">${ed('summary', d.summary)}</div></section>`;
      if (d.icebreaker) h += `<section class="sec"><span class="lbl">마음 열기</span><div class="box blue">${ed('icebreaker', d.icebreaker)}</div></section>`;
      h += '<section class="sec"><span class="lbl">나눔 질문</span>';
      d.questions.forEach((q, i) => { h += `<div class="q"><div class="q-n">${i + 1}</div><div style="flex:1">${ed(`questions.${i}.q`, q.q, 'div', 'q-t')}${q.note ? ed(`questions.${i}.note`, q.note, 'div', 'q-note') : ''}${lines(2)}</div></div>`; });
      h += '</section>';
      if (d.action) h += `<section class="sec"><span class="lbl">이번 주 실천</span><div class="box blue">${ed('action', d.action)}</div></section>`;
      if (d.prayer) h += `<section class="sec"><span class="lbl">함께 드리는 기도</span><div class="box">${ed('prayer', d.prayer)}</div></section>`;
      return h + '</main>' + foot(m);
    },
    qt(d, m) {
      let h = head('QT · ' + d.days.length + '일', d, m) + '<main class="db">';
      d.days.forEach((x, i) => {
        h += `<div class="day"><div class="day-h"><span class="day-n">DAY ${i + 1}</span>${ed(`days.${i}.title`, x.title, 'span', 'day-t')}${x.passage ? ed(`days.${i}.passage`, x.passage, 'span', 'day-p') : ''}</div>`;
        if (x.meditation) h += ed(`days.${i}.meditation`, x.meditation);
        if (x.keyline) h += ed(`days.${i}.keyline`, x.keyline, 'div', 'key');
        if (x.question) h += `<div style="margin-top:8px"><b>묵상 질문</b> ${ed(`days.${i}.question`, x.question, 'span')}</div>${lines(2)}`;
        if (x.action) h += `<div class="sm" style="margin-top:8px"><b>오늘의 실천</b> ${ed(`days.${i}.action`, x.action, 'span')}</div>`;
        if (x.prayer) h += `<div class="sm" style="margin-top:6px"><b>기도</b> ${ed(`days.${i}.prayer`, x.prayer, 'span')}</div>`;
        h += '</div>';
      });
      return h + '</main>' + foot(m);
    },
    quiz(d, m) {
      let h = head('성경 퀴즈', d, m) + '<main class="db">';
      d.items.forEach((it, i) => {
        h += `<div class="qz"><div class="q-n">${i + 1}</div><div style="flex:1">${ed(`items.${i}.q`, it.q, 'div', 'q-t')}`;
        if (it.type === 'ox') h += '<div class="ox"><span>O</span><span>X</span></div>';
        else h += `<div class="ch">${it.choices.map((c, k) => `<span data-n="${k + 1}">${ed(`items.${i}.choices.${k}`, c, 'span')}</span>`).join('')}</div>`;
        h += '</div></div>';
      });
      h += `<div class="ans"><b>정답과 해설</b><br>${d.items.map((it, i) => `${i + 1}. <b>${esc(it.answer)}</b> ${esc(it.explain)}`).join('<br>')}</div>`;
      return h + '</main>' + foot(m);
    },
    family(d, m) {
      let h = head('가정예배', d, m) + '<main class="db">';
      const steps = [];
      if (d.opening) steps.push(['찬양', ed('opening', d.opening)]);
      steps.push(['말씀 읽기', `<b>${esc(d.verse || m.verse || '')}</b> <span class="sm">가족이 돌아가며 한 절씩 읽어요</span>`]);
      if (d.story) steps.push(['말씀 이야기', ed('story', d.story)]);
      if (d.questions.length) steps.push(['함께 나누기', d.questions.map((q, i) => `<div class="q" style="margin:4px 0"><div class="q-n">${i + 1}</div>${ed(`questions.${i}`, q, 'div', 'q-t')}</div>`).join('')]);
      if (d.activity) steps.push(['함께 해 보기', ed('activity', d.activity)]);
      if (d.prayer) steps.push(['기도', ed('prayer', d.prayer)]);
      if (d.blessing) steps.push(['축복', ed('blessing', d.blessing, 'div', 'q-t')]);
      steps.forEach((s, i) => { h += `<div class="step"><div class="step-n">${i + 1}. ${s[0]}</div><div class="step-b">${s[1]}</div></div>`; });
      return h + '</main>' + foot(m);
    },
  };

  /** A4 자료 한 장 (HTML) */
  function page(type, d, m) { return `<article class="doc doc-${type}">${PAGES[type](d, m || {})}</article>`; }

  /** 묵상카드 한 장 (1080×1350) */
  function card(c, i, design, m, sceneUrl) {
    const style = design === 'scene' && sceneUrl ? ` style="background-image:url('${sceneUrl}')"` : '';
    return `<div class="mcard ${esc(design)}"${style}><div class="c-top"><span class="c-cross"></span><span>${esc(m.church || '오늘의 말씀')}</span></div>`
      + `<div class="c-mid">${ed(`cards.${i}.headline`, c.headline, 'div', 'c-head')}${c.body ? ed(`cards.${i}.body`, c.body, 'div', 'c-body') : ''}${c.source ? ed(`cards.${i}.source`, c.source, 'div', 'c-src') : ''}</div>`
      + `<div class="c-foot"><span>${esc((m.title || '').replace(/\*/g, '').replace(/\s+\/\s+/g, ' '))}</span><span>${esc(m.date || '')}</span></div></div>`;
  }

  /** 내보낼 HTML: 고치기 표시(contenteditable·테두리)를 뺀다 */
  function cleanForExport(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('[contenteditable]').forEach((x) => { x.removeAttribute('contenteditable'); x.removeAttribute('spellcheck'); x.classList.remove('mn-ed'); x.removeAttribute('data-path'); });
    c.style.transform = ''; c.classList.remove('mn-paper');
    return c.outerHTML;
  }

  SS.materialsDoc = { DOC_CSS, DESIGNS, page, card, cleanForExport, esc };
})();
