import reference from "./fixtures/model-output-reference.json";

import { describe, expect, it } from "vitest";

import {
  postprocessDetections,
  type LayoutBox,
  type PPDocLayoutRawOutputs,
  type PostprocessTensor
} from "../src/postprocess";

type FixtureCase = typeof reference.synthetic | typeof reference.realImage;

function tensor(spec: { data: number[]; dims: number[] }): PostprocessTensor {
  return { data: Float32Array.from(spec.data), dims: spec.dims };
}

function syntheticMasks(spec: typeof reference.synthetic.outputs.outMasks): PostprocessTensor {
  const data = new Float32Array(spec.dims.reduce((product, value) => product * value, 1));
  let offset = 0;
  for (const rows of spec.positiveRows) {
    for (const row of rows) {
      for (const value of row) {
        data[offset++] = value === "1" ? spec.positiveLogit : spec.negativeLogit;
      }
    }
  }
  return { data, dims: spec.dims };
}

function realImageMasks(spec: typeof reference.realImage.outputs.outMasks): PostprocessTensor {
  const data = new Float32Array(spec.dims.reduce((product, value) => product * value, 1));
  let offset = 0;
  let value = spec.rle.startsWith;
  for (const run of spec.rle.runs) {
    data.fill(value === 1 ? spec.positiveLogit : spec.negativeLogit, offset, offset + run);
    offset += run;
    value = value === 1 ? 0 : 1;
  }
  return { data, dims: spec.dims };
}

function outputsFor(fixture: FixtureCase): PPDocLayoutRawOutputs {
  return {
    logits: tensor(fixture.outputs.logits),
    orderLogits: tensor(fixture.outputs.orderLogits),
    outMasks:
      fixture === reference.synthetic
        ? syntheticMasks(reference.synthetic.outputs.outMasks)
        : realImageMasks(reference.realImage.outputs.outMasks),
    predBoxes: tensor(fixture.outputs.predBoxes)
  };
}

function runFixture(fixture: FixtureCase) {
  return postprocessDetections(outputsFor(fixture), {
    inputSize: fixture.inputSize,
    labels: fixture.labels,
    targetSize: fixture.targetSize,
    threshold: fixture.threshold
  });
}

function expectBoxClose(
  actual: LayoutBox | undefined,
  expected: number[],
  precision: number
): void {
  expect(actual).toBeDefined();
  expect(actual?.xMin).toBeCloseTo(expected[0]!, precision);
  expect(actual?.yMin).toBeCloseTo(expected[1]!, precision);
  expect(actual?.xMax).toBeCloseTo(expected[2]!, precision);
  expect(actual?.yMax).toBeCloseTo(expected[3]!, precision);
}

