from app.services.arduino_cli import _compile_jobs_args


def test_unset_keeps_arduino_cli_default(monkeypatch):
    monkeypatch.delenv("VELXIO_ARDUINO_JOBS", raising=False)
    assert _compile_jobs_args() == []


def test_zero_and_garbage_keep_default(monkeypatch):
    for value in ("0", "-3", "lots", "  "):
        monkeypatch.setenv("VELXIO_ARDUINO_JOBS", value)
        assert _compile_jobs_args() == []


def test_positive_value_is_passed(monkeypatch):
    monkeypatch.setenv("VELXIO_ARDUINO_JOBS", " 2 ")
    assert _compile_jobs_args() == ["--jobs", "2"]


def test_value_is_clamped(monkeypatch):
    monkeypatch.setenv("VELXIO_ARDUINO_JOBS", "1000")
    assert _compile_jobs_args() == ["--jobs", "64"]
