# SermonShorts 설계 (v0.1)

교회 설교 쇼츠 제작용 Electron 앱(SermonShorts). 긴 예배 영상 → 1~2분 세로 쇼츠(1080x1920 MP4 + SRT).
UI 문구는 모두 한국어. 코드는 순수 JS(CommonJS, 프레임워크/번들러 없음), Electron 44.7.2. WorshipCue와 같은 스타일.

## 폴더

```
src/main/main.js        Electron 메인: 창, 메뉴, IPC 등록
src/main/preload.js     contextBridge로 window.api 노출 (contextIsolation: true, nodeIntegration: false)
src/main/tools.js       경로: bin/ffmpeg.exe, bin/ffprobe.exe, bin/yt-dlp.exe, engine/.venv/Scripts/python.exe, cache/
src/main/media.js       probe(path), extractPcm(path, start, end, rate=48000) -> Float32Array mono, peaks
src/main/youtube.js     yt-dlp: 자동자막(json3) 가져오기, 구간 다운로드
src/main/engine.js      engine/transcribe.py 실행, stdout JSON lines 진행률 중계
src/main/render.js      ffmpeg 필터그래프 생성 + 내보내기
src/main/ai.js          Gemini REST 호출 (키: settings safeStorage → 없으면 env GEMINI_API_KEY). 키를 로그/화면에 절대 출력 금지
src/main/settings.js    userData/settings.json, 템플릿, 설교자 목록, 암호화된 API 키
src/shared/edl.js       순수 함수 (편집 모델). node --test 로 테스트. 렌더러와 메인 모두 사용
src/renderer/index.html, styles.css, app.js 그리고 모듈: transcript.js, trim.js, preview.js, template.js
engine/transcribe.py    faster-whisper + wav2vec2 강제정렬
assets/fonts, assets/images/sa-crest.png
cache/<sourceHash>/     audio16k.wav, transcript.json, peaks 등 (git 제외)
tests/
```

렌더러는 `<script type="module">` 대신 일반 script 여러 개 + 전역 네임스페이스 `window.SS = {}` 사용 (edl.js는 UMD 형태로 작성해서 require와 브라우저 둘 다 지원).

## 시간 단위
- 모든 시간은 **초(float), 원본 파일 기준**. UI 표시는 `원본영상시각 = 파일시각 + source.offset` (유튜브 구간 다운로드 시 offset = 구간 시작).
- 프레임 = 1/fps (source.fps, 기본 30).

## 프로젝트 파일 (*.sshorts, JSON)

```json
{
  "version": 1,
  "source": { "path": "...mp4", "url": "https://youtu.be/...", "offset": 870.0,
              "duration": 1500.2, "fps": 29.97, "width": 1920, "height": 1080 },
  "words": [ { "id": "w0001", "text": "우리가", "start": 12.34, "end": 12.71, "score": 0.93,
               "del": false, "br": false } ],
  "overrides": { "s:w0040": 55.120, "e:w0039": 50.300 },
  "settings": { "padBefore": 0.10, "padAfter": 0.15, "fadeMs": 10, "maxLineChars": 14 },
  "meta": { "title": "증인들", "verse": "행 5:27-32", "speaker": "홍길동 목사" },
  "crop": { "scale": 1.0, "x": 0.5, "y": 0.4 },
  "template": "default"
}
```
- `del`: 텍스트에서 지운 단어. `br`: 이 단어 뒤에서 자막 줄 강제 바꿈. `text` 수정 = 오타 수정.
- `overrides`: 구간 경계를 손으로 옮긴 절대시각. 키 `s:<구간 첫 단어 id>`(구간 시작), `e:<구간 마지막 단어 id>`(구간 끝).

## edl.js (핵심 순수 함수)
- `buildSegments(words, settings, overrides, duration)` → `[{ id, firstWordId, lastWordId, start, end }]`
  - 지워지지 않은 연속 단어 묶음 = 구간. start = 첫단어.start - padBefore, end = 마지막단어.end + padAfter.
  - overrides 있으면 그 값 사용. 0..duration으로 클램프. 이웃 구간과 겹치면 겹친 구간을 하나로 합침.
