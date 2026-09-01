import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer, type Server } from "node:http";
import { cpus, platform, release } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

import { expect, test } from "playwright/test";

import reference from "../../packages/sdk/tests/fixtures/model-output-reference.json";
import { evaluateBrowserParity } from "./benchmark-parity";

type BenchmarkMode = "wasm-fp32" | "webgpu-fp16" | "webgpu-fp32";

interface BenchmarkManifest {
  model: { version: string; [key: string]: unknown };
  variants: Array<{
    backendCompatibility: string[];
    bytes: number;
    filename: string;
    id: string;
    precision: string;
    sha256: string;
    url: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface FixtureLock {
  fixtures: Array<{
    filename: string;
    height: number;
    sha256: string;
    width: number;
  }>;
}

const mode = process.env.PPDOCLAYOUT_BENCHMARK_MODE as BenchmarkMode | undefined;
const repositoryRoot = resolve(__dirname, "../..");
const sdkRoot = join(repositoryRoot, "packages/sdk");
const ortRoot = join(sdkRoot, "node_modules/onnxruntime-web/dist");
const acceptedModelRoot = join(repositoryRoot, "models/pp-doclayoutv3");
// 当前模型只有一份；历史版本仅保留在 benchmark/report 证据中。
const candidateModelRoot = acceptedModelRoot;
const fixtureRoot = join(repositoryRoot, "tools/model-pipeline/fixtures/images");
const fixturesLockPath = join(repositoryRoot, "tools/model-pipeline/fixtures/fixtures.lock.json");
const outputRoot = join(repositoryRoot, "test-results/benchmark");
let origin = "";
let server: Server;

test.use(mode?.startsWith("webgpu-") ? { channel: "chrome" } : {});

const referenceThresholds = {
  iou: 0.95,
  maxScoreDelta: 0.02,
  meanPolygonPointDistancePixels: 2
} as const;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function loadManifest(): BenchmarkManifest {
  return JSON.parse(
    readFileSync(join(acceptedModelRoot, "manifest.json"), "utf8")
  ) as BenchmarkManifest;
}

function localManifest(
  modelRoot: string,
  urlPrefix: "accepted" | "candidate",
  fp32Backends: readonly string[]
): BenchmarkManifest {
  const manifest = structuredClone(loadManifest());
  manifest.model.version = loadManifest().model.version;
  for (const variant of manifest.variants) {
    const path = join(modelRoot, variant.filename);
    variant.bytes = statSync(path).size;
    variant.sha256 = sha256File(path);
    variant.url = `${origin}/models/${urlPrefix}/${variant.filename}`;
    if (variant.precision === "fp32") {
      variant.backendCompatibility = [...fp32Backends];
    }
  }
  return manifest;
}

function verifiedFixtures(): FixtureLock {
  const lock = JSON.parse(readFileSync(fixturesLockPath, "utf8")) as FixtureLock;
  for (const fixture of lock.fixtures) {
    const path = join(fixtureRoot, fixture.filename);
    expect(sha256File(path), `fixture integrity: ${fixture.filename}`).toBe(fixture.sha256);
  }
  return lock;
}

function boxIou(actual: { xMin: number; xMax: number; yMin: number; yMax: number }): number {
  const [xMin, yMin, xMax, yMax] = reference.realImage.expected.boxes[0]!;
  const intersectionWidth = Math.max(
    0,
    Math.min(actual.xMax, xMax!) - Math.max(actual.xMin, xMin!)
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(actual.yMax, yMax!) - Math.max(actual.yMin, yMin!)
  );
  const intersection = intersectionWidth * intersectionHeight;
  const actualArea = (actual.xMax - actual.xMin) * (actual.yMax - actual.yMin);
  const expectedArea = (xMax! - xMin!) * (yMax! - yMin!);
  return intersection / (actualArea + expectedArea - intersection);
}

function meanPolygonPointDistance(actual: readonly { x: number; y: number }[]): number {
  const expected = reference.realImage.expected.polygons[0]!;
  if (actual.length !== expected.length) return Number.POSITIVE_INFINITY;
  return (
    actual.reduce((sum, point, index) => {
      const [x, y] = expected[index]!;
      return sum + Math.hypot(point.x - x, point.y - y);
    }, 0) / actual.length
  );
}

function runPnpm(args: readonly string[]): void {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args;
  execFileSync(command, commandArgs, { cwd: repositoryRoot, stdio: "pipe" });
}

function resolveAsset(url: string): string | undefined {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname.startsWith("/dist/")) return join(sdkRoot, pathname.slice(1));
  if (pathname.startsWith("/ort/")) return join(ortRoot, basename(pathname));
  if (pathname.startsWith("/models/accepted/")) {
    return join(acceptedModelRoot, basename(pathname));
  }
  if (pathname.startsWith("/models/candidate/")) {
    return join(candidateModelRoot, basename(pathname));
  }
  if (pathname.startsWith("/fixtures/")) return join(fixtureRoot, basename(pathname));
  return undefined;
}

function contentType(path: string): string {
  return (
    {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".mjs": "text/javascript; charset=utf-8",
      ".onnx": "application/octet-stream",
      ".png": "image/png",
      ".wasm": "application/wasm"
    }[extname(path)] ?? "application/octet-stream"
  );
}

test.beforeAll(async () => {
  test.skip(
    !["wasm-fp32", "webgpu-fp16", "webgpu-fp32"].includes(mode ?? ""),
    "Set benchmark mode"
  );
  runPnpm(["--filter", "web-sdk-pp-doclayoutv3", "build"]);
  server = createServer((request, response) => {
    response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        `<!doctype html>${
          mode === "wasm-fp32" ? "<script>globalThis.Worker=undefined;</script>" : ""
        }<script src="/dist/browser-global.js"></script>`
      );
      return;
    }
    const asset = resolveAsset(request.url ?? "");
    const safeAsset = asset === undefined ? undefined : normalize(asset);
    if (safeAsset === undefined || !existsSync(safeAsset) || !statSync(safeAsset).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "content-length": statSync(safeAsset).size,
      "content-type": contentType(safeAsset)
    });
    createReadStream(safeAsset).pipe(response);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Benchmark server failed");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server === undefined) return;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error === undefined ? resolveClose() : reject(error)))
  );
});

