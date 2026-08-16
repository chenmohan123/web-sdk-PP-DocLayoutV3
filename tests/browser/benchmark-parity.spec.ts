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

function positionedDetection(index: number): DetectionForParity {
  const box = { xMin: index * 10, yMin: 0, xMax: index * 10 + 8, yMax: 8 };
  return detection({
    box,
    polygon: [
      { x: box.xMin, y: box.yMin },
      { x: box.xMax, y: box.yMin },
      { x: box.xMax, y: box.yMax },
      { x: box.xMin, y: box.yMax }
    ],
    readingOrder: index
  });
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
    matchedDetections: 1,
    meanMatchedIoU: expect.any(Number),
    p05MatchedIoU: expect.any(Number),
    minMatchedIoU: expect.any(Number)
  });
});

test("FP16 rejects insufficient IoU matches", () => {
  const result = evaluateBrowserParity(
    "fp16",
    [detection()],
    [detection({ box: { xMin: 30, yMin: 0, xMax: 130, yMax: 100 } })]
  );
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("minimum matched IoU is below 0.8");
});

test("FP16 rejects score drift above 0.02", () => {
  const result = evaluateBrowserParity("fp16", [detection()], [detection({ score: 0.879 })]);
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("score delta exceeds 0.02");
});

test("FP16 compares polygon edges instead of vertex indexes", () => {
  const result = evaluateBrowserParity(
    "fp16",
    [detection()],
    [
      detection({
        polygon: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 }
        ]
      })
    ]
  );
  expect(result.parity).toBe("passed");
  expect(result.parityMetrics.meanPolygonEdgeDistancePixels).toBe(0);
});

test("FP16 rejects polygon edge drift above 2 px", () => {
  const result = evaluateBrowserParity(
    "fp16",
    [detection()],
    [
      detection({
        polygon: [
          { x: 5, y: 0 },
          { x: 105, y: 0 },
          { x: 105, y: 100 },
          { x: 5, y: 100 }
        ]
      })
    ]
  );
  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("mean polygon edge distance exceeds 2 px");
});

test("FP16 matches same-label detections spatially and allows one adjacent reorder", () => {
  const accepted = Array.from({ length: 60 }, (_, index) => positionedDetection(index));
  const candidate = accepted.map((item, index) => ({
    ...item,
    box: { ...item.box },
    readingOrder: index
  }));
  [candidate[10], candidate[11]] = [candidate[11]!, candidate[10]!];
  candidate.forEach((item, index) => {
    item.readingOrder = index;
  });

  const result = evaluateBrowserParity("fp16", accepted, candidate);

  expect(result.parity).toBe("passed");
  expect(result.parityMetrics.spatiallyReorderedDetections).toBe(2);
  expect(result.parityMetrics.readingOrderInversions).toBe(1);
  expect(result.parityMetrics.maxReadingOrderDisplacement).toBe(1);
});

test("FP16 rejects broad reading-order drift", () => {
  const accepted = Array.from({ length: 60 }, (_, index) => positionedDetection(index));
  const candidate = [...accepted]
    .reverse()
    .map((item, index) => ({ ...item, box: { ...item.box }, readingOrder: index }));

  const result = evaluateBrowserParity("fp16", accepted, candidate);

  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("reading order inversion rate exceeds 0.001");
});

test("FP16 rejects a matched detection with an empty polygon", () => {
  const result = evaluateBrowserParity("fp16", [detection()], [detection({ polygon: [] })]);

  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("candidate detection 0 has an empty polygon");
});

test("parity rejects non-finite detection values", () => {
  const cases: Array<[string, DetectionForParity]> = [
    ["box", detection({ box: { xMin: Number.NaN, yMin: 0, xMax: 100, yMax: 100 } })],
    ["label", detection({ labelId: Number.POSITIVE_INFINITY })],
    ["score", detection({ score: Number.POSITIVE_INFINITY })],
    ["reading order", detection({ readingOrder: Number.NaN })],
    [
      "polygon",
      detection({
        polygon: [
          { x: 0, y: 0 },
          { x: Number.NEGATIVE_INFINITY, y: 0 },
          { x: 100, y: 100 }
        ]
      })
    ]
  ];

  for (const [field, candidate] of cases) {
    const result = evaluateBrowserParity("fp16", [detection()], [candidate]);
    expect(result.parity, field).toBe("failed");
    expect(
      result.validationErrors.some((error) => error.includes("non-finite")),
      field
    ).toBe(true);
  }
});

test("FP32 rejects non-finite detection values before strict comparison", () => {
  const result = evaluateBrowserParity("fp32", [detection()], [detection({ score: Number.NaN })]);

  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("candidate detection 0 has a non-finite score");
  expect(result.parityMetrics.maxScoreDelta).toBeNull();
});

test("FP16 rejects finite coordinates whose derived box area overflows", () => {
  const result = evaluateBrowserParity(
    "fp16",
    [detection()],
    [
      detection({
        box: { xMin: -1e200, yMin: -1e200, xMax: 1e200, yMax: 1e200 }
      })
    ]
  );

  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain(
    "candidate detection 0 has box geometry outside the safe numeric range"
  );
});

test("FP16 accepts two empty detection sets", () => {
  const result = evaluateBrowserParity("fp16", [], []);

  expect(result.parity).toBe("passed");
  expect(result.parityMetrics.matchedDetectionRatio).toBe(1);
  expect(result.parityMetrics.matchedDetectionPrecision).toBe(1);
});

test("FP16 rejects one empty detection set", () => {
  const result = evaluateBrowserParity("fp16", [detection()], []);

  expect(result.parity).toBe("failed");
  expect(result.validationErrors).toContain("detection count differs");
});
