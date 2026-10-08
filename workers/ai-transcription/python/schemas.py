"""Schema validation cho output của AI pipeline (T013).

Mirror Python của contracts/ai-worker-result-schema.json. Dùng validation tay
(không phụ thuộc package jsonschema) — chỉ kiểm các field/enum bắt buộc theo
schema, đủ để chặn JSON sai trước khi Node worker ghi vào DB.
"""

from typing import Any, Dict, List

REQUIRED_TOP_LEVEL = [
    "languageCode",
    "rawText",
    "cleanedText",
    "confidenceScore",
    "segments",
    "detectedSpeakers",
    "modelVersions",
    "warnings",
]

REQUIRED_SEGMENT_FIELDS = [
    "segmentId",
    "startMs",
    "endMs",
    "text",
    "speakerLabel",
    "speakerSource",
    "userId",
    "channelId",
    "roomZoneLabel",
    "sttConfidence",
    "diarizationConfidence",
    "separationConfidence",
    "finalConfidence",
    "overlap",
    "lowConfidence",
    "manualReviewRequired",
    "notes",
]

REQUIRED_DETECTED_SPEAKER_FIELDS = [
    "speakerLabel",
    "totalSpeakingMs",
    "segmentCount",
    "mappedUserId",
    "mappingSource",
    "confidence",
]

VALID_SPEAKER_SOURCE = {"pyannote", "channel_zone", "sepformer", "unknown"}
VALID_MAPPING_SOURCE = {"diarization", "channel_zone", "manual", "unmapped"}
VALID_WARNINGS = {
    "diarization_failed_fallback_unknown",
    "overlap_separation_low_confidence",
    "sepformer_skipped_low_resources",
    "sepformer_error_skipped",
    "low_confidence_transcript",
    "no_reliable_speech_detected",
    "chunking_applied",
}


class SchemaValidationError(Exception):
    pass


def validate_result(result: Dict[str, Any]) -> None:
    """Validate toàn bộ kết quả pipeline. Raise SchemaValidationError nếu sai."""
    for key in REQUIRED_TOP_LEVEL:
        if key not in result:
            raise SchemaValidationError(f"Missing top-level field: {key}")

    if not isinstance(result["segments"], list):
        raise SchemaValidationError("segments phải là list")
    for idx, segment in enumerate(result["segments"]):
        _validate_segment(segment, idx)

    if not isinstance(result["detectedSpeakers"], list):
        raise SchemaValidationError("detectedSpeakers phải là list")
    for idx, speaker in enumerate(result["detectedSpeakers"]):
        _validate_detected_speaker(speaker, idx)

    if not isinstance(result["modelVersions"], dict) or "whisper" not in result["modelVersions"]:
        raise SchemaValidationError("modelVersions.whisper là bắt buộc")

    if not isinstance(result["warnings"], list):
        raise SchemaValidationError("warnings phải là list")
    for warning in result["warnings"]:
        if warning not in VALID_WARNINGS:
            raise SchemaValidationError(f"Unknown warning code: {warning}")


def _validate_segment(segment: Dict[str, Any], idx: int) -> None:
    for key in REQUIRED_SEGMENT_FIELDS:
        if key not in segment:
            raise SchemaValidationError(f"segments[{idx}] missing field: {key}")
    if segment["speakerSource"] not in VALID_SPEAKER_SOURCE:
        raise SchemaValidationError(
            f"segments[{idx}] invalid speakerSource: {segment['speakerSource']}"
        )
    if segment["speakerLabel"] == "unknown" and segment.get("userId") is not None:
        raise SchemaValidationError(
            f"segments[{idx}] speakerLabel=unknown nhưng userId khác null"
        )


def _validate_detected_speaker(speaker: Dict[str, Any], idx: int) -> None:
    for key in REQUIRED_DETECTED_SPEAKER_FIELDS:
        if key not in speaker:
            raise SchemaValidationError(
                f"detectedSpeakers[{idx}] missing field: {key}"
            )
    if speaker["mappingSource"] not in VALID_MAPPING_SOURCE:
        raise SchemaValidationError(
            f"detectedSpeakers[{idx}] invalid mappingSource: {speaker['mappingSource']}"
        )


def new_segment(
    segment_id: str,
    start_ms: int,
    end_ms: int,
    text: str,
    stt_confidence: float | None,
    low_confidence_threshold: float = 0.5,
) -> Dict[str, Any]:
    """Builder cho 1 segment ở scope M1 (không diarization/separation) — mọi
    segment có speakerLabel=unknown, KHÔNG được ép gán speaker khi chưa chạy
    diarization (M2)."""
    confidence = stt_confidence if stt_confidence is not None else 0.0
    low_confidence = confidence < low_confidence_threshold
    return {
        "segmentId": segment_id,
        "startMs": start_ms,
        "endMs": end_ms,
        "text": text,
        "speakerLabel": "unknown",
        "speakerSource": "unknown",
        "userId": None,
        "channelId": None,
        "roomZoneLabel": None,
        "sttConfidence": stt_confidence,
        "diarizationConfidence": None,
        "separationConfidence": None,
        "finalConfidence": confidence,
        "overlap": False,
        "lowConfidence": low_confidence,
        "manualReviewRequired": low_confidence,
        "notes": ["m1_scope_no_diarization"] if low_confidence else [],
    }
