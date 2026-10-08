"""pytest cho transcribe_pipeline.py orchestrator (T015, scope M1).

Mock preprocess_audio/transcribe để test logic build kết quả + cảnh báo
low-confidence mà không cần model faster-whisper thật (nhanh, deterministic).
Smoke test với faster-whisper thật nằm ở T033 (cần fixture audio thật từ
T-DATA-001), không nằm trong unit test này.
"""

from unittest.mock import patch

import transcribe_pipeline
from diarization_runner import DiarizationUnavailableError
from schemas import new_segment


def _mock_preprocess(*_args, **_kwargs):
    return {"durationSeconds": 12.0, "sampleRate": 16000, "channels": 1, "originalChannels": 1}


def test_run_pipeline_builds_valid_result_high_confidence():
    mock_whisper_result = {
        "languageCode": "vi-VN",
        "rawText": "Chào mọi người hôm nay chúng ta họp",
        "segments": [
            {"index": 0, "startMs": 0, "endMs": 2000, "text": "Chào mọi người", "confidence": 0.92},
            {"index": 1, "startMs": 2000, "endMs": 4000, "text": "hôm nay chúng ta họp", "confidence": 0.88},
        ],
        "confidenceScore": 0.9,
    }

    with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
         patch.object(transcribe_pipeline, "transcribe", return_value=mock_whisper_result):
        result = transcribe_pipeline.run_pipeline(
            input_path="fake-input.wav",
            normalized_output_path="fake-normalized.wav",
            model="small",
            device="cpu",
            compute_type="int8",
            language="vi-VN",
        )

    assert result["languageCode"] == "vi-VN"
    assert result["rawText"] == mock_whisper_result["rawText"]
    assert result["cleanedText"] == mock_whisper_result["rawText"]
    assert len(result["segments"]) == 2
    assert result["segments"][0]["segmentId"] == "seg-0000"
    assert result["segments"][0]["speakerLabel"] == "unknown"
    assert result["detectedSpeakers"] == []
    assert result["modelVersions"] == {"whisper": "small", "pyannote": None, "sepformer": None}
    assert "low_confidence_transcript" not in result["warnings"]


def test_run_pipeline_flags_low_confidence_warning():
    mock_whisper_result = {
        "languageCode": "vi-VN",
        "rawText": "ờ ờ không rõ",
        "segments": [
            {"index": 0, "startMs": 0, "endMs": 1000, "text": "ờ ờ không rõ", "confidence": 0.2},
        ],
        "confidenceScore": 0.2,
    }

    with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
         patch.object(transcribe_pipeline, "transcribe", return_value=mock_whisper_result):
        result = transcribe_pipeline.run_pipeline(
            input_path="fake-input.wav",
            normalized_output_path="fake-normalized.wav",
            model="small",
            device="cpu",
            compute_type="int8",
            language="vi-VN",
        )

    assert "low_confidence_transcript" in result["warnings"]
    assert result["segments"][0]["manualReviewRequired"] is True


def test_run_pipeline_handles_zero_segments():
    mock_whisper_result = {
        "languageCode": "vi-VN",
        "rawText": "",
        "segments": [],
        "confidenceScore": 0.0,
    }

    with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
         patch.object(transcribe_pipeline, "transcribe", return_value=mock_whisper_result):
        result = transcribe_pipeline.run_pipeline(
            input_path="fake-input.wav",
            normalized_output_path="fake-normalized.wav",
            model="small",
            device="cpu",
            compute_type="int8",
            language="vi-VN",
        )

    assert result["rawText"] == ""
    assert result["segments"] == []
    assert "low_confidence_transcript" in result["warnings"]
    assert "no_reliable_speech_detected" in result["warnings"]


class TestCollapseRepeatedSegments:
    """REGRESSION: hallucination loop kiểu 'Được rồi.' lặp hàng chục lần
    (gặp thật trên audio nhiễu/im lặng dùng whisper small)."""

    @staticmethod
    def _seg(idx, text, conf=0.6):
        return new_segment(f"seg-{idx:04d}", idx * 1000, idx * 1000 + 1000, text, conf)

    def test_collapses_long_repeat_run(self):
        segments = [self._seg(i, "Được rồi.") for i in range(7)]
        collapsed, runs = transcribe_pipeline.collapse_repeated_segments(segments)

        assert runs == 1
        assert len(collapsed) == 1
        assert collapsed[0]["manualReviewRequired"] is True
        assert collapsed[0]["startMs"] == segments[0]["startMs"]
        assert collapsed[0]["endMs"] == segments[-1]["endMs"]

    def test_short_repeat_not_collapsed(self):
        # Lặp tự nhiên trong hội thoại (vd "vâng vâng vâng") không bị gộp.
        segments = [self._seg(i, "Vâng.") for i in range(3)]
        collapsed, runs = transcribe_pipeline.collapse_repeated_segments(segments)

        assert runs == 0
        assert len(collapsed) == 3

    def test_mixed_segments_only_collapses_the_repeat_run(self):
        segments = (
            [self._seg(0, "Chào mọi người.")]
            + [self._seg(i, "Được rồi.") for i in range(1, 8)]
            + [self._seg(8, "Cảm ơn.")]
        )
        collapsed, runs = transcribe_pipeline.collapse_repeated_segments(segments)

        assert runs == 1
        assert len(collapsed) == 3
        assert collapsed[0]["text"] == "Chào mọi người."
        assert collapsed[1]["manualReviewRequired"] is True
        assert collapsed[2]["text"] == "Cảm ơn."


