'use strict';
// 렌더러가 요청하는 파일 읽기/쓰기 경로 제한.
// 허용: 대화상자·명령줄로 사용자가 직접 고른 파일, 그리고 캐시 폴더 안쪽.
const path = require('path');

const files = new Set();
const roots = [];
const win = process.platform === 'win32';

function norm(p) {
  const abs = path.resolve(String(p));
  return win ? abs.toLowerCase() : abs;
}

function isInside(p, dir) {
  const rel = path.relative(dir, p);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 사용자가 고른 파일을 허용 목록에 넣고 그대로 돌려준다 */
function allowFile(p) {
  if (typeof p === 'string' && p) files.add(norm(p));
  return p;
}

/** 이 폴더 안쪽은 모두 허용 */
function allowRoot(dir) {
  if (typeof dir === 'string' && dir) {
    const n = norm(dir);
    if (!roots.includes(n)) roots.push(n);
  }
}

/** 허용된 경로면 절대 경로를, 아니면 오류를 던진다 */
function check(p) {
  if (typeof p !== 'string' || !p) throw new Error('경로가 비어 있습니다.');
  const n = norm(p);
  if (files.has(n) || roots.some((r) => isInside(n, r))) return path.resolve(p);
  throw new Error('허용되지 않은 경로입니다: ' + p);
}

function reset() { files.clear(); roots.length = 0; }

module.exports = { allowFile, allowRoot, check, reset };
