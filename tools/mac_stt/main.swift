// 맥 내장 음성 인식 (macOS 26 이상 SpeechAnalyzer·SpeechTranscriber): 위스퍼(파이썬 엔진)를 설치하지 않아도 자막을 만든다.
// assets/engine/transcribe.py 와 같은 인자·같은 출력(진행 줄, 결과 JSON { language, words: [{id,text,start,end,score}] })이라 stt.rs 가 그대로 쓴다.
//   ss-stt-apple --input 파일 --out 결과.json --ffmpeg ffmpeg경로 [--start 초] [--end 초] [--terms "용어, 용어"] [--lang ko]
//   ss-stt-apple --check            → {"ok":true|false, "installed":…, "reason":…}  (앱이 쓸 수 있는지)
// 기기 안에서만 돌고(인터넷으로 소리를 보내지 않음), 한국어 모델이 없으면 처음 한 번 애플에서 받는다.
import AVFoundation
import Foundation
import Speech

func emit(_ d: [String: Any]) {
    if let j = try? JSONSerialization.data(withJSONObject: d), let s = String(data: j, encoding: .utf8) { print(s); fflush(stdout) }
}
func fail(_ m: String) -> Never { emit(["type": "error", "message": m]); exit(1) }

@main struct Main {
    static func main() async {
        var a: [String: String] = [:]
        var it = CommandLine.arguments.dropFirst().makeIterator()
        while let k = it.next() {
            guard k.hasPrefix("--") else { continue }
            let key = String(k.dropFirst(2))
            if key == "check" { a[key] = "1" } else { a[key] = it.next() ?? "" }
        }
        guard #available(macOS 26.0, *) else {
            if a["check"] != nil { emit(["ok": false, "installed": false, "reason": "macOS 26 이상에서 됩니다"]); exit(0) }
            fail("맥 내장 음성 인식은 macOS 26 이상에서 됩니다. 위스퍼 엔진을 설치해 주세요.")
        }
        await run(a)
    }
}

@available(macOS 26.0, *)
func locale(_ a: [String: String]) async -> Locale? {
    let l = a["lang"] ?? "ko"
    return await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: l == "ko" ? "ko-KR" : l))
}

