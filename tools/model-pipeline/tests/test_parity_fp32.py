import json
from pathlib import Path

import pytest

from ppdoclayout.validate import (
    canonical_json,
    sha256_file,
    validate_fp32,
    write_report,
)


ROOT = Path(__file__).parents[3]


def test_canonical_json_matches_prettier_exponent_style() -> None:
    rendered = canonical_json({"value": 0.000001})

    assert '"value": 1e-6' in rendered
    assert json.loads(rendered) == {"value": 0.000001}


def test_write_report_uses_lf_line_endings(tmp_path: Path) -> None:
    output = tmp_path / "report.json"

    write_report(output, {"nested": {"value": 1}})

    assert b"\r\n" not in output.read_bytes()


@pytest.mark.slow
def test_sanitized_fp32_matches_accepted_fp32_and_official_transformers() -> None:
    accepted = (
        ROOT / "models" / "pp-doclayoutv3" / "1.0.0" / "model-fp32.onnx"
    )
    candidate = (
        ROOT / "models" / "pp-doclayoutv3" / "1.0.1" / "model-fp32.onnx"
    )
    model_path = Path(r"E:\models\PP-DocLayoutV3_safetensors")
    report = validate_fp32(
        model_path=model_path,
        accepted_onnx_path=accepted,
        onnx_path=candidate,
        fixtures_lock=ROOT / "tools" / "model-pipeline" / "fixtures" / "fixtures.lock.json",
    )

    assert report["overallPass"] is True
    assert report["sourceHashes"] == {
        "acceptedOnnx": sha256_file(accepted),
        "modelSafetensors": sha256_file(model_path / "model.safetensors"),
        "onnx": sha256_file(candidate),
    }
    assert report["thresholds"] == {
        "boxCoordinateDeltaPixels": 1.0,
        "polygonCoordinateDeltaPixels": 1.5,
        "scoreDelta": 0.001,
    }
    assert len(report["fixtures"]) == 7
    for fixture in report["fixtures"]:
        assert fixture["acceptedDetectionCount"] == fixture["onnxDetectionCount"]
        assert fixture["acceptedLabelSequenceEqual"] is True
        assert fixture["acceptedReadingOrderEqual"] is True
        assert fixture["rawOutputs"]["allBitIdentical"] is True
        assert fixture["unmatchedOfficial"] == []
        assert fixture["unmatchedOnnx"] == []
        assert fixture["labelSequenceEqual"] is True
        assert fixture["readingOrderEqual"] is True
        assert fixture["maxScoreDelta"] <= 0.001
        assert fixture["maxBoxCoordinateDeltaPixels"] <= 1.0
        assert fixture["maxPolygonCoordinateDeltaPixels"] <= 1.5
        assert fixture["pass"] is True
