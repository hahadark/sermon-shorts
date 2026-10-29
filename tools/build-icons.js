// assets/icons/*.svg (Lucide, ISC) → src/renderer/icons.css
// 아이콘은 CSS 마스크로 그린다: <button class="btn ico i-save">저장</button> 처럼 클래스만 붙이면 글자 앞에 아이콘이 나온다.
// 다른 스크립트가 버튼 글자를 바꿔도 아이콘은 그대로 남는다. 새 아이콘: assets/icons 에 SVG 를 넣고 `node tools/build-icons.js`.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'assets', 'icons');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();
let css = '/* 자동 생성: node tools/build-icons.js — 아이콘: Lucide (ISC License, https://lucide.dev) */\n';
css += '.ico::before{content:"";display:inline-block;flex:0 0 auto;width:16px;height:16px;background-color:currentColor;-webkit-mask:var(--ico) center/contain no-repeat;mask:var(--ico) center/contain no-repeat}\n';
css += '.ico.lg::before{width:18px;height:18px}.ico.xl::before{width:22px;height:22px}.ico.xs::before{width:14px;height:14px}\n';
for (const f of files) {
  const name = f.replace(/\.svg$/, '');
  const svg = fs.readFileSync(path.join(dir, f), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/\sclass="[^"]*"/g, '').replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim()
    .replace('stroke="currentColor"', 'stroke="#000"');
  css += `.i-${name}{--ico:url("data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}")}\n`;
}
fs.writeFileSync(path.join(root, 'src', 'renderer', 'icons.css'), css, 'utf8');
console.log('icons.css', files.length, 'icons', css.length, 'bytes');
