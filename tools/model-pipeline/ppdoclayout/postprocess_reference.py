from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import numpy as np
import torch


OUTPUT_NAMES = ("logits", "pred_boxes", "order_logits", "out_masks")


def as_transformers_output(outputs: dict[str, np.ndarray]) -> SimpleNamespace:
    return SimpleNamespace(
        **{name: torch.from_numpy(outputs[name]) for name in OUTPUT_NAMES}
    )


def tensor_metrics(reference: np.ndarray, candidate: np.ndarray) -> dict[str, float]:
    difference = np.abs(reference.astype(np.float64) - candidate.astype(np.float64))
    return {
        "maxAbsoluteError": float(difference.max(initial=0.0)),
        "meanAbsoluteError": float(difference.mean()),
    }


def compare_postprocessed(
    reference: dict[str, Any], candidate: dict[str, Any]
) -> dict[str, Any]:
    reference_labels = reference["labels"].detach().cpu().numpy()
    candidate_labels = candidate["labels"].detach().cpu().numpy()
    reference_order = reference["order_seq"].detach().cpu().numpy()
    candidate_order = candidate["order_seq"].detach().cpu().numpy()
    paired = min(len(reference_labels), len(candidate_labels))

    label_mismatches = [
        index
        for index in range(paired)
        if int(reference_labels[index]) != int(candidate_labels[index])
    ]
    unmatched_reference = label_mismatches + list(
        range(paired, len(reference_labels))
    )
    unmatched_candidate = label_mismatches + list(
        range(paired, len(candidate_labels))
    )

    max_score_delta = _max_delta(reference["scores"], candidate["scores"])
    max_box_delta = _max_delta(reference["boxes"], candidate["boxes"])
    polygon_delta = _max_polygon_delta(
        reference["polygon_points"], candidate["polygon_points"]
    )

    return {
        "detectionCountOfficial": int(len(reference_labels)),
        "detectionCountOnnx": int(len(candidate_labels)),
        "unmatchedOfficial": unmatched_reference,
        "unmatchedOnnx": unmatched_candidate,
        "labelSequenceEqual": bool(
            np.array_equal(reference_labels, candidate_labels)
        ),
        "readingOrderEqual": bool(np.array_equal(reference_order, candidate_order)),
        "maxScoreDelta": max_score_delta,
        "maxBoxCoordinateDeltaPixels": max_box_delta,
        "maxPolygonCoordinateDeltaPixels": polygon_delta,
    }


def _max_delta(reference: torch.Tensor, candidate: torch.Tensor) -> float:
    reference_array = reference.detach().cpu().numpy().astype(np.float64)
    candidate_array = candidate.detach().cpu().numpy().astype(np.float64)
    if reference_array.shape != candidate_array.shape:
        return float("inf")
    return float(np.abs(reference_array - candidate_array).max(initial=0.0))


def _max_polygon_delta(
    reference_polygons: list[np.ndarray], candidate_polygons: list[np.ndarray]
) -> float:
    if len(reference_polygons) != len(candidate_polygons):
        return float("inf")

    maximum = 0.0
    for reference, candidate in zip(reference_polygons, candidate_polygons):
        reference_array = np.asarray(reference, dtype=np.float64)
        candidate_array = np.asarray(candidate, dtype=np.float64)
        if reference_array.shape != candidate_array.shape:
            return float("inf")
        maximum = max(
            maximum,
            float(np.abs(reference_array - candidate_array).max(initial=0.0)),
        )
    return maximum
