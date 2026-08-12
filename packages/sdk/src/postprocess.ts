import { DocLayoutError } from "./errors";

export interface PostprocessTensor {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

export interface PPDocLayoutRawOutputs {
  readonly logits: PostprocessTensor;
  readonly orderLogits: PostprocessTensor;
  readonly outMasks: PostprocessTensor;
  readonly predBoxes: PostprocessTensor;
}

export interface ImageSize {
  readonly height: number;
  readonly width: number;
}

export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

export interface LayoutBox {
  readonly xMax: number;
  readonly xMin: number;
  readonly yMax: number;
  readonly yMin: number;
}

export interface LayoutDetection {
  readonly box: LayoutBox;
  readonly label: string;
  readonly labelId: number;
  readonly polygon: readonly LayoutPoint[];
  readonly readingOrder: number;
  readonly score: number;
}

export interface PostprocessOptions {
  readonly inputSize: ImageSize;
  readonly labels: readonly string[];
  readonly targetSize: ImageSize;
  readonly threshold?: number;
}

interface OutputShape {
  readonly classes: number;
  readonly maskHeight: number;
  readonly maskWidth: number;
  readonly queries: number;
}

interface Candidate {
  readonly flatIndex: number;
  readonly labelId: number;
  readonly query: number;
  readonly score: number;
}

interface RankedCandidate extends Candidate {
  readonly box: LayoutBox;
  readonly order: number;
}

interface IntegerPoint {
  readonly x: number;
  readonly y: number;
}

const CONTOUR_EPSILON_RATIO = 0.004;
const MASK_OUTPUT_STRIDE = 4;

function inferenceError(
  message: string,
  details: Readonly<Record<string, unknown>> = {}
): DocLayoutError {
  return new DocLayoutError("INFERENCE_FAILED", message, details);
}

function tensorLength(dims: readonly number[]): number {
  return dims.reduce((product, value) => product * value, 1);
}

function assertTensor(name: string, tensor: PostprocessTensor, expected: readonly number[]): void {
  const dimensionsMatch =
    tensor.dims.length === expected.length &&
    tensor.dims.every((dimension, index) => dimension === expected[index]);
  if (!dimensionsMatch || tensor.data.length !== tensorLength(tensor.dims)) {
    throw inferenceError(`Output tensor ${name} has an incompatible shape`, {
      actualShape: tensor.dims,
      dataLength: tensor.data.length,
      expectedShape: expected,
      name
    });
  }
}

function validateOutputs(outputs: PPDocLayoutRawOutputs, labels: readonly string[]): OutputShape {
  const [batch, queries, classes] = outputs.logits.dims;
  const [, maskQueries, maskHeight, maskWidth] = outputs.outMasks.dims;
  if (
    batch !== 1 ||
    queries === undefined ||
    classes === undefined ||
    !Number.isInteger(queries) ||
    !Number.isInteger(classes) ||
    queries <= 0 ||
    classes <= 0 ||
    maskQueries !== queries ||
    maskHeight === undefined ||
    maskWidth === undefined ||
    maskHeight <= 0 ||
    maskWidth <= 0
  ) {
    throw inferenceError("PP-DocLayoutV3 output tensor dimensions are invalid", {
      logitsShape: outputs.logits.dims,
      masksShape: outputs.outMasks.dims
    });
  }
  if (labels.length !== classes) {
    throw inferenceError("Manifest labels do not match the model class dimension", {
      classes,
      labels: labels.length
    });
  }

  assertTensor("logits", outputs.logits, [1, queries, classes]);
  assertTensor("pred_boxes", outputs.predBoxes, [1, queries, 4]);
  assertTensor("order_logits", outputs.orderLogits, [1, queries, queries]);
  assertTensor("out_masks", outputs.outMasks, [1, queries, maskHeight, maskWidth]);
  return { classes, maskHeight, maskWidth, queries };
}

function validateOptions(options: PostprocessOptions): number {
  const threshold = options.threshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw inferenceError("Detection threshold must be between zero and one", { threshold });
  }
  for (const [name, size] of [
    ["input", options.inputSize],
    ["target", options.targetSize]
  ] as const) {
    if (
      !Number.isFinite(size.width) ||
      !Number.isFinite(size.height) ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      throw inferenceError(`${name} image dimensions are invalid`, { ...size });
    }
  }
  return threshold;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    return 1 / (1 + Math.exp(-value));
  }
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

