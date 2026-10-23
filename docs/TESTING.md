# 오프라인 회귀 테스트

외부 AI API를 호출하지 않고 기존 로컬 영상만 사용한다.

## 자동 테스트

```powershell
cd F:\aside\SermonShorts
node --test
```

## 저장·다시 열기·MP4/SRT 통합 검증

```powershell
$env:SS_TEST_SCRIPT='project-roundtrip'
$env:SS_SCREENSHOT="$PWD\cache\project_roundtrip\final.png"
node node_modules\electron\cli.js . --open "$PWD\cache\test_261016.mp4"
Remove-Item Env:SS_TEST_SCRIPT,Env:SS_SCREENSHOT
```

영상·자막·테마는 검증용으로만 구성하며, 사용자 설정이나 테마 파일은 변경하지 않는다. 자막은 음성 인식 결과가 아닌 테스트용 문구다.

출력은 `cache/project_roundtrip/` 안의 다음 파일이다.
- `validation.json`: 삭제·트림·커서·테마·재생 위치 복원, 실행 취소, 내보내기, 원본 누락 시 편집 보호 확인
- `saved.sshorts`: 저장한 프로젝트
- `output.mp4`, `output.srt`: 같은 편집 모델로 만든 결과
- `restored.png`, `final.png`: 실제 앱 화면

`validation.json`의 `success: true`, 각 항목 `pass: true` 및 실행 종료 코드 0을 확인한다. 기존 `SS_TEST_SCRIPT=caret`은 커서 편집 37항목 검증을 수행한다. 테스트 후 환경변수는 반드시 지운다.

## 수동 사용
- Ctrl+S: 처음에는 위치를 고르고, 다음부터 같은 프로젝트에 저장
- Ctrl+Shift+S: 다른 이름으로 저장
- Ctrl+O: 프로젝트 다시 열기. 원본 영상 파일이 필요함
- 내보내기: 선택한 테마와 삭제·트림을 적용한 MP4와 같은 이름의 SRT 저장

원본 이동 시 경로 재지정 UI, 장시간 연속 작업, 다른 PC의 CPU 전용 출력은 이번 검증 범위 밖이다.

## 자막 글자 수 검증
위 통합 검증 명령에서 `SS_TEST_SCRIPT`를 `caption-limit`, `SS_SCREENSHOT`을 `cache/caption_limit/final.png`로 바꾸면 입력·프리셋·긴 단어 분할·실행 취소·저장 복원·실제 출력 검증을 수행한다. 결과는 `cache/caption_limit/validation.json`에 기록되며 외부 AI API를 호출하지 않는다.

## 원문·출력 분리 블록 검증
`SS_TEST_SCRIPT=dual-caption`과 `SS_SCREENSHOT=cache/dual_caption/final.png`를 사용하면 STT 원문 불변, 문장 수정, 14자 재분할, 필드 간 이동, 개별 실행 취소, 빈 자막의 영상 유지, 컷 후 수정 유지, 저장 복원과 MP4/SRT 출력을 검증한다. 테스트 문구는 의도적으로 틀린 원문을 넣은 인공 테스트 데이터이며 새 STT/API 호출을 하지 않는다.

## 행 병합·체크박스 일괄 삭제 검증
`SS_TEST_SCRIPT=merge-bulk`, `SS_SCREENSHOT=cache/merge_bulk/final.png`으로 실행한다. 출력 자막 앞 Backspace 병합·커서 위치·첫 행 보호·입력칸에서 Ctrl+Z·재분할·체크만 했을 때 불변·비연속 선택 삭제·선택하지 않은 중간 구간 보존·일괄 실행 취소/다시 실행·저장 복원·실제 출력까지 검증한다. 외부 AI 호출 없이 로컬 영상과 테스트 문구를 사용하며 결과는 `cache/merge_bulk/validation.json`이다.
