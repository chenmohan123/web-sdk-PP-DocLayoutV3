import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { basename, extname, join, normalize, resolve } from "node:path";

import { expect, test } from "playwright/test";

import reference from "../../packages/sdk/tests/fixtures/model-output-reference.json";
import { TINY_MODEL_BASE64, tinyModelManifest } from "./tiny-model";

const repositoryRoot = resolve(__dirname, "../..");
const sdkRoot = join(repositoryRoot, "packages/sdk");
const ortRoot = join(sdkRoot, "node_modules/onnxruntime-web/dist");
const modelRoot = join(repositoryRoot, "models/pp-doclayoutv3/1.0.0");
const fixtureRoot = join(repositoryRoot, "tools/model-pipeline/fixtures/images");
let origin = "";
let server: Server;
let tinyModelRequests = 0;

const tinyModelBytes = Buffer.from(TINY_MODEL_BASE64, "base64");

function runPnpm(args: readonly string[]): void {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args;
  execFileSync(command, commandArgs, { cwd: repositoryRoot, stdio: "pipe" });
}

function contentType(path: string): string {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json",
      ".mjs": "text/javascript; charset=utf-8",
      ".onnx": "application/octet-stream",
      ".png": "image/png",
      ".wasm": "application/wasm"
    }[extname(path)] ?? "application/octet-stream"
  );
}

function resolveAsset(url: string): string | undefined {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname.startsWith("/dist/")) return join(sdkRoot, pathname.slice(1));
  if (pathname.startsWith("/ort/")) return join(ortRoot, basename(pathname));
  if (pathname.startsWith("/models/")) return join(modelRoot, basename(pathname));
  if (pathname.startsWith("/fixtures/")) return join(fixtureRoot, basename(pathname));
  return undefined;
}

test.beforeAll(async () => {
  runPnpm(["--filter", "web-sdk-pp-doclayoutv3", "build"]);
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><script>globalThis.Worker=undefined;</script><script src="/dist/browser-global.js"></script>'
      );
      return;
    }
    if (request.url === "/tiny-model.onnx") {
      tinyModelRequests += 1;
      response.writeHead(200, {
        "access-control-allow-origin": "*",
        "content-length": tinyModelBytes.byteLength,
        "content-type": "application/octet-stream"
      });
      response.end(tinyModelBytes);
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
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Browser server failed");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error === undefined ? resolveClose() : reject(error)));
  });
});

test("runs a deterministic ONNX lifecycle through browser WASM", async ({ page }) => {
  await page.goto(origin);
  const result = await page.evaluate(
    async ({ base64, manifest, wasmBaseUrl }) => {
      const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer;
      const detector = await window.PPDocLayout!.createDocLayout({
        allowFallback: false,
        backend: "wasm",
        cache: false,
        model: { data, manifest },
        ort: { wasm: { numThreads: 1, paths: wasmBaseUrl } },
        precision: "fp32"
      });
      const detection = await detector.detect({
        height: 1,
        rgba: new Uint8ClampedArray([255, 255, 255, 255]),
        width: 1
      });
      await detector.dispose();
      return {
        detection: detection.detections[0],
        detections: detection.detections.length,
        image: detection.image,
        runtime: detection.runtime,
        totalMs: detection.timings.totalMs
      };
    },
    { base64: TINY_MODEL_BASE64, manifest: tinyModelManifest, wasmBaseUrl: `${origin}/ort/` }
  );

  expect(result).toMatchObject({
    detection: { label: "text" },
    detections: 1,
    image: { original: { height: 1, width: 1 } },
    runtime: { backend: "wasm", precision: "fp32" }
  });
  expect(result.detection?.polygon.length).toBeGreaterThan(0);
  expect(result.detection?.box.xMin).toBeCloseTo(0.1);
  expect(result.detection?.box.yMin).toBeCloseTo(0.1);
  expect(result.detection?.box.xMax).toBeCloseTo(0.9);
  expect(result.detection?.box.yMax).toBeCloseTo(0.9);
  expect(result.totalMs).toBeGreaterThanOrEqual(0);
});