function selectCandidates(
  logits: Float32Array,
  queries: number,
  classes: number,
  threshold: number
): Candidate[] {
  const candidates = new Array<Candidate>(queries * classes);
  for (let flatIndex = 0; flatIndex < candidates.length; flatIndex += 1) {
    candidates[flatIndex] = {
      flatIndex,
      labelId: flatIndex % classes,
      query: Math.floor(flatIndex / classes),
      score: sigmoid(logits[flatIndex]!)
    };
  }

  candidates.sort((left, right) => right.score - left.score || left.flatIndex - right.flatIndex);
  return candidates.slice(0, queries).filter(({ score }) => score >= threshold);
}

function readingOrderRanks(orderLogits: Float32Array, queries: number): Int32Array {
  const votes = new Float64Array(queries);
  for (let query = 0; query < queries; query += 1) {
    let vote = 0;
    for (let previous = 0; previous < query; previous += 1) {
      vote += sigmoid(orderLogits[previous * queries + query]!);
    }
    for (let next = query + 1; next < queries; next += 1) {
      vote += 1 - sigmoid(orderLogits[query * queries + next]!);
    }
    votes[query] = vote;
  }

  const pointers = Array.from({ length: queries }, (_, query) => query).sort(
    (left, right) => votes[left]! - votes[right]! || left - right
  );
  const ranks = new Int32Array(queries);
  pointers.forEach((query, rank) => {
    ranks[query] = rank;
  });
  return ranks;
}

function boxForQuery(predBoxes: Float32Array, query: number, targetSize: ImageSize): LayoutBox {
  const offset = query * 4;
  const centerX = predBoxes[offset]!;
  const centerY = predBoxes[offset + 1]!;
  const width = predBoxes[offset + 2]!;
  const height = predBoxes[offset + 3]!;
  const halfWidth = Math.fround(width * 0.5);
  const halfHeight = Math.fround(height * 0.5);
  return {
    xMax: Math.fround(Math.fround(centerX + halfWidth) * targetSize.width),
    xMin: Math.fround(Math.fround(centerX - halfWidth) * targetSize.width),
    yMax: Math.fround(Math.fround(centerY + halfHeight) * targetSize.height),
    yMin: Math.fround(Math.fround(centerY - halfHeight) * targetSize.height)
  };
}

function bankersRound(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) return floor;
  if (fraction > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rectangle(box: LayoutBox): IntegerPoint[] {
  const xMin = Math.trunc(box.xMin);
  const yMin = Math.trunc(box.yMin);
  const xMax = Math.trunc(box.xMax);
  const yMax = Math.trunc(box.yMax);
  return [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax }
  ];
}

function cropAndResizeMask(
  tensor: PostprocessTensor,
  shape: OutputShape,
  query: number,
  box: LayoutBox,
  options: PostprocessOptions,
  threshold: number
): Uint8Array | undefined {
  const xMin = Math.trunc(box.xMin);
  const yMin = Math.trunc(box.yMin);
  const xMax = Math.trunc(box.xMax);
  const yMax = Math.trunc(box.yMax);
  const boxWidth = xMax - xMin;
  const boxHeight = yMax - yMin;
  if (boxWidth <= 0 || boxHeight <= 0) return undefined;

  const scaleWidth = options.inputSize.width / options.targetSize.width / MASK_OUTPUT_STRIDE;
  const scaleHeight = options.inputSize.height / options.targetSize.height / MASK_OUTPUT_STRIDE;
  const xStart = clamp(bankersRound(xMin * scaleWidth), 0, shape.maskWidth);
  const xEnd = clamp(bankersRound(xMax * scaleWidth), 0, shape.maskWidth);
  const yStart = clamp(bankersRound(yMin * scaleHeight), 0, shape.maskHeight);
  const yEnd = clamp(bankersRound(yMax * scaleHeight), 0, shape.maskHeight);
  const cropWidth = xEnd - xStart;
  const cropHeight = yEnd - yStart;
  if (cropWidth <= 0 || cropHeight <= 0) return undefined;

  const maskPlane = shape.maskWidth * shape.maskHeight;
  const maskOffset = query * maskPlane;
  const cropped = new Uint8Array(cropWidth * cropHeight);
  let hasForeground = false;
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const value =
        sigmoid(tensor.data[maskOffset + (yStart + y) * shape.maskWidth + xStart + x]!) > threshold
          ? 1
          : 0;
      cropped[y * cropWidth + x] = value;
      hasForeground ||= value === 1;
    }
  }
  if (!hasForeground) return undefined;

  const resized = new Uint8Array(boxWidth * boxHeight);
  for (let y = 0; y < boxHeight; y += 1) {
    const sourceY = Math.floor((y * cropHeight) / boxHeight);
    for (let x = 0; x < boxWidth; x += 1) {
      const sourceX = Math.floor((x * cropWidth) / boxWidth);
      resized[y * boxWidth + x] = cropped[sourceY * cropWidth + sourceX]!;
    }
  }
  return resized;
}