- `segmentsDuration(segs)`, `srcToOut(segs, t)` (구간 밖이면 null), `outToSrc(segs, outT)` → `{ segIndex, t }`
- `cutPoints(segs)` → `[{ index, outEnd: segs[i].end, inStart: segs[i+1].start, keyEnd, keyStart }]` (트림 UI용)
- `buildLines(words, segs, settings)` → 자막 줄 `[{ text, words:[ids], outStart, outEnd }]`
  - 남은 단어를 순서대로 모아 maxLineChars(공백 제외 한글 글자수 기준) 넘기기 전, 또는 `br`, 또는 문장끝(. ? !), 또는 단어 사이 무음 > 0.6s 에서 줄바꿈.
  - outStart = 첫 단어 출력시각, outEnd = 다음 줄 outStart (마지막 줄은 마지막단어 출력 end + 0.3, 전체길이로 클램프). 줄 사이 공백 0.8s 이상이면 끝을 단어end+0.3으로.
- `toSRT(lines)` → SRT 문자열 (HH:MM:SS,mmm).
- `snap(pcm, rate, t, mode, windowSec=0.05)` → mode `zero`(가장 가까운 제로크로싱) / `silence`(±0.15s 안에서 10ms RMS 최저점).

## 오디오 이음새
- 각 구간 시작/끝에 fadeMs(기본 10ms) 짧은 페이드 인/아웃. (진짜 겹침 크로스페이드는 영상 싱크가 밀리므로 v1은 페이드 방식)

## 렌더 (render.js)
- 입력: `-ss (첫구간.start-1) -to (끝구간.end+1) -i source` 로 필요한 범위만 디코드, 시간은 그만큼 보정.
- 구간마다 `[0:v]trim=s:e,setpts=PTS-STARTPTS` / `[0:a]atrim=s:e,asetpts=PTS-STARTPTS,afade=t=in:d=F,afade=t=out:st=(len-F):d=F` → `concat=n=N:v=1:a=1`.
- 영상: crop(템플릿 영상영역 비율 1080:958, crop.scale/x/y로 원본 픽셀 영역 계산) → scale=1080:958 → 검정 1080x1920 캔버스에 y=353 위치 overlay.
- 템플릿 레이어는 렌더러가 Canvas(1080x1920)로 그려 PNG로 넘김: `top.png`(제목+구절), `footer.png`(로고+교회명+설교자, 시작 0~1s 페이드인: `fade=t=in:st=0:d=1:alpha=1`), 자막 줄마다 `line_###.png` → `overlay=enable='between(t,a,b)'`. 미리보기와 결과가 똑같이 나오게 하려는 방식.
- 인코딩: `h264_nvenc -preset p5 -rc vbr -cq 19 -b:v 0` (실패 시 libx264 -crf 18), `-r 30 -pix_fmt yuv420p`, AAC 192k 48kHz, `-movflags +faststart`. 진행률은 `-progress pipe:1`.
- SRT는 같은 이름 .srt로 저장.

## 템플릿 (1080x1920, 쇼츠36 실측 근사)
- 배경 #000. 제목 중심 y≈205, 구절 중심 y≈280, 색 #39FF5A, 붓글씨체, 약 68px, 가운데.
- 영상 영역 y=353..1311 (1080x958).
- 자막 중심 y≈1390, 흰색 굵은 고딕 약 62px.
- 하단: 문장(로고) 약 110px 높이, 그 오른쪽에 교회 이름(자간 넓게, 약 40px) 위, 설교자 "이름 직분"(약 56px 굵게) 아래. 묶음 가운데 정렬, y≈1620..1730.
- 템플릿 값은 settings에 JSON으로 저장 (글꼴, 색, 크기, 위치, 로고 경로).
- 글꼴 (쇼츠36 비교로 확정, assets/fonts, OFL): 제목·구절 = Yeon Sung(YeonSung-Regular.ttf, 약간 굵게 보이도록 같은 색 1~2px 외곽선), 자막·교회명·설교자 = Noto Sans KR (사용자가 [글꼴 추가]로 바꿀 수 있음). 대체 글꼴 NanumGothic. 렌더러에서 @font-face로 로드.

