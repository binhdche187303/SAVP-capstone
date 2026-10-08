"""pytest cho whisper_runner.py — GA-10 (feat-transcript-segment-merge/spec.md
FR-004/FR-008): xác nhận vad_parameters được truyền tường minh cho
WhisperModel.transcribe(), đọc ngưỡng từ env WHISPER_VAD_MIN_SILENCE_MS.

Mock WhisperModel qua unittest.mock — không load model thật (chậm, cần file
audio thật). Test chỉ xác nhận HỢP ĐỒNG giữa whisper_runner và thư viện
faster-whisper, không test chất lượng STT thật (việc đó thuộc benchmark
T-MERGE-005, đo trên audio thật)."""

from unittest.mock import MagicMock, patch
from types import SimpleNamespace

from faster_whisper.vad import VadOptions

from whisper_runner import transcribe


def _fake_model(monkeypatch):
    fake_info = MagicMock()
    fake_info.language = "vi"
    mock_model_instance = MagicMock()
    mock_model_instance.transcribe.return_value = ([], fake_info)
    mock_model_cls = MagicMock(return_value=mock_model_instance)
    monkeypatch.setattr("whisper_runner.WhisperModel", mock_model_cls)
    return mock_model_instance


def test_vad_parameters_uses_default_2000ms_when_env_unset(monkeypatch):
    monkeypatch.delenv("WHISPER_VAD_MIN_SILENCE_MS", raising=False)
    mock_model_instance = _fake_model(monkeypatch)

    transcribe("fake.wav", "medium", "cpu", "int8", language="vi-VN")

    _, kwargs = mock_model_instance.transcribe.call_args_list[0]
    assert kwargs["vad_filter"] is True
    vad_params = kwargs["vad_parameters"]
    assert isinstance(vad_params, VadOptions)
    assert vad_params.min_silence_duration_ms == 2000


def test_vad_parameters_reads_min_silence_from_env(monkeypatch):
    monkeypatch.setenv("WHISPER_VAD_MIN_SILENCE_MS", "3500")
    mock_model_instance = _fake_model(monkeypatch)

    transcribe("fake.wav", "medium", "cpu", "int8", language="vi-VN")

    _, kwargs = mock_model_instance.transcribe.call_args_list[0]
    vad_params = kwargs["vad_parameters"]
    assert vad_params.min_silence_duration_ms == 3500


def test_vad_parameters_falls_back_to_default_on_invalid_env(monkeypatch):
    monkeypatch.setenv("WHISPER_VAD_MIN_SILENCE_MS", "not-a-number")
    mock_model_instance = _fake_model(monkeypatch)

    transcribe("fake.wav", "medium", "cpu", "int8", language="vi-VN")

    _, kwargs = mock_model_instance.transcribe.call_args_list[0]
    assert kwargs["vad_parameters"].min_silence_duration_ms == 2000


def test_filters_high_no_speech_probability_segments(monkeypatch):
    monkeypatch.delenv("WHISPER_NO_SPEECH_PROB_THRESHOLD", raising=False)
    fake_info = MagicMock()
    fake_info.language = "vi"
    mock_model_instance = MagicMock()
    mock_model_instance.transcribe.return_value = (
        [
            SimpleNamespace(
                text="Hãy subscribe cho kênh Ghiền Mì Gõ",
                start=3.89,
                end=5.89,
                avg_logprob=-0.36,
                no_speech_prob=0.56,
            ),
            SimpleNamespace(
                text="Nội dung cuộc họp thật",
                start=6.0,
                end=7.0,
                avg_logprob=-0.1,
                no_speech_prob=0.1,
            ),
        ],
        fake_info,
    )
    monkeypatch.setattr(
        "whisper_runner.WhisperModel",
        MagicMock(return_value=mock_model_instance),
    )

    result = transcribe("fake.wav", "medium", "cpu", "int8", language="vi-VN")

    assert result["rawText"] == "Nội dung cuộc họp thật"
    assert len(result["segments"]) == 1


def test_no_speech_threshold_can_be_overridden(monkeypatch):
    monkeypatch.setenv("WHISPER_NO_SPEECH_PROB_THRESHOLD", "0.9")
    fake_info = MagicMock()
    fake_info.language = "vi"
    mock_model_instance = MagicMock()
    mock_model_instance.transcribe.return_value = (
        [
            SimpleNamespace(
                text="Câu vẫn được giữ",
                start=0.0,
                end=1.0,
                avg_logprob=-0.1,
                no_speech_prob=0.56,
            )
        ],
        fake_info,
    )
    monkeypatch.setattr(
        "whisper_runner.WhisperModel",
        MagicMock(return_value=mock_model_instance),
    )

    result = transcribe("fake.wav", "medium", "cpu", "int8", language="vi-VN")

    assert result["rawText"] == "Câu vẫn được giữ"
