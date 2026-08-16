export interface DetectionForParity {
  box: { xMax: number; xMin: number; yMax: number; yMin: number };
  labelId: number;
  polygon: Array<{ x: number; y: number }>;
  readingOrder: number;
  score: number;
}

export const FP32_PARITY_THRESHOLDS = {
  maxBoxCoordinateDeltaPixels: 1,
  maxPolygonCoordinateDeltaPixels: 1.5,
  maxScoreDelta: 0.001,
  policy: "fp32-equality"
} as const;

export const FP16_PARITY_THRESHOLDS = {
  iou: 0.95,
  matchedDetectionRatio: 0.99,
  maxScoreDelta: 0.02,
  meanPolygonPointDistancePixels: 2,
  policy: "fp16-quality"
} as const;

type Precision = "fp16" | "fp32";

export interface BrowserParityResult {
  parity: "failed" | "passed";
  parityMetrics: Record<string, number | null>;
  parityThresholds: typeof FP16_PARITY_THRESHOLDS | typeof FP32_PARITY_THRESHOLDS;
  validationErrors: string[];
}

function boxIou(left: DetectionForParity["box"], right: DetectionForParity["box"]): number {
  const intersectionWidth = Math.max(
    0,
    Math.min(left.xMax, right.xMax) - Math.max(left.xMin, right.xMin)
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.yMax, right.yMax) - Math.max(left.yMin, right.yMin)
  );
  const intersection = intersectionWidth * intersectionHeight;
  const leftArea = Math.max(0, left.xMax - left.xMin) * Math.max(0, left.yMax - left.yMin);
  const rightArea = Math.max(0, right.xMax - right.xMin) * Math.max(0, right.yMax - right.yMin);
  const union = leftArea + rightArea - intersection;
  return union === 0 ? 0 : intersection / union;
}

function polygonDistance(
  left: DetectionForParity["polygon"],
  right: DetectionForParity["polygon"]
): number {
  if (left.length === 0 || left.length !== right.length) return Number.POSITIVE_INFINITY;
  return (
    left.reduce((sum, point, index) => {
      const candidate = right[index]!;
      return sum + Math.hypot(point.x - candidate.x, point.y - candidate.y);
    }, 0) / left.length
  );
}

function evaluateFp16(
  accepted: DetectionForParity[],
  candidate: DetectionForParity[]
): BrowserParityResult {
  const possible = accepted
    .flatMap((reference, acceptedIndex) =>
      candidate.flatMap((target, candidateIndex) => {
        if (reference.labelId !== target.labelId) return [];
        const iou = boxIou(reference.box, target.box);
        return iou < FP16_PARITY_THRESHOLDS.iou ? [] : [{ acceptedIndex, candidateIndex, iou }];
      })
    )
    .sort((left, right) => right.iou - left.iou);
  const usedAccepted = new Set<number>();
  const usedCandidate = new Set<number>();
  const matches = possible.filter(({ acceptedIndex, candidateIndex }) => {
    if (usedAccepted.has(acceptedIndex) || usedCandidate.has(candidateIndex)) return false;
    usedAccepted.add(acceptedIndex);
    usedCandidate.add(candidateIndex);
    return true;
  });
  const scoreDeltas = matches.map(({ acceptedIndex, candidateIndex }) =>
    Math.abs(accepted[acceptedIndex]!.score - candidate[candidateIndex]!.score)
  );
  const polygonDistances = matches
    .map(({ acceptedIndex, candidateIndex }) =>
      polygonDistance(accepted[acceptedIndex]!.polygon, candidate[candidateIndex]!.polygon)
    )
    .filter(Number.isFinite);
  const metrics = {
    acceptedDetections: accepted.length,
    candidateDetections: candidate.length,
    matchedDetectionPrecision: candidate.length === 0 ? 0 : matches.length / candidate.length,
    matchedDetectionRatio: accepted.length === 0 ? 0 : matches.length / accepted.length,
    matchedDetections: matches.length,
    maxScoreDelta: scoreDeltas.length === 0 ? null : Math.max(...scoreDeltas),
    meanPolygonPointDistancePixels:
      polygonDistances.length === 0
        ? null
        : polygonDistances.reduce((sum, value) => sum + value, 0) / polygonDistances.length,
    unmatchedCandidateDetections: candidate.length - matches.length
  };
  const validationErrors: string[] = [];
  if (metrics.matchedDetectionRatio < FP16_PARITY_THRESHOLDS.matchedDetectionRatio) {
    validationErrors.push("matched detection ratio is below 0.99");
  }
  if (metrics.matchedDetectionPrecision < FP16_PARITY_THRESHOLDS.matchedDetectionRatio) {
    validationErrors.push("matched detection precision is below 0.99");
  }
  if (
    metrics.maxScoreDelta === null ||
    metrics.maxScoreDelta > FP16_PARITY_THRESHOLDS.maxScoreDelta
  ) {
    validationErrors.push("score delta exceeds 0.02");
  }
  if (
    metrics.meanPolygonPointDistancePixels === null ||
    metrics.meanPolygonPointDistancePixels > FP16_PARITY_THRESHOLDS.meanPolygonPointDistancePixels
  ) {
    validationErrors.push("mean polygon distance exceeds 2 px");
  }
  return {
    parity: validationErrors.length === 0 ? "passed" : "failed",
    parityMetrics: metrics,
    parityThresholds: FP16_PARITY_THRESHOLDS,
    validationErrors
  };
}