describe("postprocessDetections", () => {
  it("matches the official synthetic sigmoid, global top-k, and reading-order result", () => {
    const detections = runFixture(reference.synthetic);

    expect(detections.map(({ labelId }) => labelId)).toEqual(reference.synthetic.expected.labels);
    expect(detections.map(({ readingOrder }) => readingOrder)).toEqual([1, 2, 3, 4]);
    reference.synthetic.expected.scores.forEach((score, index) => {
      expect(detections[index]?.score).toBeCloseTo(score, 6);
    });
  });

  it("keeps duplicate display names as distinct label IDs", () => {
    const [first, second] = runFixture(reference.synthetic);

    expect(first).toMatchObject({ label: "footer", labelId: 0 });
    expect(second).toMatchObject({ label: "footer", labelId: 1 });
  });

  it("applies shared per-class thresholds after global top-k selection", () => {
    const detections = postprocessDetections(outputsFor(reference.synthetic), {
      inputSize: reference.synthetic.inputSize,
      labels: reference.synthetic.labels,
      targetSize: reference.synthetic.targetSize,
      threshold: 0.6,
      classThresholds: { content: 0.5, footer: 0.85, image: 0.8 }
    });

    expect(detections.map(({ labelId }) => labelId)).toEqual([0, 2]);
  });

  it("includes a score equal to its class threshold", () => {
    const detections = postprocessDetections(outputsFor(reference.synthetic), {
      inputSize: reference.synthetic.inputSize,
      labels: reference.synthetic.labels,
      targetSize: reference.synthetic.targetSize,
      threshold: 0.95,
      classThresholds: { content: 0.5 }
    });

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({ label: "content", labelId: 2, score: 0.5 });
  });

  it("includes a score exactly on the threshold and sorts it before a later query", () => {
    const detections = runFixture(reference.synthetic);

    expect(detections[2]).toMatchObject({ labelId: 2, readingOrder: 3, score: 0.5 });
    expect(detections[3]).toMatchObject({ labelId: 3, readingOrder: 4 });
  });

  it("converts center boxes in the non-square original coordinate system without clipping", () => {
    const detections = runFixture(reference.synthetic);

    reference.synthetic.expected.boxes.forEach((box, index) => {
      expectBoxClose(detections[index]?.box, box, 5);
    });
    expect(detections[3]?.box.xMin).toBe(-15);
    expect(detections[3]?.box.yMax).toBe(110);
  });

  it("matches official mask polygons and uses the box rectangle for an empty mask", () => {
    const detections = runFixture(reference.synthetic);

    expect(detections.map(({ polygon }) => polygon.map(({ x, y }) => [x, y]))).toEqual(
      reference.synthetic.expected.polygons
    );
  });

  it("matches a compact output captured from the real FP32 model on table.png", () => {
    const [detection] = runFixture(reference.realImage);
    const expected = reference.realImage.expected;

    expect(detection).toMatchObject({ label: "table", labelId: 21, readingOrder: 1 });
    expect(detection?.score).toBeCloseTo(expected.scores[0]!, 6);
    expectBoxClose(detection?.box, expected.boxes[0]!, 4);
    expect(detection?.polygon.map(({ x, y }) => [x, y])).toEqual(expected.polygons[0]);
  });

  it("keeps sigmoid numerically stable for extreme logits", () => {
    const outputs = outputsFor(reference.realImage);
    outputs.logits.data[21] = 1000;
    outputs.logits.data[0] = -1000;

    expect(
      postprocessDetections(outputs, {
        inputSize: reference.realImage.inputSize,
        labels: reference.realImage.labels,
        targetSize: reference.realImage.targetSize,
        threshold: 0.5
      })[0]?.score
    ).toBe(1);
  });

  it("applies top-k globally and can select two classes from one query", () => {
    const outputs: PPDocLayoutRawOutputs = {
      logits: { data: Float32Array.from([10, 9, -10, -10]), dims: [1, 2, 2] },
      orderLogits: { data: new Float32Array(4), dims: [1, 2, 2] },
      outMasks: { data: new Float32Array(8), dims: [1, 2, 2, 2] },
      predBoxes: {
        data: Float32Array.from([0.5, 0.5, 0.5, 0.5, 0.2, 0.2, 0.1, 0.1]),
        dims: [1, 2, 4]
      }
    };

    const detections = postprocessDetections(outputs, {
      inputSize: { height: 8, width: 8 },
      labels: ["first", "second"],
      targetSize: { height: 100, width: 100 },
      threshold: 0.5
    });

    expect(detections.map(({ labelId }) => labelId)).toEqual([0, 1]);
    expect(detections[0]?.box).toEqual(detections[1]?.box);
  });

  it("does not allow a class override to resurrect a candidate outside global top-k", () => {
    const outputs: PPDocLayoutRawOutputs = {
      logits: { data: Float32Array.from([10, 9]), dims: [1, 1, 2] },
      orderLogits: { data: new Float32Array(1), dims: [1, 1, 1] },
      outMasks: { data: new Float32Array(4), dims: [1, 1, 2, 2] },
      predBoxes: { data: Float32Array.from([0.5, 0.5, 0.5, 0.5]), dims: [1, 1, 4] }
    };

    const detections = postprocessDetections(outputs, {
      inputSize: { height: 8, width: 8 },
      labels: ["first", "second"],
      targetSize: { height: 100, width: 100 },
      classThresholds: { first: 1, second: 0 }
    });

    expect(detections).toEqual([]);
  });

  it("rejects class threshold overrides for unknown labels and invalid values", () => {
    const options = {
      inputSize: reference.synthetic.inputSize,
      labels: reference.synthetic.labels,
      targetSize: reference.synthetic.targetSize
    };

    expect(() =>
      postprocessDetections(outputsFor(reference.synthetic), {
        ...options,
        classThresholds: { unknown: 0.5 }
      })
    ).toThrow(/unknown/i);
    expect(() =>
      postprocessDetections(outputsFor(reference.synthetic), {
        ...options,
        classThresholds: { content: Number.NaN }
      })
    ).toThrow(/threshold/i);
  });

  it("keeps mask polygon binarization on the global threshold", () => {
    const globalOnly = postprocessDetections(outputsFor(reference.synthetic), {
      inputSize: reference.synthetic.inputSize,
      labels: reference.synthetic.labels,
      targetSize: reference.synthetic.targetSize,
      threshold: 0.5
    });
    const classOverride = postprocessDetections(outputsFor(reference.synthetic), {
      inputSize: reference.synthetic.inputSize,
      labels: reference.synthetic.labels,
      targetSize: reference.synthetic.targetSize,
      threshold: 0.5,
      classThresholds: { footer: 0.85 }
    });

    expect(classOverride[0]?.polygon).toEqual(globalOnly[0]?.polygon);
  });

  it("uses a strict threshold for masks while detection scores remain inclusive", () => {
    const original = outputsFor(reference.synthetic);
    const maskData = new Float32Array(original.outMasks.data);
    maskData.fill(0, 0, 8 * 8);
    const outputs = {
      ...original,
      outMasks: { data: maskData, dims: original.outMasks.dims }
    };

    const [detection] = postprocessDetections(outputs, {
      inputSize: reference.synthetic.inputSize,
      labels: reference.synthetic.labels,
      targetSize: reference.synthetic.targetSize,
      threshold: 0.5
    });

    expect(detection?.polygon.map(({ x, y }) => [x, y])).toEqual([
      [14, 10],
      [135, 10],
      [135, 50],
      [14, 50]
    ]);
  });

  it("rejects incompatible tensor shapes before reading output data", () => {
    const valid = outputsFor(reference.synthetic);
    const outputs = {
      ...valid,
      predBoxes: { data: valid.predBoxes.data, dims: [1, 3, 4] }
    };
    let error: unknown;
    try {
      postprocessDetections(outputs, {
        inputSize: reference.synthetic.inputSize,
        labels: reference.synthetic.labels,
        targetSize: reference.synthetic.targetSize,
        threshold: reference.synthetic.threshold
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "INFERENCE_FAILED" });
  });
});
