import json
from pathlib import Path
from types import SimpleNamespace

from ppdoclayout.inspect_model import processor_metadata


def test_contract_contains_required_outputs(model_contract_path: Path) -> None:
    assert model_contract_path.exists(), (
        f"model contract has not been generated: {model_contract_path}"
    )
    model_contract = json.loads(model_contract_path.read_text(encoding="utf-8"))
    assert model_contract["input"]["name"] == "pixel_values"
    assert model_contract["input"]["shape"] == [1, 3, 800, 800]
    assert {"logits", "out_masks", "order_logits", "pred_boxes"} <= set(
        model_contract["outputs"]
    )
    assert model_contract["parameterCount"] > 0
    assert len(model_contract["labels"]) == 25
    assert {"torch", "torchvision", "transformers"} <= set(model_contract["versions"])


def test_processor_metadata_is_json_serializable() -> None:
    class SizeValue:
        def __init__(self) -> None:
            self.height = 800
            self.width = 800
            self.longest_edge = None

    processor = SimpleNamespace(
        do_normalize=True,
        do_rescale=True,
        do_resize=True,
        image_mean=[0.0, 0.0, 0.0],
        image_std=[1.0, 1.0, 1.0],
        resample=3,
        rescale_factor=1 / 255,
        size=SizeValue(),
    )

    metadata = processor_metadata(processor)

    json.dumps(metadata)
    assert metadata["size"] == {
        "height": 800,
        "longest_edge": None,
        "width": 800,
    }
