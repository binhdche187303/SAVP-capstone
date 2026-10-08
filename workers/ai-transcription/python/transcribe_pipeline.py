"""Orchestrator AI pipeline cho M1 (STT) + M2 (diarization/overlap, T015-T018)
+ Phase 3 channel_zone mode (multi-channel per-user audio).

Flow diarization_only (mode cũ):
  audio_preprocess -> whisper_runner -> [diarization_runner -> overlap_detector ->
  merge_segments] -> validate -> result.

Flow channel_zone (Phase 3):
  Mỗi channel: preprocess -> whisper -> gán userId/speakerLabel trực tiếp ->
  gộp tất cả segments sort startMs -> detect_overlaps_from_segments ->
  mark overlap -> build detectedSpeakers -> validate -> result.

CLI:
    python transcribe_pipeline.py --input <path> --normalized-output <path>
        --result-output <path> --model small --device cpu --compute-type int8
        --language vi-VN --diarization-enabled true --overlap-detection-enabled true
        [--channels-json '<json>']
"""

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

from audio_preprocess import UnsupportedMediaFormatError, preprocess_audio
from diarization_runner import DiarizationUnavailableError, diarize
from merge_segments import (
    assign_speakers,
    build_detected_speakers,
    merge_fragmented_segments,
)
from overlap_detector import (
    detect_overlaps,
    detect_overlaps_from_segments,
    mark_overlapping_segments,
)
from schemas import SchemaValidationError, new_segment, validate_result
from whisper_runner import transcribe

LOW_CONFIDENCE_THRESHOLD = float(
    os.environ.get("MIN_RELIABLE_TRANSCRIPT_CONFIDENCE", "0.75")
)
# Số lần lặp liên tiếp y hệt nhau tối thiểu để coi là hallucination loop (không
# phải người nói thật sự lặp "vâng vâng vâng" 5-6 lần liền — ngưỡng cao hơn mức
# lặp tự nhiên trong hội thoại).
REPEAT_COLLAPSE_THRESHOLD = 5