## 엔진 (engine/transcribe.py)
- `python transcribe.py --input <file> [--start s --end e] --out <json> [--model large-v3] [--lang ko]`
- ffmpeg로 16kHz mono wav 추출 → faster-whisper (cuda, int8_float16, vad_filter=True, word_timestamps=True, beam 5, initial_prompt에 교회용어) → wav2vec2 한국어 CTC 모델(kresnik/wav2vec2-large-xlsr-korean)로 세그먼트별 글자 강제정렬(torchaudio.functional.forced_align) → 단어 start/end 보정. 정렬 실패 시 whisper 단어 시각 유지.
- stdout은 한 줄 JSON: `{"type":"progress","stage":"stt|align","pct":42}`, 끝에 `{"type":"done","out":"..."}`. 오류는 `{"type":"error","message":"..."}`.
- 결과 JSON: `{ "language":"ko", "words":[{"id","text","start","end","score"}] }` (파일 기준 시각; --start 사용 시 그만큼 더한 값).

## 유튜브 (youtube.js)
- 자동자막: `yt-dlp --skip-download --write-auto-subs --sub-langs ko --sub-format json3 -o cache/... URL`
- 구간 다운로드: `yt-dlp --download-sections "*S-E" -f "bv*[height<=2160]+ba/b" --merge-output-format mp4 --ffmpeg-location bin URL`, 앞뒤 10초 여유. `--js-runtimes node` (시스템 node 경로).
- 시간 입력 파서: "14:30", "1:14:30", "870", "14:30 ~ 38:50", "14:30-38:50". URL의 t= 파라미터 인식.

## 단계
0 준비 / 1 뼈대 / 2 유튜브 / 3 자막엔진 / 4 텍스트편집 / 5 파형트림 / 6 템플릿 / 7 내보내기·저장 / 8 AI


## AI (8단계)
- src/main/ai.js (작성됨, 검증됨): `analyzeSermon(lines, {videoTitle, description, count})` → `{ sermon:{start,end,title,scripture,mainMessage}, candidates:[{start,end,shortsTitle,firstSentence,lastSentence,reason,score}], usage }`. 기본 모델 gemini-3.5-flash. 2026-10-16 영상 시험: 16초, 입력 11k/출력 3.3k 토큰, 설교 14:41~38:35·"증인들"·"행 5:27-32" 정확.
- 키: 설정 화면에서 입력 → Electron safeStorage로 암호화해 settings.json에 저장. 없으면 env GEMINI_API_KEY. `ai.setKeyProvider()`로 연결. 키는 화면/로그에 절대 표시 금지(입력칸은 password, 저장 후 "저장됨 ••••"만).
- "AI 추천" 흐름: 주소 입력 → ytInfo + ytAutoSubs → analyzeSermon → 후보 목록(점수, 시간, 제목, 첫/끝 문장, 이유) → 후보 선택 → ytDownload(전체, 캐시) → transcribe(후보.start-5, 후보.end+5) → 편집기에 로드 → 후보 구간 밖 단어 del → 자동 정리 → meta(title=shortsTitle, verse=scripture, speaker=설정의 기본 설교자 또는 영상 제목/설명에서 추정) 채움.
- 자동 정리(로컬 규칙, edl.js에 추가): 단독 군말(어, 음, 아, 으, 에, 엄) 삭제, 바로 반복된 같은 단어 앞쪽 삭제, 단어 사이 무음 > 0.6s는 컷으로 줄임 → word.cutBefore=true 플래그(buildSegments가 이 단어에서 구간을 새로 시작).
- AI 용어 교정: 남은 단어들을 [{id,text}]로 보내 교회/성경 용어·고유명사 오타만 고친 [{id,text}] 받기(gemini-3.5-flash, JSON 스키마). 바뀐 단어는 노란 밑줄, Ctrl+Z로 되돌리기.


## 유튜브 구간 가져오기 (v0.2)
- 구간 고르기 창: 360p 미리보기 스트림(itag 18)을 앱에서 바로 재생 + 유튜브 자동 자막 목록으로 구간(I/O) 지정.
- 지정 구간만 1080p로 받기: src/main/ytpart.js. DASH 파일 앞의 sidx(시간→바이트 목차)를 읽고 &range= 조각(≤9MB)으로 영상·음성 조각만 받아 합침. 110초 구간 약 2~6초, 약 50MB. 파일 시각 0 = 원본 시각 offset (영상 첫 조각 시작, 키프레임). A/V 싱크 검증: 오디오 지연 0ms.
- 실패하면 전체 받기로 자동 대체. 스트림 주소는 약 6시간 뒤 만료 → 만료 10분 전이나 403이면 다시 받음.