test("reuses a verified model from browser cache", async ({ page }) => {
  tinyModelRequests = 0;
  await page.goto(origin);
  const result = await page.evaluate(
    async ({ manifest, modelUrl, wasmBaseUrl }) => {
      const cachedManifest = structuredClone(manifest);
      cachedManifest.variants[0]!.url = modelUrl;
      await window.PPDocLayout!.clearModelCache();
      const create = () =>
        window.PPDocLayout!.createDocLayout({
          allowFallback: false,
          backend: "wasm",
          cache: true,
          model: cachedManifest,
          ort: { wasm: { numThreads: 1, paths: wasmBaseUrl } },
          precision: "fp32"
        });
      const first = await create();
      await first.dispose();
      const entriesAfterFirstLoad = await window.PPDocLayout!.listModelCache();
      const second = await create();
      await second.dispose();
      await window.PPDocLayout!.clearModelCache();
      return { cachedEntries: entriesAfterFirstLoad.length };
    },
    {
      manifest: tinyModelManifest,
      modelUrl: `${origin}/tiny-model.onnx`,
      wasmBaseUrl: `${origin}/ort/`
    }
  );

  expect(result.cachedEntries).toBe(1);
  expect(tinyModelRequests).toBe(1);
});

test("@real-model runs FP32 WASM detection on a licensed fixture", async ({ page }) => {
  test.skip(process.env.PPDOCLAYOUT_REAL_MODEL !== "1", "Set PPDOCLAYOUT_REAL_MODEL=1 locally");
  const manifest = JSON.parse(readFileSync(join(modelRoot, "manifest.json"), "utf8")) as unknown;
  await page.goto(origin);
  const result = await page.evaluate(
    async ({ manifest, origin: browserOrigin }) => {
      const [modelResponse, imageResponse] = await Promise.all([
        fetch(`${browserOrigin}/models/model-fp32.onnx`),
        fetch(`${browserOrigin}/fixtures/table.png`)
      ]);
      const detector = await window.PPDocLayout!.createDocLayout({
        allowFallback: false,
        backend: "wasm",
        cache: false,
        model: { data: await modelResponse.arrayBuffer(), manifest },
        ort: { wasm: { numThreads: 1, paths: `${browserOrigin}/ort/` } },
        precision: "fp32"
      });
      const detection = await detector.detect(await imageResponse.blob(), { threshold: 0.5 });
      await detector.dispose();
      return {
        count: detection.detections.length,
        first: detection.detections[0],
        image: detection.image.original,
        inferenceMs: detection.timings.inferenceMs,
        runtime: detection.runtime
      };
    },
    { manifest, origin }
  );

  expect(result.count).toBeGreaterThan(0);
  const expectedBox = reference.realImage.expected.boxes[0]!;
  expect(result.first?.box.xMin).toBeCloseTo(expectedBox[0]!, 1);
  expect(result.first?.box.yMin).toBeCloseTo(expectedBox[1]!, 1);
  expect(result.first?.box.xMax).toBeCloseTo(expectedBox[2]!, 1);
  expect(result.first?.box.yMax).toBeCloseTo(expectedBox[3]!, 1);
  expect(result.first?.polygon.map(({ x, y }) => [x, y])).toEqual(
    reference.realImage.expected.polygons[0]
  );
  expect(result.image).toEqual(reference.realImage.targetSize);
  expect(result.inferenceMs).toBeGreaterThan(0);
  expect(result.runtime).toMatchObject({ backend: "wasm", precision: "fp32" });
});

test("@real-model runs FP16 WebGPU detection when shader-f16 is available", async ({ page }) => {
  test.skip(process.env.PPDOCLAYOUT_REAL_MODEL !== "1", "Set PPDOCLAYOUT_REAL_MODEL=1 locally");
  await page.goto(origin);
  const webgpuFp16 = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    return adapter?.features.has("shader-f16") === true;
  });
  test.skip(!webgpuFp16, "This Chromium adapter does not expose shader-f16");
  const manifest = JSON.parse(readFileSync(join(modelRoot, "manifest.json"), "utf8")) as unknown;
  const result = await page.evaluate(
    async ({ manifest, origin: browserOrigin }) => {
      const [modelResponse, imageResponse] = await Promise.all([
        fetch(`${browserOrigin}/models/model-fp16.onnx`),
        fetch(`${browserOrigin}/fixtures/table.png`)
      ]);
      const detector = await window.PPDocLayout!.createDocLayout({
        allowFallback: false,
        backend: "webgpu",
        cache: false,
        model: { data: await modelResponse.arrayBuffer(), manifest },
        precision: "fp16"
      });
      const detection = await detector.detect(await imageResponse.blob(), { threshold: 0.5 });
      await detector.dispose();
      return {
        count: detection.detections.length,
        inferenceMs: detection.timings.inferenceMs,
        runtime: detection.runtime
      };
    },
    { manifest, origin }
  );

  expect(result.count).toBeGreaterThan(0);
  expect(result.inferenceMs).toBeGreaterThan(0);
  expect(result.runtime).toMatchObject({ backend: "webgpu", precision: "fp16" });
});

declare global {
  interface Window {
    PPDocLayout?: typeof import("../../packages/sdk/src/index");
  }
}
