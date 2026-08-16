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
  maxPolygonOutOfBoxDistancePixels: 2,
  maxReadingOrderDisplacement: 1,
  maxReadingOrderInversionRate: 0.001,
  maxScoreDelta: 0.02,
  matchedDetectionPrecision: 1,
  matchedDetectionRatio: 1,
  meanMatchedIoU: 0.94,
  meanPolygonEdgeDistancePixels: 2,
  minMatchedIoU: 0.8,
  p05MatchedIoU: 0.85,
  policy: "fp16-quality"
} as const;

type Precision = "fp16" | "fp32";

export interface BrowserParityResult {
  parity: "failed" | "passed";
  parityMetrics: Record<string, number | null>;
  parityThresholds: typeof FP16_PARITY_THRESHOLDS | typeof FP32_PARITY_THRESHOLDS;
  validationErrors: string[];
}

function validateDetections(detections: DetectionForParity[], role: string): string[] {
  const errors: string[] = [];
  for (const [index, detection] of detections.entries()) {
    if (!Number.isFinite(detection.labelId)) {
      errors.push(`${role} detection ${index} has a non-finite labelId`);
    }
    if (!Number.isFinite(detection.readingOrder)) {
      errors.push(`${role} detection ${index} has a non-finite readingOrder`);
    }
    if (!Number.isFinite(detection.score)) {
      errors.push(`${role} detection ${index} has a non-finite score`);
    }
    for (const coordinate of ["xMin", "xMax", "yMin", "yMax"] as const) {
      if (!Number.isFinite(detection.box[coordinate])) {
        errors.push(`${role} detection ${index} has a non-finite box coordinate ${coordinate}`);
      }
    }
    const boxWidth = Math.max(0, detection.box.xMax - detection.box.xMin);
    const boxHeight = Math.max(0, detection.box.yMax - detection.box.yMin);
    const boxArea = boxWidth * boxHeight;
    if (
      !Number.isFinite(boxWidth) ||
      !Number.isFinite(boxHeight) ||
      !Number.isFinite(boxArea) ||
      boxArea > Number.MAX_VALUE / 2
    ) {
      errors.push(`${role} detection ${index} has box geometry outside the safe numeric range`);
    }
    if (detection.polygon.length === 0) {
      errors.push(`${role} detection ${index} has an empty polygon`);
      continue;
    }
    for (const [pointIndex, point] of detection.polygon.entries()) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        errors.push(`${role} detection ${index} polygon point ${pointIndex} is non-finite`);
      }
    }
  }
  return errors;
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
  const iou = union === 0 ? 0 : intersection / union;
  return Number.isFinite(iou) ? iou : 0;
}

function minimumCostAssignment(costs: number[][]): number[] {
  const size = costs.length;
  if (size === 0) return [];
  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const p = Array(size + 1).fill(0);
  const way = Array(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minimum = Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const current = costs[row0 - 1]![column - 1]! - u[row0] - v[column];
        if (current < minimum[column]) {
          minimum[column] = current;
          way[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) {
          u[p[column]] += delta;
          v[column] -= delta;
        } else {
          minimum[column] -= delta;
        }
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const assignment = Array(size).fill(-1);
  for (let column = 1; column <= size; column += 1) assignment[p[column] - 1] = column - 1;
  return assignment;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function pointToSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))
  );
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function directedPolygonEdgeDistances(
  source: DetectionForParity["polygon"],
  target: DetectionForParity["polygon"]
): number[] {
  if (source.length === 0 || target.length === 0) return [];
  return source.map((point) =>
    Math.min(
      ...target.map((start, index) =>
        pointToSegmentDistance(point, start, target[(index + 1) % target.length]!)
      )
    )
  );
}

function symmetricPolygonEdgeDistance(
  left: DetectionForParity["polygon"],
  right: DetectionForParity["polygon"]
): number | null {
  const distances = [
    ...directedPolygonEdgeDistances(left, right),
    ...directedPolygonEdgeDistances(right, left)
  ];
  return distances.length === 0
    ? null
    : distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
}

