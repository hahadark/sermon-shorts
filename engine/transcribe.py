import os
import sys
import json
import argparse
import subprocess
import gc
import math

sys.stdout.reconfigure(encoding="utf-8")

def log_progress(stage, pct):
    print(json.dumps({"type": "progress", "stage": stage, "pct": min(100, max(0, pct))}), flush=True)

def log_error(msg):
    print(json.dumps({"type": "error", "message": msg}), flush=True)
    sys.exit(1)

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--start", type=float, default=None)
    parser.add_argument("--end", type=float, default=None)
    parser.add_argument("--out", required=True)
    parser.add_argument("--model", default=None, help="기본: GPU면 large-v3, CPU면 medium")
    parser.add_argument("--lang", default="ko")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="ffmpeg 실행 파일 경로 (기본: PATH의 ffmpeg)")
    parser.add_argument("--no-align", action="store_true")
    parser.add_argument("--terms", default="", help="자주 나오는 교회 용어 (쉼표로 구분, 설정의 교회 정보에서)")
    parser.add_argument("--debug", action="store_true")
    return parser.parse_args()

def extract_wav(ffmpeg_path, input_path, start, end, cache_wav):
    cmd = [ffmpeg_path, "-y"]
    if start is not None:
        cmd.extend(["-ss", str(start)])
    if end is not None and start is not None:
        cmd.extend(["-t", str(end - start)])
    cmd.extend(["-i", input_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", cache_wav])
    
    log_progress("extract", 0)
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        log_error(f"ffmpeg를 찾을 수 없습니다: {ffmpeg_path}")
    except subprocess.CalledProcessError as e:
        log_error(f"ffmpeg extraction failed: {e}")
    log_progress("extract", 100)

def main():
    args = parse_args()
    engine_dir = os.environ.get("SS_ENGINE_DIR", os.path.dirname(os.path.abspath(__file__)))
    cache_dir = os.environ.get("SS_CACHE_DIR", os.path.join(os.path.dirname(engine_dir), "cache"))
    os.makedirs(cache_dir, exist_ok=True)
    
    cache_wav = os.path.join(cache_dir, "temp_extract.wav")
    extract_wav(args.ffmpeg, args.input, args.start, args.end, cache_wav)
    
    import torch
    import soundfile as sf
    import numpy as np
    
    audio_data, samplerate = sf.read(cache_wav)
    duration_s = len(audio_data) / samplerate
    
    # 1. Faster Whisper
    from faster_whisper import WhisperModel
    model_dir = os.path.join(engine_dir, "models")
    os.makedirs(model_dir, exist_ok=True)
    
    initial_prompt = "하나님, 예수님, 성령, 말씀, 기도, 아멘"
    if args.terms.strip():
        initial_prompt += ", " + args.terms.strip()
    
    device = args.device
    compute_type = "int8_float16"
    no_gpu = device == "cuda" and not torch.cuda.is_available()
    if no_gpu:
        device = "cpu"
    if device == "cpu":
        compute_type = "int8"
    model_name = args.model or ("large-v3" if device == "cuda" else "medium")
    if no_gpu:
        print(json.dumps({"type": "warn", "message": f"GPU 없음 → CPU로 실행 (느림, {model_name} 모델)"}, ensure_ascii=False), flush=True)

    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type, download_root=model_dir)
        # PyAV 19 removed av.open(metadata_errors=...), so pass decoded float32 audio instead of a path
        whisper_audio = audio_data.astype(np.float32)
        if whisper_audio.ndim > 1:
            whisper_audio = whisper_audio.mean(axis=1)
        segments, info = model.transcribe(
            whisper_audio,
            language=args.lang,
            word_timestamps=True,
            vad_filter=True,
            beam_size=5,
            condition_on_previous_text=False,
            initial_prompt=initial_prompt
        )
        
        raw_words = []
        for seg_i, segment in enumerate(segments):
            for w in segment.words:
                raw_words.append({
                    "text": w.word.strip(),
                    "start": w.start,
                    "end": w.end,
                    "score": w.probability,
                    "seg": seg_i
                })
            log_progress("stt", int(segment.end / duration_s * 100))
        log_progress("stt", 100)
    except Exception as e:
        import traceback
        log_error(f"Whisper failed: {e}\n{traceback.format_exc()}")
    finally:
        if 'model' in locals():
            del model
        torch.cuda.empty_cache()
        gc.collect()

    aligned_words = []
    
    if args.no_align or len(raw_words) == 0:
        aligned_words = raw_words
    else:
        import torchaudio
        from transformers import Wav2Vec2Processor, Wav2Vec2ForCTC
        
        try:
            processor = Wav2Vec2Processor.from_pretrained("kresnik/wav2vec2-large-xlsr-korean")
            ctc_model = Wav2Vec2ForCTC.from_pretrained("kresnik/wav2vec2-large-xlsr-korean").to(device)
            blank_id = processor.tokenizer.pad_token_id
            delim_id = processor.tokenizer.word_delimiter_token_id
            
            # Align per whisper segment (WhisperX style). Long chunks make wav2vec2 emissions unreliable.
            vocab = processor.tokenizer.get_vocab()
            chunks = []
            for w in raw_words:
                if chunks and chunks[-1][-1]["seg"] == w["seg"] and (w["end"] - chunks[-1][0]["start"]) < 25.0:
                    chunks[-1].append(w)
                else:
                    chunks.append([w])

            for i, chunk in enumerate(chunks):
                result = [dict(w) for w in chunk]  # default: whisper times
                if args.debug:
                    for r in result:
                        r["raw_start"], r["raw_end"] = r["start"], r["end"]
                try:
                    chunk_start = max(0.0, chunk[0]["start"] - 0.3)
                    chunk_end = min(duration_s, chunk[-1]["end"] + 0.3)
                    targets, spans_idx = [], []
                    for wi, w in enumerate(chunk):
                        ids = [vocab[c] for c in w["text"] if c in vocab]
                        if not ids:
                            continue
                        if targets:
                            targets.append(delim_id)
                        spans_idx.append((wi, len(targets), len(targets) + len(ids) - 1))
                        targets.extend(ids)
                    sig = audio_data[int(chunk_start * samplerate):int(chunk_end * samplerate)]
                    if spans_idx and len(sig) > samplerate * 0.2:
                        input_values = processor(sig, sampling_rate=samplerate, return_tensors="pt").input_values.to(device)
                        with torch.no_grad():
                            log_probs = torch.log_softmax(ctc_model(input_values).logits, dim=-1)
                        n_frames = log_probs.shape[1]
                        if n_frames >= len(targets):
                            sec_per_frame = (len(sig) / samplerate) / n_frames
                            ali, sc = torchaudio.functional.forced_align(
                                log_probs.cpu(), torch.tensor([targets], dtype=torch.int32), blank=blank_id)
                            tok_spans = torchaudio.functional.merge_tokens(ali[0], sc[0].exp(), blank=blank_id)
                            if len(tok_spans) == len(targets):
                                for wi, a, b in spans_idx:
                                    s = chunk_start + tok_spans[a].start * sec_per_frame
                                    e = chunk_start + tok_spans[b].end * sec_per_frame
                                    raw = chunk[wi]
                                    # guard: reject alignments far from whisper's estimate
                                    if e > s and abs(s - raw["start"]) < 2.5 and abs(e - raw["end"]) < 2.5:
                                        result[wi]["start"], result[wi]["end"] = s, e
                except Exception as e:
                    print(json.dumps({"type": "warn", "message": f"align chunk {i} failed: {e}"}), flush=True)
                for r in result:
                    r.pop("seg", None)
                aligned_words.extend(result)
                log_progress("align", int((i + 1) / len(chunks) * 100))

            # enforce monotonic, non-overlapping times
            for k in range(1, len(aligned_words)):
                prev, cur = aligned_words[k - 1], aligned_words[k]
                if cur["start"] < prev["end"]:
                    mid = (prev["end"] + cur["start"]) / 2 if cur["start"] > prev["start"] else prev["end"]
                    prev["end"] = max(prev["start"] + 0.01, min(prev["end"], mid))
                    cur["start"] = max(cur["start"], prev["end"])
                if cur["end"] <= cur["start"]:
                    cur["end"] = cur["start"] + 0.02
            log_progress("align", 100)
        except Exception as e:
            log_error(f"Alignment failed: {e}")
        finally:
            if 'ctc_model' in locals():
                del ctc_model
            torch.cuda.empty_cache()
            gc.collect()

    # Finalize JSON
    offset = args.start if args.start is not None else 0.0
    
    out_words = []
    for i, w in enumerate(aligned_words):
        out_w = {
            "id": f"w{i+1:04d}",
            "text": w["text"],
            "start": round(w["start"] + offset, 3),
            "end": round(w["end"] + offset, 3),
            "score": round(w["score"], 3)
        }
        if args.debug and "raw_start" in w:
            out_w["raw_start"] = round(w["raw_start"] + offset, 3)
            out_w["raw_end"] = round(w["raw_end"] + offset, 3)
        out_words.append(out_w)
        
    out_json = {
        "language": args.lang,
        "words": out_words
    }
    
    try:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out_json, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log_error(f"Failed to write output JSON: {e}")
        
    print(json.dumps({
        "type": "done",
        "out": args.out,
        "words": len(out_words),
        "seconds": duration_s
    }), flush=True)

if __name__ == "__main__":
    main()
