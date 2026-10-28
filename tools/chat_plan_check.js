// 대화형 편집 점검: json3 자막 → 프롬프트 → (클로드/제미나이) → 계획 해석. 사용: node tools/chat_plan_check.js <json3> <provider> "<요청>" ["<두번째 요청>"]
'use strict';
const fs = require('fs');
const cp = require('../src/shared/chat-plan');
const claude = require('../src/main/llm/claude');

async function main() {
  const [file, provider = 'claude', ...requests] = process.argv.slice(2);
  const { words, lines } = cp.wordsFromJson3(JSON.parse(fs.readFileSync(file, 'utf8')));
  let sermon = null, plan = null;
  const history = [];
  for (const req of requests) {
    const range = sermon ? { start: words[sermon.from].start - 30, end: words[sermon.to].end + 30 } : null;
    const system = cp.buildSystemPrompt({ church: '구세군대구사랑영문', speaker: '담임사관 차재수' }) + '\n\n[설교 자막]\n' + cp.transcriptText(words, lines, range);
    const current = plan ? { title: plan.title, segments: cp.describeRanges(plan.ranges, words) } : null;
    const msg = cp.buildUserMessage(req, { current, durationSec: plan ? cp.rangesDuration(plan.ranges, words) : 0 });
    const t0 = Date.now();
    const { text } = await claude.complete({ system, messages: history.concat([{ role: 'user', content: msg }]) });
    const p = cp.parsePlan(text);
    const r = cp.resolvePlan(p, words);
    if (p.sermon && p.sermon.to > p.sermon.from) sermon = { from: p.sermon.from, to: p.sermon.to };
    plan = { title: p.title, ranges: r.ranges };
    history.push({ role: 'user', content: req }, { role: 'assistant', content: JSON.stringify({ reply: p.reply, segments: r.ranges }) });
    console.log(`\n=== 요청: ${req} (${((Date.now() - t0) / 1000).toFixed(0)}초, 시스템 ${system.length}자) ===`);
    console.log('답:', p.reply, '| 제목:', p.title, '| 본문:', p.verse, '| tighten:', p.tighten, '| sermon:', JSON.stringify(p.sermon));
    console.log('길이 약', Math.round(cp.rangesDuration(r.ranges, words)), '초, 구간', r.ranges.length, r.warnings.join('; '));
    for (const g of r.ranges) {
      const t = words.slice(g.from, g.to + 1).map((w) => w.text).join(' ');
      console.log(` [${cp.fmtTime(words[g.from].start)}~${cp.fmtTime(words[g.to].end)}] ${t}`);
    }
  }
}
main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