function evaluateFp32(
  accepted: DetectionForParity[],
  candidate: DetectionForParity[]
): BrowserParityResult {
  let boxDelta = 0;
  let polygonDelta = 0;
  let scoreDelta = 0;
  const validationErrors: string[] = [];
  if (accepted.length !== candidate.length) validationErrors.push("detection count differs");
  if (
    JSON.stringify(accepted.map(({ labelId }) => labelId)) !==
    JSON.stringify(candidate.map(({ labelId }) => labelId))
  ) {
    validationErrors.push("label sequence differs");
  }
  if (
    JSON.stringify(accepted.map(({ readingOrder }) => readingOrder)) !==
    JSON.stringify(candidate.map(({ readingOrder }) => readingOrder))
  ) {
    validationErrors.push("reading order differs");
  }
  if (accepted.length === candidate.length) {
    for (const [index, target] of candidate.entries()) {
      const reference = accepted[index]!;
      for (const coordinate of ["xMin", "xMax", "yMin", "yMax"] as const) {
        boxDelta = Math.max(boxDelta, Math.abs(target.box[coordinate] - reference.box[coordinate]));
      }
      scoreDelta = Math.max(scoreDelta, Math.abs(target.score - reference.score));
      if (target.polygon.length !== reference.polygon.length) {
        polygonDelta = Number.POSITIVE_INFINITY;
      } else {
        for (const [pointIndex, point] of target.polygon.entries()) {
          const referencePoint = reference.polygon[pointIndex]!;
          polygonDelta = Math.max(
            polygonDelta,
            Math.abs(point.x - referencePoint.x),
            Math.abs(point.y - referencePoint.y)
          );
        }
      }
    }
  }
  if (boxDelta > FP32_PARITY_THRESHOLDS.maxBoxCoordinateDeltaPixels) {
    validationErrors.push("box coordinate delta exceeds 1 px");
  }
  if (polygonDelta > FP32_PARITY_THRESHOLDS.maxPolygonCoordinateDeltaPixels) {
    validationErrors.push("polygon coordinate delta exceeds 1.5 px");
  }
  if (scoreDelta > FP32_PARITY_THRESHOLDS.maxScoreDelta) {
    validationErrors.push("score delta exceeds 0.001");
  }
  return {
    parity: validationErrors.length === 0 ? "passed" : "failed",
    parityMetrics: {
      maxBoxCoordinateDeltaPixels: Number.isFinite(boxDelta) ? boxDelta : null,
      maxPolygonCoordinateDeltaPixels: Number.isFinite(polygonDelta) ? polygonDelta : null,
      maxScoreDelta: scoreDelta
    },
    parityThresholds: FP32_PARITY_THRESHOLDS,
    validationErrors
  };
}

export function evaluateBrowserParity(
  precision: Precision,
  accepted: DetectionForParity[],
  candidate: DetectionForParity[]
): BrowserParityResult {
  return precision === "fp16"
    ? evaluateFp16(accepted, candidate)
    : evaluateFp32(accepted, candidate);
}