function polygonOutsideBoxDistance(
  polygon: DetectionForParity["polygon"],
  box: DetectionForParity["box"]
): number {
  return polygon.reduce((maximum, point) => {
    const outsideX = Math.max(box.xMin - point.x, 0, point.x - box.xMax);
    const outsideY = Math.max(box.yMin - point.y, 0, point.y - box.yMax);
    return Math.max(maximum, Math.hypot(outsideX, outsideY));
  }, 0);
}

interface SpatialMatch {
  acceptedIndex: number;
  candidateIndex: number;
  iou: number;
}

function spatialMatches(
  accepted: DetectionForParity[],
  candidate: DetectionForParity[]
): SpatialMatch[] {
  const labelIds = new Set([...accepted, ...candidate].map(({ labelId }) => labelId));
  const matches: SpatialMatch[] = [];
  for (const labelId of labelIds) {
    const acceptedIndices = accepted.flatMap((item, index) =>
      item.labelId === labelId ? [index] : []
    );
    const candidateIndices = candidate.flatMap((item, index) =>
      item.labelId === labelId ? [index] : []
    );
    const size = Math.max(acceptedIndices.length, candidateIndices.length);
    if (size === 0) continue;
    const costs = Array.from({ length: size }, (_, acceptedGroupIndex) =>
      Array.from({ length: size }, (_, candidateGroupIndex) => {
        const acceptedIndex = acceptedIndices[acceptedGroupIndex];
        const candidateIndex = candidateIndices[candidateGroupIndex];
        if (acceptedIndex === undefined || candidateIndex === undefined) return 1.000001;
        return 1 - boxIou(accepted[acceptedIndex]!.box, candidate[candidateIndex]!.box);
      })
    );
    const assignment = minimumCostAssignment(costs);
    for (const [acceptedGroupIndex, candidateGroupIndex] of assignment.entries()) {
      const acceptedIndex = acceptedIndices[acceptedGroupIndex];
      const candidateIndex = candidateIndices[candidateGroupIndex];
      if (acceptedIndex === undefined || candidateIndex === undefined) continue;
      matches.push({
        acceptedIndex,
        candidateIndex,
        iou: boxIou(accepted[acceptedIndex]!.box, candidate[candidateIndex]!.box)
      });
    }
  }
  return matches.sort((left, right) => left.acceptedIndex - right.acceptedIndex);
}

function readingOrderMetrics(
  accepted: DetectionForParity[],
  candidate: DetectionForParity[],
  matches: SpatialMatch[]
): {
  inversions: number;
  maxDisplacement: number;
  inversionRate: number;
  reorderedDetections: number;
} {
  const ordered = [...matches].sort(
    (left, right) =>
      accepted[left.acceptedIndex]!.readingOrder - accepted[right.acceptedIndex]!.readingOrder
  );
  let inversions = 0;
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      if (
        candidate[ordered[left]!.candidateIndex]!.readingOrder >
        candidate[ordered[right]!.candidateIndex]!.readingOrder
      ) {
        inversions += 1;
      }
    }
  }
  const pairCount = (ordered.length * (ordered.length - 1)) / 2;
  return {
    inversions,
    maxDisplacement: ordered.reduce(
      (maximum, match) =>
        Math.max(
          maximum,
          Math.abs(
            accepted[match.acceptedIndex]!.readingOrder -
              candidate[match.candidateIndex]!.readingOrder
          )
        ),
      0
    ),
    inversionRate: pairCount === 0 ? 0 : inversions / pairCount,
    reorderedDetections: ordered.filter(
      ({ acceptedIndex, candidateIndex }) => acceptedIndex !== candidateIndex
    ).length
  };
}

