// 한글 문서에서 글만 꺼내기 (설교 원고 불러오기용). 외부 라이브러리 없이:
//  - .hwpx : zip 안의 Contents/section*.xml 의 <hp:t> 글
//  - .hwp  : 복합 문서(CFB) 안의 BodyText/Section* 스트림 → (압축이면 풀고) 문단 글 레코드(HWPTAG_PARA_TEXT)
// 암호가 걸렸거나 배포용 문서는 읽을 수 없다고 알린다.
const zlib = require('zlib');

// ---------------- HWPX ----------------
function xmlText(xml) {
  const out = [];
  // 문단(<hp:p>)마다 줄을 나누고, 그 안의 <hp:t> 글을 잇는다 (탭·줄바꿈 표시도)
  const paras = String(xml).split(/<hp:p[\s>]/).slice(1);
  for (const p of paras) {
    let line = '';
    const re = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>|<hp:t\s*\/>|<hp:(tab|lineBreak)\b[^>]*\/?>/g;
    let m;
    while ((m = re.exec(p))) {
      if (m[2] === 'tab') line += '\t';
      else if (m[2] === 'lineBreak') line += '\n';
      else if (m[1] != null) line += m[1].replace(/<hp:(tab)\b[^>]*\/>/g, '\t').replace(/<hp:lineBreak\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, '');
    }
    out.push(decodeXml(line));
  }
  return out.join('\n');
}
function decodeXml(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&'); }
async function hwpxText(buf) {
  const JSZip = require('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (_) { throw new Error('한글(HWPX) 파일을 열 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요.'); }
  const names = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  if (!names.length) throw new Error('한글(HWPX) 문서에서 본문을 찾지 못했습니다.');
  const parts = [];
  for (const n of names) parts.push(xmlText(await zip.file(n).async('string')));
  return tidy(parts.join('\n'));
}

// ---------------- HWP (CFB 복합 문서) ----------------
const ENDOFCHAIN = 0xFFFFFFFE, FREESECT = 0xFFFFFFFF;
function readCfb(buf) {
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xE011CFD0 || buf.readUInt32LE(4) !== 0xE11AB1A1) throw new Error('한글(HWP) 파일 형식이 아닙니다. 한글 2002 이후 문서(.hwp)나 .hwpx 를 골라 주세요.');
  const ss = 1 << buf.readUInt16LE(0x1E), mss = 1 << buf.readUInt16LE(0x20);
  const nFat = buf.readUInt32LE(0x2C), dirStart = buf.readUInt32LE(0x30), cutoff = buf.readUInt32LE(0x38);
  const miniFatStart = buf.readUInt32LE(0x3C), difatStart = buf.readUInt32LE(0x44), nDifat = buf.readUInt32LE(0x48);
  const sec = (n) => { const o = (n + 1) * ss; if (o + ss > buf.length + ss) throw new Error('한글(HWP) 파일이 손상되었습니다.'); return buf.subarray(o, Math.min(o + ss, buf.length)); };
  // FAT 섹터 목록 (헤더의 109개 + DIFAT 사슬)
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const v = buf.readUInt32LE(0x4C + i * 4); if (v !== FREESECT) fatSecs.push(v); }
  let d = difatStart;
  for (let k = 0; k < nDifat && d !== ENDOFCHAIN && d !== FREESECT; k++) {
    const s = sec(d), per = ss / 4 - 1;
    for (let i = 0; i < per && fatSecs.length < nFat; i++) { const v = s.readUInt32LE(i * 4); if (v !== FREESECT) fatSecs.push(v); }
    d = s.readUInt32LE(per * 4);
  }
  const fat = [];
  for (const f of fatSecs) { const s = sec(f); for (let i = 0; i < ss / 4; i++) fat.push(s.readUInt32LE(i * 4)); }
  const chain = (start, table) => { const out = []; let n = start, guard = 0; while (n !== ENDOFCHAIN && n !== FREESECT && n < table.length && guard++ < 1e6) { out.push(n); n = table[n]; } return out; };
  const readChain = (start) => Buffer.concat(chain(start, fat).map(sec));
  // 디렉터리
  const dirBuf = readChain(dirStart), dirs = [];
  for (let o = 0; o + 128 <= dirBuf.length; o += 128) {
    const nameLen = dirBuf.readUInt16LE(o + 64);
    dirs.push({ name: dirBuf.toString('utf16le', o, o + Math.max(0, nameLen - 2)), type: dirBuf[o + 66], left: dirBuf.readUInt32LE(o + 68), right: dirBuf.readUInt32LE(o + 72), child: dirBuf.readUInt32LE(o + 76), start: dirBuf.readUInt32LE(o + 116), size: dirBuf.readUInt32LE(o + 120) });
  }
  const root = dirs[0];
  const miniStream = root && root.type === 5 ? readChain(root.start) : Buffer.alloc(0);
  const miniFat = [];
  if (miniFatStart !== ENDOFCHAIN) { const mf = readChain(miniFatStart); for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i)); }
  const readStream = (e) => {
    if (e.size < cutoff) return Buffer.concat(chain(e.start, miniFat).map((n) => miniStream.subarray(n * mss, n * mss + mss))).subarray(0, e.size);
    return readChain(e.start).subarray(0, e.size);
  };
  // 경로 만들기: 자식은 child 에서 시작하는 left/right 나무
  const files = {};
  const walk = (id, prefix, depth) => {
    if (id === FREESECT || id >= dirs.length || depth > 64) return;
    const e = dirs[id];
    walk(e.left, prefix, depth + 1); walk(e.right, prefix, depth + 1);
    const p = prefix ? prefix + '/' + e.name : e.name;
    if (e.type === 2) files[p] = e;
    else if (e.type === 1) walk(e.child, p, depth + 1);
  };
  if (root) walk(root.child, '', 0);
  return { files, read: (p) => (files[p] ? readStream(files[p]) : null) };
}
/** 문단 글 레코드(태그 67)의 UTF-16 글 → 사람이 읽는 글 (조절 문자 건너뛰기) */
function paraText(b) {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) {
    const c = b.readUInt16LE(i);
    if (c >= 32) { s += String.fromCharCode(c); continue; }
    if (c === 13 || c === 10) { s += '\n'; continue; }
    if (c === 9) { s += '\t'; i += 14; continue; }                 // 탭 (8글자 크기)
    if (c === 30 || c === 31) { s += ' '; continue; }              // 묶음·고정폭 빈칸
    if (c === 24) { s += '-'; continue; }
    if ((c >= 1 && c <= 8) || c === 11 || c === 12 || (c >= 14 && c <= 23)) { i += 14; continue; } // 표·그림 등 컨트롤 (8글자 크기)
  }
  return s;
}
function hwpText(buf) {
  const cfb = readCfb(buf);
  const head = cfb.read('FileHeader');
  if (!head || head.toString('latin1', 0, 17) !== 'HWP Document File') throw new Error('한글(HWP) 문서가 아닙니다.');
  const flags = head.readUInt32LE(36);
  if (flags & 2) throw new Error('암호가 걸린 한글 문서입니다. 한글에서 암호를 풀고 저장한 뒤 다시 불러와 주세요.');
  if (flags & 4) throw new Error('배포용 한글 문서라 글을 꺼낼 수 없습니다. 한글에서 일반 문서로 저장한 뒤 다시 불러와 주세요.');
  const compressed = !!(flags & 1);
  const sections = Object.keys(cfb.files).filter((p) => /^BodyText\/Section\d+$/.test(p)).sort((a, b) => +a.match(/\d+$/)[0] - +b.match(/\d+$/)[0]);
  if (!sections.length) throw new Error('한글(HWP) 문서에서 본문을 찾지 못했습니다.');
  const out = [];
  for (const p of sections) {
    let s = cfb.read(p);
    if (compressed) { try { s = zlib.inflateRawSync(s); } catch (_) { s = zlib.inflateSync(s); } }
    let o = 0;
    while (o + 4 <= s.length) {
      const h = s.readUInt32LE(o); o += 4;
      const tag = h & 0x3FF;
      let size = h >>> 20;
      if (size === 0xFFF) { size = s.readUInt32LE(o); o += 4; }
      if (tag === 67) out.push(paraText(s.subarray(o, o + size)));
      o += size;
    }
  }
  return tidy(out.join(''));
}
function tidy(s) { return String(s).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }

module.exports = { hwpText, hwpxText, xmlText, paraText, readCfb };
