import { expect, test } from "playwright/test";

import {
  FP16_PARITY_THRESHOLDS,
  FP32_PARITY_THRESHOLDS,
  evaluateBrowserParity,
  type DetectionForParity
} from "./benchmark-parity";

function detection(overrides: Partial<DetectionForParity> = {}): DetectionForParity {
  return {
    box: { xMin: 0, yMin: 0, xMax: 100, yMax: 100 },
    labelId: 22,
    polygon: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ],
    readingOrder: 0,
    score: 0.9,
    ...overrides
  };
}

test("FP32 preserves strict accepted-model equality thresholds", () => {
  const result = evaluateBrowserParity(
    "fp32",
    [detection()],
    [
      detection({
        box: { xMin: 1.01, yMin: 0, xMax: 100, yMax: 100 },
        score: 0.8989
      })
    ]
  );

  expect(result.parityThresholds).toEqual(FP32_PARITY_THRESHOLDS);
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("box coordinate delta exceeds 1 px");
  expect(result.validationErrors).toContain("score delta exceeds 0.001");
});

test("FP16 accepts approved quantization differences", () => {
  const result = evaluateBrowserParity(
    "fp16",
    [detection()],
    [
      detection({
        box: { xMin: 1, yMin: 0, xMax: 101, yMax: 100 },
        polygon: [
          { x: 1.5, y: 0 },
          { x: 101.5, y: 0 },
          { x: 101.5, y: 100 },
          { x: 1.5, y: 100 }
        ],
        score: 0.881
      })
    ]
  );

  expect(result.parityThresholds).toEqual(FP16_PARITY_THRESHOLDS);
  expect(result.parity).toBe("passed");
  expect(result.parityMetrics).toMatchObject({
    matchedDetectionPrecision: 1,
    matchedDetectionRatio: 1,
    matchedDetections: 1
  });
});

test("FP16 rejects insufficient IoU matches", () => {
  const result = evaluateBrowserParity(
    "fp16",
    [detection()],
    [detection({ box: { xMin: 20, yMin: 0, xMax: 120, yMax: 100 } })]
  );
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("matched detection ratio is below 0.99");
});

test("FP16 rejects score drift above 0.02", () => {
  const result = evaluateBrowserParity("fp16", [detection()], [detection({ score: 0.879 })]);
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("score delta exceeds 0.02");
});

test("FP16 rejects mean polygon distance above 2 px", () => {
  const result = evaluateBrowserParity(
    "fp16",
    [detection()],
    [
      detection({
        polygon: [
          { x: 3, y: 0 },
          { x: 103, y: 0 },
          { x: 103, y: 100 },
          { x: 3, y: 100 }
        ]
      })
    ]
  );
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("mean polygon distance exceeds 2 px");
});