def log_event(event: str, **fields: Any) -> None:
    """Log structured JSON ra stderr — KHÔNG bao giờ log raw transcript text
    đầy đủ (chỉ length), không log path tuyệt đối nhạy cảm."""
    payload = {"event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)


def collapse_repeated_segments(
    segments: List[Dict[str, Any]],
) -> "tuple[List[Dict[str, Any]], int]":
    """Gộp các run >= REPEAT_COLLAPSE_THRESHOLD segment liên tiếp có text y hệt
    nhau (case-insensitive, trim khoảng trắng) thành 1 segment duy nhất, đánh
    dấu manualReviewRequired — phòng vệ cho hallucination loop kiểu "Được rồi."
    lặp hàng chục lần khi gặp đoạn nhiễu/im lặng. Trả về (segments_mới, số_run_đã_gộp)."""
    if not segments:
        return segments, 0

    collapsed: List[Dict[str, Any]] = []
    collapsed_runs = 0
    i = 0
    while i < len(segments):
        run = [segments[i]]
        key = segments[i]["text"].strip().lower()
        j = i + 1
        while j < len(segments) and segments[j]["text"].strip().lower() == key:
            run.append(segments[j])
            j += 1

        if len(run) >= REPEAT_COLLAPSE_THRESHOLD:
            collapsed_runs += 1
            first, last = run[0], run[-1]
            merged = dict(first)
            merged["endMs"] = last["endMs"]
            merged["lowConfidence"] = True
            merged["manualReviewRequired"] = True
            merged["notes"] = list(first.get("notes", [])) + [
                f"hallucination_loop_collapsed_x{len(run)}"
            ]
            collapsed.append(merged)
        else:
            collapsed.extend(run)
        i = j

    return collapsed, collapsed_runs


def run_channel_zone_pipeline(
    channels: List[Dict[str, str]],
    model: str,
    device: str,
    compute_type: str,
    language: str,
    initial_prompt: Optional[str] = None,
    overlap_detection_enabled: bool = False,
) -> Dict[str, Any]:
    """Phase 3 — channel_zone mode: mỗi channel = 1 user audio riêng.

    channels: list of {inputPath, normalizedPath, userId} từ Node.
    """
    log_event(
        "channel_zone_start",
        channelCount=len(channels),
        model=model,
        device=device,
    )

    all_segments: List[Dict[str, Any]] = []
    all_confidences: List[float] = []
    seg_counter = 0

    for ch_idx, channel in enumerate(channels):
        user_id = channel["userId"]
        input_path = channel["inputPath"]
        normalized_path = channel["normalizedPath"]

        log_event("channel_preprocess_start", channelIndex=ch_idx, userId=user_id)
        preprocess_audio(input_path, normalized_path)
        log_event("channel_preprocess_done", channelIndex=ch_idx)

        log_event(
            "channel_whisper_start",
            channelIndex=ch_idx,
            model=model,
            hasInitialPrompt=bool(initial_prompt),
        )
        whisper_result = transcribe(
            normalized_path,
            model_size_or_path=model,
            device=device,
            compute_type=compute_type,
            language=language,
            initial_prompt=initial_prompt,
        )
        log_event(
            "channel_whisper_done",
            channelIndex=ch_idx,
            segmentCount=len(whisper_result["segments"]),
        )
        all_confidences.append(whisper_result["confidenceScore"])

        for raw_seg in whisper_result["segments"]:
            seg = new_segment(
                segment_id=f"seg-{seg_counter:04d}",
                start_ms=raw_seg["startMs"],
                end_ms=raw_seg["endMs"],
                text=raw_seg["text"],
                stt_confidence=raw_seg["confidence"],
                low_confidence_threshold=LOW_CONFIDENCE_THRESHOLD,
            )
            seg["userId"] = user_id
            seg["speakerLabel"] = user_id
            seg["speakerSource"] = "channel_zone"
            seg["lowConfidence"] = False
            seg["manualReviewRequired"] = False
            seg["notes"] = []
            stt_conf = raw_seg["confidence"] or 0.0
            seg["finalConfidence"] = stt_conf
            all_segments.append(seg)
            seg_counter += 1

    all_segments.sort(key=lambda s: s["startMs"])

    all_segments, collapsed_runs = collapse_repeated_segments(all_segments)
    if collapsed_runs:
        log_event("hallucination_loop_collapsed", runs=collapsed_runs)

    warnings: List[str] = []
    overall_confidence = (
        sum(all_confidences) / len(all_confidences) if all_confidences else 0.0
    )
    if overall_confidence < LOW_CONFIDENCE_THRESHOLD:
        for segment in all_segments:
            segment["lowConfidence"] = True
            segment["manualReviewRequired"] = True
            segment["notes"] = list(segment.get("notes", [])) + [
                "transcript_below_reliable_threshold"
            ]
    if overall_confidence < LOW_CONFIDENCE_THRESHOLD or collapsed_runs:
        warnings.append("low_confidence_transcript")
    if not all_segments:
        warnings.append("no_reliable_speech_detected")

    if overlap_detection_enabled:
        overlap_windows = detect_overlaps_from_segments(all_segments)
        log_event("overlap_detection_done", windowCount=len(overlap_windows))
        mark_overlapping_segments(all_segments, overlap_windows)

    detected_speakers = build_detected_speakers(all_segments)

    detected_language = language or "vi-VN"
    raw_text = " ".join(s["text"] for s in all_segments if s["text"]).strip()

    result: Dict[str, Any] = {
        "languageCode": detected_language,
        "rawText": raw_text,
        "cleanedText": raw_text,
        "confidenceScore": overall_confidence,
        "segments": all_segments,
        "detectedSpeakers": detected_speakers,
        "modelVersions": {
            "whisper": model,
            "pyannote": None,
            "sepformer": None,
        },
        "warnings": warnings,
    }

    validate_result(result)
    log_event("channel_zone_done", segmentCount=len(all_segments), speakerCount=len(detected_speakers))
    return result


def run_pipeline(
    input_path: str,
    normalized_output_path: str,
    model: str,
    device: str,
    compute_type: str,
    language: str,
    initial_prompt: Optional[str] = None,
    diarization_enabled: bool = False,
    overlap_detection_enabled: bool = False,
) -> Dict[str, Any]:
    log_event("preprocess_start", model=model, device=device)
    audio_meta = preprocess_audio(input_path, normalized_output_path)
    log_event("preprocess_done", durationSeconds=audio_meta["durationSeconds"])

    log_event(
        "whisper_start",
        model=model,
        device=device,
        computeType=compute_type,
        hasInitialPrompt=bool(initial_prompt),
    )
    whisper_result = transcribe(
        normalized_output_path,
        model_size_or_path=model,
        device=device,
        compute_type=compute_type,
        language=language,
        initial_prompt=initial_prompt,
    )
    log_event("whisper_done", segmentCount=len(whisper_result["segments"]))

    segments: List[Dict[str, Any]] = []
    for raw_segment in whisper_result["segments"]:
        segments.append(
            new_segment(
                segment_id=f"seg-{raw_segment['index']:04d}",
                start_ms=raw_segment["startMs"],
                end_ms=raw_segment["endMs"],
                text=raw_segment["text"],
                stt_confidence=raw_segment["confidence"],
                low_confidence_threshold=LOW_CONFIDENCE_THRESHOLD,
            )
        )

    segments, collapsed_runs = collapse_repeated_segments(segments)
    if collapsed_runs:
        log_event("hallucination_loop_collapsed", runs=collapsed_runs)

    warnings: List[str] = []
    if whisper_result["confidenceScore"] < LOW_CONFIDENCE_THRESHOLD:
        for segment in segments:
            segment["lowConfidence"] = True
            segment["manualReviewRequired"] = True
            segment["notes"] = list(segment.get("notes", [])) + [
                "transcript_below_reliable_threshold"
            ]
    if whisper_result["confidenceScore"] < LOW_CONFIDENCE_THRESHOLD or collapsed_runs:
        warnings.append("low_confidence_transcript")
    if not segments:
        warnings.append("no_reliable_speech_detected")

    detected_speakers: List[Dict[str, Any]] = []
    pyannote_version: Optional[str] = None

    if diarization_enabled:
        log_event("diarization_start")
        try:
            turns = diarize(normalized_output_path)
            pyannote_version = os.environ.get(
                "PYANNOTE_MODEL_VERSION", "pyannote-local"
            )
            log_event("diarization_done", turnCount=len(turns))
        except DiarizationUnavailableError as exc:
            log_event("diarization_failed_fallback_unknown", message=str(exc))
            warnings.append("diarization_failed_fallback_unknown")
            turns = []

        overlap_windows: List[Dict[str, Any]] = []
        if overlap_detection_enabled and turns:
            overlap_windows = detect_overlaps(turns)
            log_event("overlap_detection_done", windowCount=len(overlap_windows))

        if turns:
            # GA-11/GA-12 (feat-transcript-segment-merge): gộp mảnh CÙNG lượt
            # nói trước khi gán speaker — giảm mảnh vắt ranh giới người nói bị
            # gán oan "unknown" (xem spec.md FR-005). Chỉ chạy khi có turns
            # (CLR-002: diarization tắt/fail -> giữ nguyên hành vi cũ, không gộp).
            before_count = len(segments)
            segments = merge_fragmented_segments(segments, turns)
            log_event(
                "segment_merge_done",
                beforeCount=before_count,
                afterCount=len(segments),
            )
            segments = assign_speakers(segments, turns, overlap_windows)
            detected_speakers = build_detected_speakers(segments)

    # rawText dựng lại từ segments SAU khi collapse/gán speaker — text bản thân
    # không đổi qua bước gán speaker, chỉ cần dựng lại để nhất quán thứ tự.
    raw_text = " ".join(s["text"] for s in segments if s["text"]).strip()

    result: Dict[str, Any] = {
        "languageCode": whisper_result["languageCode"],
        "rawText": raw_text,
        # MVP: cleanedText = rawText, đúng mô tả contracts/ai-worker-result-schema.json
        "cleanedText": raw_text,
        "confidenceScore": whisper_result["confidenceScore"],
        "segments": segments,
        "detectedSpeakers": detected_speakers,
        "modelVersions": {
            "whisper": model,
            "pyannote": pyannote_version,
            "sepformer": None,
        },
        "warnings": warnings,
    }

    validate_result(result)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline transcription pipeline (M1)")
    parser.add_argument("--input", required=True)
    parser.add_argument("--normalized-output", required=True)
    parser.add_argument("--result-output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--language", default="vi-VN")
    # Custom vocabulary (proper noun, thuật ngữ ngành) — ưu tiên job payload
    # (--initial-prompt), fallback WHISPER_INITIAL_PROMPT ở config/env nếu job
    # không truyền.
    parser.add_argument("--initial-prompt", default=None)
    # Truyền tường minh từ Node (profile.diarizationEnabled/overlapDetectionEnabled,
    # xem profile-config.ts) thay vì để Python tự đọc lại env và suy luận default
    # theo profile — tránh 2 nơi định nghĩa default khác nhau (single source of
    # truth nằm ở profile-config.ts).
    parser.add_argument("--diarization-enabled", default="false")
    parser.add_argument("--overlap-detection-enabled", default="false")
    parser.add_argument("--channels-json", default=None)
    args = parser.parse_args()

    initial_prompt = args.initial_prompt or os.environ.get("WHISPER_INITIAL_PROMPT") or None
    overlap_enabled = args.overlap_detection_enabled.lower() == "true"

    try:
        if args.channels_json:
            channels = json.loads(args.channels_json)
            result = run_channel_zone_pipeline(
                channels=channels,
                model=args.model,
                device=args.device,
                compute_type=args.compute_type,
                language=args.language,
                initial_prompt=initial_prompt,
                overlap_detection_enabled=overlap_enabled,
            )
        else:
            result = run_pipeline(
                input_path=args.input,
                normalized_output_path=args.normalized_output,
                model=args.model,
                device=args.device,
                compute_type=args.compute_type,
                language=args.language,
                initial_prompt=initial_prompt,
                diarization_enabled=args.diarization_enabled.lower() == "true",
                overlap_detection_enabled=overlap_enabled,
            )
    except (UnsupportedMediaFormatError, FileNotFoundError) as exc:
        log_event("pipeline_failed", code="UNSUPPORTED_MEDIA_FORMAT", message=str(exc))
        return 1
    except SchemaValidationError as exc:
        log_event("pipeline_failed", code="PIPELINE_RESULT_INVALID_SCHEMA", message=str(exc))
        return 1
    except Exception as exc:  # noqa: BLE001 — boundary CLI, phải trả exit code rõ cho Node
        log_event("pipeline_failed", code="PIPELINE_ERROR", message=str(exc))
        return 1

    with open(args.result_output, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    log_event("pipeline_done", confidenceScore=result["confidenceScore"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