function evaluateFp16(
  accepted: DetectionForParity[],
  candidate: DetectionForParity[]
): BrowserParityResult {
  const validationErrors = [
    ...validateDetections(accepted, "accepted"),
    ...validateDetections(candidate, "candidate")
  ];
  if (validationErrors.length > 0) {
    return {
      parity: "failed",
      parityMetrics: {
        acceptedDetections: accepted.length,
        candidateDetections: candidate.length,
        matchedDetectionPrecision: null,
        matchedDetectionRatio: null,
        matchedDetections: 0,
        meanMatchedIoU: null,
        minMatchedIoU: null,
        p05MatchedIoU: null,
        maxScoreDelta: null,
        meanPolygonEdgeDistancePixels: null,
        maxPolygonOutOfBoxDistancePixels: null,
        maxReadingOrderDisplacement: null,
        readingOrderInversions: null,
        readingOrderInversionRate: null,
        spatiallyReorderedDetections: 0,
        unmatchedCandidateDetections: candidate.length,
        unmatchedAcceptedDetections: accepted.length
      },
      parityThresholds: FP16_PARITY_THRESHOLDS,
      validationErrors
    };
  }
  if (accepted.length === 0 && candidate.length === 0) {
    return {
      parity: "passed",
      parityMetrics: {
        acceptedDetections: 0,
        candidateDetections: 0,
        matchedDetectionPrecision: 1,
        matchedDetectionRatio: 1,
        matchedDetections: 0,
        meanMatchedIoU: null,
        minMatchedIoU: null,
        p05MatchedIoU: null,
        maxScoreDelta: null,
        meanPolygonEdgeDistancePixels: null,
        maxPolygonOutOfBoxDistancePixels: 0,
        maxReadingOrderDisplacement: 0,
        readingOrderInversions: 0,
        readingOrderInversionRate: 0,
        spatiallyReorderedDetections: 0,
        unmatchedCandidateDetections: 0,
        unmatchedAcceptedDetections: 0
      },
      parityThresholds: FP16_PARITY_THRESHOLDS,
      validationErrors: []
    };
  }
  const matches = spatialMatches(accepted, candidate);
  const ious = matches.map(({ iou }) => iou);
  const scoreDeltas = matches.map(({ acceptedIndex, candidateIndex }) =>
    Math.abs(accepted[acceptedIndex]!.score - candidate[candidateIndex]!.score)
  );
  const polygonEdgeDistances = matches
    .map(({ acceptedIndex, candidateIndex }) =>
      symmetricPolygonEdgeDistance(
        accepted[acceptedIndex]!.polygon,
        candidate[candidateIndex]!.polygon
      )
    )
    .filter((distance): distance is number => distance !== null && Number.isFinite(distance));
  const order = readingOrderMetrics(accepted, candidate, matches);
  const metrics = {
    acceptedDetections: accepted.length,
    candidateDetections: candidate.length,
    matchedDetectionPrecision: candidate.length === 0 ? 0 : matches.length / candidate.length,
    matchedDetectionRatio: accepted.length === 0 ? 0 : matches.length / accepted.length,
    matchedDetections: matches.length,
    meanMatchedIoU:
      ious.length === 0 ? null : ious.reduce((sum, value) => sum + value, 0) / ious.length,
    minMatchedIoU: ious.length === 0 ? null : Math.min(...ious),
    p05MatchedIoU: percentile(ious, 0.05),
    maxScoreDelta: scoreDeltas.length === 0 ? null : Math.max(...scoreDeltas),
    meanPolygonEdgeDistancePixels:
      polygonEdgeDistances.length === 0
        ? null
        : polygonEdgeDistances.reduce((sum, value) => sum + value, 0) / polygonEdgeDistances.length,
    maxPolygonOutOfBoxDistancePixels: candidate.reduce(
      (maximum, detection) =>
        Math.max(maximum, polygonOutsideBoxDistance(detection.polygon, detection.box)),
      0
    ),
    maxReadingOrderDisplacement: order.maxDisplacement,
    readingOrderInversions: order.inversions,
    readingOrderInversionRate: order.inversionRate,
    spatiallyReorderedDetections: order.reorderedDetections,
    unmatchedCandidateDetections: candidate.length - matches.length,
    unmatchedAcceptedDetections: accepted.length - matches.length
  };
  const parityValidationErrors: string[] = [];
  if (accepted.length !== candidate.length) parityValidationErrors.push("detection count differs");
  if (metrics.matchedDetectionRatio < FP16_PARITY_THRESHOLDS.matchedDetectionRatio) {
    parityValidationErrors.push("matched detection ratio is below 1");
  }
  if (metrics.matchedDetectionPrecision < FP16_PARITY_THRESHOLDS.matchedDetectionPrecision) {
    parityValidationErrors.push("matched detection precision is below 1");
  }
  if (
    metrics.minMatchedIoU === null ||
    metrics.minMatchedIoU < FP16_PARITY_THRESHOLDS.minMatchedIoU
  ) {
    parityValidationErrors.push("minimum matched IoU is below 0.8");
  }
  if (
    metrics.p05MatchedIoU === null ||
    metrics.p05MatchedIoU < FP16_PARITY_THRESHOLDS.p05MatchedIoU
  ) {
    parityValidationErrors.push("P05 matched IoU is below 0.85");
  }
  if (
    metrics.meanMatchedIoU === null ||
    metrics.meanMatchedIoU < FP16_PARITY_THRESHOLDS.meanMatchedIoU
  ) {
    parityValidationErrors.push("mean matched IoU is below 0.94");
  }
  if (
    metrics.maxScoreDelta === null ||
    metrics.maxScoreDelta > FP16_PARITY_THRESHOLDS.maxScoreDelta
  ) {
    parityValidationErrors.push("score delta exceeds 0.02");
  }
  if (
    metrics.meanPolygonEdgeDistancePixels === null ||
    metrics.meanPolygonEdgeDistancePixels > FP16_PARITY_THRESHOLDS.meanPolygonEdgeDistancePixels
  ) {
    parityValidationErrors.push("mean polygon edge distance exceeds 2 px");
  }
  if (
    metrics.maxPolygonOutOfBoxDistancePixels >
    FP16_PARITY_THRESHOLDS.maxPolygonOutOfBoxDistancePixels
  ) {
    parityValidationErrors.push("polygon point is more than 2 px outside its box");
  }
  if (metrics.maxReadingOrderDisplacement > FP16_PARITY_THRESHOLDS.maxReadingOrderDisplacement) {
    parityValidationErrors.push("reading order displacement exceeds 1");
  }
  if (metrics.readingOrderInversionRate > FP16_PARITY_THRESHOLDS.maxReadingOrderInversionRate) {
    parityValidationErrors.push("reading order inversion rate exceeds 0.001");
  }
  return {
    parity: parityValidationErrors.length === 0 ? "passed" : "failed",
    parityMetrics: metrics,
    parityThresholds: FP16_PARITY_THRESHOLDS,
    validationErrors: parityValidationErrors
  };
}

function evaluateFp32(
  accepted: DetectionForParity[],
  candidate: DetectionForParity[]
): BrowserParityResult {
  let boxDelta = 0;
  let polygonDelta = 0;
  let scoreDelta = 0;
  const validationErrors = [
    ...validateDetections(accepted, "accepted"),
    ...validateDetections(candidate, "candidate")
  ];
  if (validationErrors.length > 0) {
    return {
      parity: "failed",
      parityMetrics: {
        maxBoxCoordinateDeltaPixels: null,
        maxPolygonCoordinateDeltaPixels: null,
        maxScoreDelta: null
      },
      parityThresholds: FP32_PARITY_THRESHOLDS,
      validationErrors
    };
  }
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
      maxScoreDelta: Number.isFinite(scoreDelta) ? scoreDelta : null
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
