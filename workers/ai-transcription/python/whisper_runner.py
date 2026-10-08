"""faster-whisper STT runner (T014).

Load model theo WHISPER_MODEL/WHISPER_DEVICE/WHISPER_COMPUTE_TYPE đang active
(không hard-code large-v3). local_files_only khi WHISPER_LOCAL_FILES_ONLY=true
— không gọi network nếu model đã preload sẵn trong models/.
"""

import math
import os
from typing import Any, Dict, List, Optional

from faster_whisper import WhisperModel
from faster_whisper.vad import VadOptions


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _resolve_model_ref(model_size_or_path: str) -> str:
    """Nếu có WHISPER_MODEL_PATH (volume model đã preload) và tồn tại, dùng path
    đó. Ngược lại fallback dùng model_size_or_path (tên model, faster-whisper sẽ
    tải từ HuggingFace Hub trừ khi local_files_only=true)."""
    model_path = os.environ.get("WHISPER_MODEL_PATH")
    if model_path and os.path.isdir(model_path):
        return model_path
    return model_size_or_path


def transcribe(
    audio_path: str,
    model_size_or_path: str,
    device: str,
    compute_type: str,
    language: Optional[str] = None,
    initial_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Chạy faster-whisper trên audio_path đã normalize 16kHz mono.

    initial_prompt: gợi ý từ vựng/ngữ cảnh (custom vocabulary — tên riêng,
    thuật ngữ ngành) truyền cho whisper để cải thiện nhận diện proper noun.
    Không bắt buộc; lấy từ config (WHISPER_INITIAL_PROMPT) hoặc job payload.

    Trả về dict: languageCode, rawText, segments (list segment thô có startMs/
    endMs/text/confidence), confidenceScore (trung bình segment confidence).
    """
    local_files_only = os.environ.get("WHISPER_LOCAL_FILES_ONLY", "false") == "true"
    model_ref = _resolve_model_ref(model_size_or_path)

    # faster-whisper chấp nhận mã 2 ký tự (vi, en...), không phải vi-VN.
    whisper_language = language.split("-")[0] if language else None

    model = WhisperModel(
        model_ref,
        device=device,
        compute_type=compute_type,
        local_files_only=local_files_only,
    )

    # GA-10 (2026-08-02, feat-transcript-segment-merge): vad_filter=True một
    # mình dùng mặc định thư viện (VadOptions.min_silence_duration_ms=2000ms,
    # xác nhận thật trên faster-whisper==1.2.1 đang cài) — vẫn hay cắt câu giữa
    # chừng ở khoảng lặng ngắn. Truyền vad_parameters tường minh, đọc ngưỡng im
    # lặng từ env để không hard-code, cho phép benchmark (T-MERGE-005) tinh
    # chỉnh mà không sửa code.
    vad_min_silence_ms = _env_int("WHISPER_VAD_MIN_SILENCE_MS", 2000)
    vad_parameters = VadOptions(min_silence_duration_ms=vad_min_silence_ms)
    no_speech_threshold = _env_float("WHISPER_NO_SPEECH_PROB_THRESHOLD", 0.5)
    no_speech_rescue_min_confidence = _env_float(
        "WHISPER_NO_SPEECH_RESCUE_MIN_CONFIDENCE", 0.35
    )
    no_speech_rescue_max_probability = _env_float(
        "WHISPER_NO_SPEECH_RESCUE_MAX_PROBABILITY", 0.85
    )

    def run_pass(vad_filter: bool) -> tuple[Any, List[Dict[str, Any]], List[str], List[float]]:
        kwargs: Dict[str, Any] = {}
        if vad_filter:
            kwargs["vad_parameters"] = vad_parameters
        segments_iter, pass_info = model.transcribe(
            audio_path,
            language=whisper_language,
            task="transcribe",
            beam_size=5,
            vad_filter=vad_filter,
            temperature=0.0,
            initial_prompt=initial_prompt,
            # condition_on_previous_text=True (default) làm model thiên về lặp lại
            # output trước đó -> hallucination loop kiểu "Được rồi." lặp hàng chục
            # lần trên đoạn nhiễu/im lặng. Tắt đi + thêm repetition_penalty/
            # no_repeat_ngram_size để chặn lặp cụm từ.
            condition_on_previous_text=False,
            repetition_penalty=1.3,
            no_repeat_ngram_size=3,
            **kwargs,
        )
        pass_segments: List[Dict[str, Any]] = []
        pass_text_parts: List[str] = []
        pass_confidences: List[float] = []
        rejected_no_speech_segments: List[Dict[str, Any]] = []
        rejected_no_speech_text_parts: List[str] = []
        rejected_no_speech_confidences: List[float] = []

        for idx, seg in enumerate(segments_iter):
            text = seg.text.strip()
            if not text:
                continue
            no_speech_prob = getattr(seg, "no_speech_prob", None)
            confidence = None
            if seg.avg_logprob is not None:
                confidence = max(0.0, min(1.0, math.exp(seg.avg_logprob)))
            candidate = {
                "index": idx,
                "startMs": int(round(seg.start * 1000)),
                "endMs": int(round(seg.end * 1000)),
                "text": text,
                "confidence": confidence,
            }
            if no_speech_prob is not None and no_speech_prob >= no_speech_threshold:
                if (
                    confidence is not None
                    and confidence >= no_speech_rescue_min_confidence
                    and no_speech_prob <= no_speech_rescue_max_probability
                ):
                    rejected_no_speech_segments.append(candidate)
                    rejected_no_speech_text_parts.append(text)
                    rejected_no_speech_confidences.append(confidence)
                continue
            if confidence is not None:
                pass_confidences.append(confidence)
            pass_text_parts.append(text)
            pass_segments.append(candidate)
        if not pass_segments and rejected_no_speech_segments:
            return (
                pass_info,
                rejected_no_speech_segments,
                rejected_no_speech_text_parts,
                rejected_no_speech_confidences,
            )
        return pass_info, pass_segments, pass_text_parts, pass_confidences

    info, segments, text_parts, confidences = run_pass(vad_filter=True)
    if not segments and os.environ.get("WHISPER_FALLBACK_NO_VAD", "true") == "true":
        info, segments, text_parts, confidences = run_pass(vad_filter=False)

    overall_confidence = sum(confidences) / len(confidences) if confidences else 0.0
    detected_language = language or getattr(info, "language", None) or "vi-VN"

    return {
        "languageCode": detected_language,
        "rawText": " ".join(text_parts).strip(),
        "segments": segments,
        "confidenceScore": overall_confidence,
    }
