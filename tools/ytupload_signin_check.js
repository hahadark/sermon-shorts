// 유튜브 로그인(구글 OAuth) 실제 확인 — Electron 으로 실행:
//   node node_modules/electron/cli.js tools/ytupload_signin_check.js
// 환경변수: SS_USER_DATA_DIR(설정 저장 폴더, 필수), SS_AUTH_URL_FILE(로그인 주소를 적을 파일, 없으면 브라우저로 연다)
// 순서: 로그인 → 채널 이름 → 업로드 세션 만들기(영상은 올리지 않음) → 로그아웃(토큰 폐기)
'use strict';
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

if (process.env.SS_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.SS_USER_DATA_DIR));

app.whenReady().then(async () => {
  const urlFile = process.env.SS_AUTH_URL_FILE;
  if (urlFile) shell.openExternal = async (u) => { fs.writeFileSync(urlFile, u); console.log('AUTH_URL_WRITTEN'); };
  const yt = require('../src/main/youtube-upload')._forTest;
  try {
    console.log('client:', JSON.stringify(yt.status()));
    const st = await yt.signIn();
    console.log('SIGNED_IN', JSON.stringify(st));
    const token = await yt.getAccessToken();
    // 업로드 세션만 만들어 본다 (파일을 보내지 않으므로 영상은 생기지 않는다)
    const res = await fetch(yt.UPLOAD_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'video/mp4', 'x-upload-content-length': '1000' },
      body: JSON.stringify({ snippet: { title: 'SermonShorts 연결 확인 (올리지 않음)', categoryId: '29' }, status: { privacyStatus: 'private' } }),
    });
    const body = res.ok ? '' : (await res.text()).slice(0, 300);
    console.log('UPLOAD_SESSION', res.status, res.headers.get('location') ? '세션 주소 받음' : '세션 주소 없음', body);
    if (process.env.SS_KEEP_LOGIN !== '1') console.log('SIGNED_OUT', JSON.stringify(await yt.signOut()));
  } catch (e) {
    console.log('ERR', e.code || '', e.message);
  }
  app.quit();
});