class TestDiarizationIntegration:
    """M2 — gọi run_pipeline với diarization_enabled=True, mock diarize/
    detect_overlaps (đã import trực tiếp vào namespace transcribe_pipeline)."""

    @staticmethod
    def _mock_whisper_two_segments():
        return {
            "languageCode": "vi-VN",
            "rawText": "Xin chào Chào bạn",
            "segments": [
                {"index": 0, "startMs": 0, "endMs": 2000, "text": "Xin chào", "confidence": 0.9},
                {"index": 1, "startMs": 2000, "endMs": 4000, "text": "Chào bạn", "confidence": 0.9},
            ],
            "confidenceScore": 0.9,
        }

    def test_diarization_success_assigns_speakers_and_builds_detected_speakers(self):
        turns = [
            {"startMs": 0, "endMs": 2000, "speakerLabel": "Speaker_1"},
            {"startMs": 2000, "endMs": 4000, "speakerLabel": "Speaker_2"},
        ]
        with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
             patch.object(transcribe_pipeline, "transcribe", return_value=self._mock_whisper_two_segments()), \
             patch.object(transcribe_pipeline, "diarize", return_value=turns), \
             patch.object(transcribe_pipeline, "detect_overlaps", return_value=[]):
            result = transcribe_pipeline.run_pipeline(
                input_path="fake-input.wav",
                normalized_output_path="fake-normalized.wav",
                model="medium",
                device="cpu",
                compute_type="int8",
                language="vi-VN",
                diarization_enabled=True,
                overlap_detection_enabled=True,
            )

        assert result["segments"][0]["speakerLabel"] == "Speaker_1"
        assert result["segments"][1]["speakerLabel"] == "Speaker_2"
        assert len(result["detectedSpeakers"]) == 2
        assert result["modelVersions"]["pyannote"] == "pyannote-local"
        assert "diarization_failed_fallback_unknown" not in result["warnings"]

    def test_diarization_failure_falls_back_to_unknown_without_failing_job(self):
        with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
             patch.object(transcribe_pipeline, "transcribe", return_value=self._mock_whisper_two_segments()), \
             patch.object(
                 transcribe_pipeline,
                 "diarize",
                 side_effect=DiarizationUnavailableError("model missing"),
             ):
            result = transcribe_pipeline.run_pipeline(
                input_path="fake-input.wav",
                normalized_output_path="fake-normalized.wav",
                model="medium",
                device="cpu",
                compute_type="int8",
                language="vi-VN",
                diarization_enabled=True,
                overlap_detection_enabled=True,
            )

        assert "diarization_failed_fallback_unknown" in result["warnings"]
        assert all(s["speakerLabel"] == "unknown" for s in result["segments"])
        assert result["detectedSpeakers"] == []
        assert result["modelVersions"]["pyannote"] is None

    def test_overlap_detection_disabled_skips_overlap_flagging_even_with_diarization(self):
        # 2 turn chồng thời gian thật sự (1000-3000 và 2000-4000), nhưng
        # overlap_detection_enabled=False -> detect_overlaps KHÔNG được gọi,
        # segment không bị đánh dấu overlap=true dù turns có giao nhau.
        turns = [
            {"startMs": 0, "endMs": 2000, "speakerLabel": "Speaker_1"},
            {"startMs": 2000, "endMs": 4000, "speakerLabel": "Speaker_2"},
        ]
        with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
             patch.object(transcribe_pipeline, "transcribe", return_value=self._mock_whisper_two_segments()), \
             patch.object(transcribe_pipeline, "diarize", return_value=turns), \
             patch.object(transcribe_pipeline, "detect_overlaps") as mock_detect_overlaps:
            result = transcribe_pipeline.run_pipeline(
                input_path="fake-input.wav",
                normalized_output_path="fake-normalized.wav",
                model="medium",
                device="cpu",
                compute_type="int8",
                language="vi-VN",
                diarization_enabled=True,
                overlap_detection_enabled=False,
            )

        mock_detect_overlaps.assert_not_called()
        assert all(s["overlap"] is False for s in result["segments"])

    def test_diarization_disabled_keeps_m1_behavior_unchanged(self):
        with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
             patch.object(transcribe_pipeline, "transcribe", return_value=self._mock_whisper_two_segments()), \
             patch.object(transcribe_pipeline, "diarize") as mock_diarize:
            result = transcribe_pipeline.run_pipeline(
                input_path="fake-input.wav",
                normalized_output_path="fake-normalized.wav",
                model="small",
                device="cpu",
                compute_type="int8",
                language="vi-VN",
            )

        mock_diarize.assert_not_called()
        assert all(s["speakerLabel"] == "unknown" for s in result["segments"])
        assert result["detectedSpeakers"] == []
        assert result["modelVersions"] == {"whisper": "small", "pyannote": None, "sepformer": None}


class TestHallucinationCollapse:
    def test_run_pipeline_collapses_hallucination_loop_end_to_end(self):
        repeated = [
            {"index": i, "startMs": i * 1000, "endMs": i * 1000 + 1000, "text": "Được rồi.", "confidence": 0.6}
            for i in range(6)
        ]
        mock_whisper_result = {
            "languageCode": "vi-VN",
            "rawText": "Được rồi. " * 6,
            "segments": repeated,
            "confidenceScore": 0.6,
        }

        with patch.object(transcribe_pipeline, "preprocess_audio", side_effect=_mock_preprocess), \
             patch.object(transcribe_pipeline, "transcribe", return_value=mock_whisper_result):
            result = transcribe_pipeline.run_pipeline(
                input_path="fake-input.wav",
                normalized_output_path="fake-normalized.wav",
                model="small",
                device="cpu",
                compute_type="int8",
                language="vi-VN",
            )

        assert len(result["segments"]) == 1
        assert result["segments"][0]["manualReviewRequired"] is True
        assert result["rawText"] == "Được rồi."
        assert "low_confidence_transcript" in result["warnings"]