const TRACE_DIRECTIONS: readonly IntegerPoint[] = [
  { x: 1, y: 0 },
  { x: 1, y: -1 },
  { x: 0, y: -1 },
  { x: -1, y: -1 },
  { x: -1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
];

function isForeground(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  return x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
}

function directionIndex(from: IntegerPoint, to: IntegerPoint): number {
  const dx = clamp(to.x - from.x, -1, 1);
  const dy = clamp(to.y - from.y, -1, 1);
  return TRACE_DIRECTIONS.findIndex((direction) => direction.x === dx && direction.y === dy);
}

function traceContour(
  mask: Uint8Array,
  width: number,
  height: number,
  startIndex: number
): IntegerPoint[] {
  const start = { x: startIndex % width, y: Math.floor(startIndex / width) };
  let current = start;
  let backtrack = { x: start.x - 1, y: start.y };
  let firstNext: IntegerPoint | undefined;
  const points: IntegerPoint[] = [start];
  const maximumSteps = mask.length * 8;

  for (let step = 0; step < maximumSteps; step += 1) {
    const backtrackDirection = directionIndex(current, backtrack);
    let next: IntegerPoint | undefined;
    let nextBacktrack: IntegerPoint | undefined;
    for (let scan = 1; scan <= 8; scan += 1) {
      const direction = TRACE_DIRECTIONS[(backtrackDirection + scan + 8) % 8]!;
      const candidate = { x: current.x + direction.x, y: current.y + direction.y };
      if (isForeground(mask, width, height, candidate.x, candidate.y)) {
        next = candidate;
        const previousDirection = TRACE_DIRECTIONS[(backtrackDirection + scan - 1 + 8) % 8]!;
        nextBacktrack = {
          x: current.x + previousDirection.x,
          y: current.y + previousDirection.y
        };
        break;
      }
    }

    if (next === undefined || nextBacktrack === undefined) return points;
    if (firstNext === undefined) {
      firstNext = next;
    } else if (
      current.x === start.x &&
      current.y === start.y &&
      next.x === firstNext.x &&
      next.y === firstNext.y
    ) {
      break;
    }

    points.push(next);
    current = next;
    backtrack = nextBacktrack;
  }

  const last = points.at(-1);
  if (last !== undefined && last.x === start.x && last.y === start.y) points.pop();
  return points;
}

function chainApproxSimple(points: readonly IntegerPoint[]): IntegerPoint[] {
  if (points.length <= 2) return [...points];
  const result: IntegerPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const incomingX = Math.sign(current.x - previous.x);
    const incomingY = Math.sign(current.y - previous.y);
    const outgoingX = Math.sign(next.x - current.x);
    const outgoingY = Math.sign(next.y - current.y);
    if (incomingX !== outgoingX || incomingY !== outgoingY) result.push(current);
  }
  return result;
}

function polygonArea(points: readonly IntegerPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) * 0.5;
}

function arcLength(points: readonly IntegerPoint[]): number {
  let length = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    length += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return length;
}

function pointSegmentDistance(point: IntegerPoint, start: IntegerPoint, end: IntegerPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const projection = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
    0,
    1
  );
  return Math.hypot(point.x - (start.x + projection * dx), point.y - (start.y + projection * dy));
}

function simplifyOpen(points: readonly IntegerPoint[], epsilon: number): IntegerPoint[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points.at(-1)!;
  let maximumDistance = -1;
  let split = -1;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = pointSegmentDistance(points[index]!, first, last);
    if (distance > maximumDistance) {
      maximumDistance = distance;
      split = index;
    }
  }
  if (maximumDistance <= epsilon || split < 0) return [first, last];
  const left = simplifyOpen(points.slice(0, split + 1), epsilon);
  const right = simplifyOpen(points.slice(split), epsilon);
  return [...left.slice(0, -1), ...right];
}

function simplifyClosed(points: readonly IntegerPoint[], epsilon: number): IntegerPoint[] {
  if (points.length <= 4) return [...points];

  // OpenCV initializes a closed Douglas-Peucker curve with three alternating
  // farthest-point searches before simplifying the two resulting arcs.
  let startIndex = 0;
  let endIndex = 0;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const start = points[startIndex]!;
    let maximumDistance = -1;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      const distance = (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
      if (distance > maximumDistance) {
        maximumDistance = distance;
        endIndex = index;
      }
    }
    if (iteration < 2) startIndex = endIndex;
  }

  const cyclicArc = (from: number, to: number): IntegerPoint[] => {
    const result: IntegerPoint[] = [];
    let index = from;
    for (;;) {
      result.push(points[index]!);
      if (index === to) return result;
      index = (index + 1) % points.length;
    }
  };
  const firstArc = simplifyOpen(cyclicArc(startIndex, endIndex), epsilon);
  const secondArc = simplifyOpen(cyclicArc(endIndex, startIndex), epsilon);
  return [...firstArc.slice(0, -1), ...secondArc.slice(0, -1)];
}