test("records strict seven-fixture browser evidence", async ({ browser, page }) => {
  test.setTimeout(20 * 60_000);
  const backend = mode === "wasm-fp32" ? "wasm" : "webgpu";
  const precision = mode?.endsWith("fp32") ? "fp32" : "fp16";
  const fixturesLock = verifiedFixtures();
  const acceptedManifest = localManifest(acceptedModelRoot, "accepted", ["wasm"]);
  const targetManifest = localManifest(candidateModelRoot, "candidate", ["wasm", "webgpu"]);
  const manifestVariant = targetManifest.variants.find(
    (variant) => variant.precision === precision && variant.backendCompatibility.includes(backend)
  );
  expect(manifestVariant).toBeDefined();

  await page.goto(origin);
  const result = await page.evaluate(
    async ({
      acceptedManifest,
      backend,
      fixtures,
      origin: browserOrigin,
      precision,
      targetManifest
    }) => {
      async function sha256(bytes: Uint8Array): Promise<string> {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
      }

      const targetOptions = {
        allowFallback: false,
        backend,
        cache: true,
        model: targetManifest,
        ort: { wasm: { numThreads: 1, paths: `${browserOrigin}/ort/` } },
        precision
      } as const;
      const acceptedOptions = {
        allowFallback: false,
        backend: "wasm",
        cache: true,
        model: acceptedManifest,
        ort: { wasm: { numThreads: 1, paths: `${browserOrigin}/ort/` } },
        precision: "fp32"
      } as const;

      await window.PPDocLayout!.clearModelCache();
      let target;
      try {
        target = await window.PPDocLayout!.createDocLayout(targetOptions);
      } catch (error) {
        const capabilities = await window.PPDocLayout!.probeDocLayoutCapabilities();
        const failure = error as Error & {
          cause?: unknown;
          code?: string;
          details?: { causeMessage?: string };
        };
        throw new Error(
          JSON.stringify({
            capabilities,
            cause: failure.cause instanceof Error ? failure.cause.message : failure.cause,
            causeMessage: failure.details?.causeMessage,
            code: failure.code,
            details: failure.details,
            message: failure.message,
            name: failure.name
          })
        );
      }
      const accepted = await window.PPDocLayout!.createDocLayout(acceptedOptions);
      const fixtureResults = [];
      for (const fixture of fixtures) {
        const image = await (await fetch(`${browserOrigin}/fixtures/${fixture.filename}`)).blob();
        const acceptedDetection = await accepted.detect(image, { threshold: 0.5 });
        const detection = await target.detect(image, { threshold: 0.5 });
        const acceptedDetectionJson = JSON.stringify(acceptedDetection.detections);
        const detectionJson = JSON.stringify(detection.detections);
        const acceptedOutputSha256 = await sha256(new TextEncoder().encode(acceptedDetectionJson));
        const outputSha256 = await sha256(new TextEncoder().encode(detectionJson));
        fixtureResults.push({
          acceptedDetections: acceptedDetection.detections,
          acceptedOutputSha256,
          detectionCount: detection.detections.length,
          detections: detection.detections,
          expectedDetectionCount: acceptedDetection.detections.length,
          filename: fixture.filename,
          fixtureSha256: fixture.sha256,
          outputSha256,
          timings: detection.timings
        });
      }
      const coldLoad = target.loadTimings;
      const model = target.model;
      const runtime = target.runtime;
      await accepted.dispose();
      await target.dispose();
      const warm = await window.PPDocLayout!.createDocLayout(targetOptions);
      const warmLoad = warm.loadTimings;
      await warm.dispose();
      await window.PPDocLayout!.clearModelCache();

      const adapter =
        backend === "webgpu"
          ? await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })
          : undefined;
      const adapterInfo =
        adapter === undefined
          ? null
          : {
              architecture: adapter.info.architecture || null,
              description: adapter.info.description || null,
              device: adapter.info.device || null,
              vendor: adapter.info.vendor || null
            };
      return {
        adapter: adapterInfo,
        adapterFeatures: adapter === undefined ? [] : [...adapter.features].sort(),
        browser: navigator.userAgent,
        fixtures: fixtureResults,
        model,
        runtime,
        timings: { coldLoad, warmLoad }
      };
    },
    {
      acceptedManifest,
      backend,
      fixtures: fixturesLock.fixtures,
      origin,
      precision,
      targetManifest
    }
  );

  expect(result.runtime).toMatchObject({ backend, fallbacks: [], precision });
  expect(result.model.sha256).toBe(manifestVariant!.sha256);
  expect(result.fixtures).toHaveLength(fixturesLock.fixtures.length);
  const evaluatedFixtures = result.fixtures.map(
    ({ acceptedDetections, detections, ...fixture }) => ({
      ...fixture,
      ...evaluateBrowserParity(precision, acceptedDetections, detections),
      detections
    })
  );
  const validationErrors = evaluatedFixtures.flatMap((fixture) =>
    fixture.validationErrors.map((message) => `${fixture.filename}: ${message}`)
  );
  const fixtureEvidence = evaluatedFixtures.map(({ detections, ...fixture }) => {
    if (fixture.filename !== "table.png") return fixture;

    const firstDetection = detections[0];
    if (firstDetection === undefined) {
      validationErrors.push("table.png: expected reference detection is missing");
      return { ...fixture, referenceMetrics: null, referenceThresholds };
    }
    if (firstDetection.labelId !== reference.realImage.expected.labels[0]) {
      validationErrors.push("table.png: reference label differs");
    }
    const referenceMetrics = {
      iou: boxIou(firstDetection.box),
      maxScoreDelta: Math.abs(firstDetection.score - reference.realImage.expected.scores[0]!),
      meanPolygonPointDistancePixels: meanPolygonPointDistance(firstDetection.polygon)
    };
    if (referenceMetrics.iou < referenceThresholds.iou) {
      validationErrors.push("table.png: reference IoU is below 0.95");
    }
    if (referenceMetrics.maxScoreDelta > referenceThresholds.maxScoreDelta) {
      validationErrors.push("table.png: reference score delta exceeds 0.02");
    }
    if (
      referenceMetrics.meanPolygonPointDistancePixels >
      referenceThresholds.meanPolygonPointDistancePixels
    ) {
      validationErrors.push("table.png: reference polygon distance exceeds 2 px");
    }
    return { ...fixture, referenceMetrics, referenceThresholds };
  });

  const sdkCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8"
  }).trim();
  const report = {
    schemaVersion: 1,
    status: validationErrors.length === 0 ? "passed" : "failed",
    validationErrors,
    acceptedModelSha256: acceptedManifest.variants.find(({ id }) => id === "fp32")!.sha256,
    executionProvider: backend,
    precision,
    fallbacks: result.runtime.fallbacks,
    modelBytes: result.model.bytes,
    modelSha256: result.model.sha256,
    onnxruntimeWebVersion: "1.27.0",
    adapter: result.adapter,
    adapterFeatures: result.adapterFeatures,
    browser: { name: "Chromium", version: browser.version(), userAgent: result.browser },
    operatingSystem: `${platform()} ${release()}`,
    fixtures: fixtureEvidence,
    timingsMs: result.timings,
    sdkCommit,
    capabilities: result.runtime.capabilities,
    cpu: cpus()[0]?.model ?? "unknown",
    generatedAt: new Date().toISOString(),
    id: mode
  };
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, `${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
  expect(validationErrors).toEqual([]);
  for (const fixture of evaluatedFixtures) {
    expect(fixture.parity).toBe("passed");
    expect(fixture.acceptedOutputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.outputSha256).toMatch(/^[a-f0-9]{64}$/);
  }
});

declare global {
  interface Window {
    PPDocLayout?: typeof import("../../packages/sdk/src/index");
  }
}