@available(macOS 26.0, *)
func run(_ a: [String: String]) async {
    let loc = await locale(a)
    if a["check"] != nil {
        guard let loc else { emit(["ok": false, "installed": false, "reason": "이 맥은 한국어 받아쓰기를 지원하지 않습니다"]); exit(0) }
        let inst = await SpeechTranscriber.installedLocales.contains { $0.identifier(.bcp47) == loc.identifier(.bcp47) }
        emit(["ok": true, "installed": inst, "locale": loc.identifier(.bcp47)]); exit(0)
    }
    guard let loc else { fail("이 맥은 한국어 받아쓰기를 지원하지 않습니다") }
    guard let input = a["input"], let out = a["out"] else { fail("--input 과 --out 이 필요합니다") }
    let start = a["start"].flatMap(Double.init)
    let end = a["end"].flatMap(Double.init)

    // 1) 소리 뽑기 (16kHz 한 채널 wav) — transcribe.py 와 같은 ffmpeg 인자
    emit(["type": "progress", "stage": "extract", "pct": 0])
    let wav = FileManager.default.temporaryDirectory.appendingPathComponent("ss-stt-\(getpid()).wav")
    defer { try? FileManager.default.removeItem(at: wav) }
    var args = ["-y", "-v", "error"]
    if let s = start { args += ["-ss", String(s)] }
    if let e = end, let s = start { args += ["-t", String(e - s)] }
    args += ["-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav.path]
    let p = Process()
    // 경로가 아닌 이름("ffmpeg")이면 PATH 에서 찾는다
    let ff = a["ffmpeg"] ?? "ffmpeg"
    if ff.contains("/") { p.executableURL = URL(fileURLWithPath: ff); p.arguments = args } else { p.executableURL = URL(fileURLWithPath: "/usr/bin/env"); p.arguments = [ff] + args }
    do { try p.run(); p.waitUntilExit() } catch { fail("ffmpeg 를 실행하지 못했습니다: \(error.localizedDescription)") }
    if p.terminationStatus != 0 { fail("소리를 뽑지 못했습니다 (ffmpeg \(p.terminationStatus))") }
    emit(["type": "progress", "stage": "extract", "pct": 100])

    let tr = SpeechTranscriber(locale: loc, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange, .transcriptionConfidence])
    // 2) 한국어 모델이 없으면 받기 (처음 한 번)
    do {
        if let req = try await AssetInventory.assetInstallationRequest(supporting: [tr]) {
            emit(["type": "warn", "message": "맥 받아쓰기 한국어 모델을 처음 한 번 받습니다"])
            let prog = req.progress
            let watch = Task { while !Task.isCancelled { emit(["type": "progress", "stage": "model", "pct": Int(prog.fractionCompleted * 100)]); try? await Task.sleep(for: .milliseconds(500)) } }
            try await req.downloadAndInstall()
            watch.cancel()
        }
    } catch { fail("받아쓰기 모델을 받지 못했습니다: \(error.localizedDescription)") }

    // 3) 받아쓰기
    let file: AVAudioFile
    do { file = try AVAudioFile(forReading: wav) } catch { fail("소리 파일을 열지 못했습니다: \(error.localizedDescription)") }
    let dur = Double(file.length) / file.processingFormat.sampleRate
    let an = SpeechAnalyzer(modules: [tr])
    let terms = (a["terms"] ?? "").split(whereSeparator: { $0 == "," || $0 == "\n" }).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    let base = ["하나님", "예수님", "성령", "말씀", "기도", "아멘"]
    let ctx = AnalysisContext()
    ctx.contextualStrings[.general] = base + terms
    try? await an.setContext(ctx)
    emit(["type": "progress", "stage": "stt", "pct": 0])
    let collect = Task { () throws -> [[String: Any]] in
        var words: [[String: Any]] = []
        for try await r in tr.results {
            var lastEnd = 0.0
            for run in r.text.runs {
                let piece = String(r.text[run.range].characters)
                let text = piece.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty { continue }
                guard let range = run.audioTimeRange else { continue }
                let (s, e) = (range.start.seconds, range.end.seconds)
                let conf = run.transcriptionConfidence ?? 1.0
                // 띄어쓰기 없이 이어지는 조각은 앞 낱말에 붙인다 (낱말 하나 = 한 칸)
                if let last = words.last, !piece.hasPrefix(" "), !piece.hasPrefix("\n"), (last["end"] as? Double ?? -1) >= s - 0.001 {
                    words[words.count - 1]["text"] = (last["text"] as! String) + text
                    words[words.count - 1]["end"] = max(e, last["end"] as! Double)
                    words[words.count - 1]["score"] = min(conf, last["score"] as! Double)
                } else {
                    words.append(["text": text, "start": s, "end": e, "score": conf])
                }
                lastEnd = e
            }
            if dur > 0 { emit(["type": "progress", "stage": "stt", "pct": min(99, Int(lastEnd / dur * 100))]) }
        }
        return words
    }
    do {
        if let last = try await an.analyzeSequence(from: file) { try await an.finalizeAndFinish(through: last) } else { await an.cancelAndFinishNow() }
    } catch { fail("받아쓰기 실패: \(error.localizedDescription)") }
    let raw: [[String: Any]]
    do { raw = try await collect.value } catch { fail("받아쓰기 실패: \(error.localizedDescription)") }
    emit(["type": "progress", "stage": "stt", "pct": 100])

    // 4) 결과 (transcribe.py 와 같은 모양, 시각은 원본 파일 기준)
    let off = start ?? 0
    let r3 = { (x: Double) in (x * 1000).rounded() / 1000 }
    var outWords: [[String: Any]] = []
    for (i, w) in raw.enumerated() {
        let s = w["start"] as! Double, e = max(w["end"] as! Double, s + 0.02)
        outWords.append(["id": String(format: "w%04d", i + 1), "text": w["text"]!, "start": r3(s + off), "end": r3(e + off), "score": r3(w["score"] as! Double)])
    }
    let result: [String: Any] = ["language": (a["lang"] ?? "ko"), "engine": "apple", "words": outWords]
    do {
        let d = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted])
        try d.write(to: URL(fileURLWithPath: out))
    } catch { fail("결과를 쓰지 못했습니다: \(error.localizedDescription)") }
    emit(["type": "done", "out": out, "words": outWords.count, "seconds": dur])
}