function largestExternalContour(
  mask: Uint8Array,
  width: number,
  height: number
): IntegerPoint[] | undefined {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let largest: IntegerPoint[] | undefined;
  let largestArea = -1;

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || visited[start] === 1) continue;
    let head = 0;
    let tail = 0;
    let contourStart = start;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const index = queue[head++]!;
      if (index < contourStart) contourStart = index;
      const x = index % width;
      const y = Math.floor(index / width);
      for (const direction of TRACE_DIRECTIONS) {
        const nextX = x + direction.x;
        const nextY = y + direction.y;
        if (!isForeground(mask, width, height, nextX, nextY)) continue;
        const next = nextY * width + nextX;
        if (visited[next] === 0) {
          visited[next] = 1;
          queue[tail++] = next;
        }
      }
    }

    const contour = chainApproxSimple(traceContour(mask, width, height, contourStart));
    const area = polygonArea(contour);
    if (area > largestArea) {
      largest = contour;
      largestArea = area;
    }
  }
  return largest;
}

function extractCustomVertices(points: readonly IntegerPoint[]): LayoutPoint[] {
  const result: LayoutPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const first = { x: previous.x - current.x, y: previous.y - current.y };
    const second = { x: next.x - current.x, y: next.y - current.y };
    const cross = first.y * second.x - first.x * second.y;
    if (cross >= 0) continue;

    const firstLength = Math.hypot(first.x, first.y);
    const secondLength = Math.hypot(second.x, second.y);
    const cosine = clamp(
      (first.x * second.x + first.y * second.y) / (firstLength * secondLength),
      -1,
      1
    );
    const angle = (Math.acos(cosine) * 180) / Math.PI;
    if (Math.abs(angle - 45) >= 1) {
      result.push(current);
      continue;
    }

    let directionX = first.x / firstLength + second.x / secondLength;
    let directionY = first.y / firstLength + second.y / secondLength;
    const directionLength = Math.hypot(directionX, directionY);
    directionX /= directionLength;
    directionY /= directionLength;
    const step = (firstLength + secondLength) / 2;
    result.push({ x: current.x + directionX * step, y: current.y + directionY * step });
  }
  return result;
}

function polygonForCandidate(
  outputs: PPDocLayoutRawOutputs,
  shape: OutputShape,
  candidate: RankedCandidate,
  options: PostprocessOptions,
  threshold: number
): readonly LayoutPoint[] {
  const fallback = rectangle(candidate.box);
  const resized = cropAndResizeMask(
    outputs.outMasks,
    shape,
    candidate.query,
    candidate.box,
    options,
    threshold
  );
  if (resized === undefined) return fallback;

  const boxWidth = Math.trunc(candidate.box.xMax) - Math.trunc(candidate.box.xMin);
  const boxHeight = Math.trunc(candidate.box.yMax) - Math.trunc(candidate.box.yMin);
  const contour = largestExternalContour(resized, boxWidth, boxHeight);
  if (contour === undefined) return fallback;
  const simplified = simplifyClosed(contour, CONTOUR_EPSILON_RATIO * arcLength(contour));
  const vertices = extractCustomVertices(simplified);
  if (vertices.length < 4) return fallback;

  const offsetX = Math.trunc(candidate.box.xMin);
  const offsetY = Math.trunc(candidate.box.yMin);
  return vertices.map(({ x, y }) => ({ x: x + offsetX, y: y + offsetY }));
}

export function postprocessDetections(
  outputs: PPDocLayoutRawOutputs,
  options: PostprocessOptions
): LayoutDetection[] {
  const threshold = validateOptions(options);
  const shape = validateOutputs(outputs, options.labels);
  const ranks = readingOrderRanks(outputs.orderLogits.data, shape.queries);
  const candidates = selectCandidates(outputs.logits.data, shape.queries, shape.classes, threshold)
    .map<RankedCandidate>((candidate) => ({
      ...candidate,
      box: boxForQuery(outputs.predBoxes.data, candidate.query, options.targetSize),
      order: ranks[candidate.query]!
    }))
    .sort((left, right) => left.order - right.order || right.score - left.score);

  return candidates.map((candidate, index) => ({
    box: candidate.box,
    label: options.labels[candidate.labelId]!,
    labelId: candidate.labelId,
    polygon: polygonForCandidate(outputs, shape, candidate, options, threshold),
    readingOrder: index + 1,
    score: candidate.score
  }));
}
