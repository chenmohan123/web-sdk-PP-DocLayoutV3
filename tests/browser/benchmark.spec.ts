import { execFileSync } from "node:child_process";
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
import { basename, extname, join, normalize, resolve } from "node:path";

import { expect, test } from "playwright/test";

import reference from "../../packages/sdk/tests/fixtures/model-output-reference.json";

const mode = process.env.PPDOCLAYOUT_BENCHMARK_MODE;
const repositoryRoot = resolve(__dirname, "../..");
const sdkRoot = join(repositoryRoot, "packages/sdk");
const ortRoot = join(sdkRoot, "node_modules/onnxruntime-web/dist");
const modelRoot = join(repositoryRoot, "models/pp-doclayoutv3/1.0.0");
const fixtureRoot = join(repositoryRoot, "tools/model-pipeline/fixtures/images");
const outputRoot = join(repositoryRoot, "test-results/benchmark");
let origin = "";
let server: Server;

function runPnpm(args: readonly string[]): void {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs = process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...args] : args;
  execFileSync(command, commandArgs, { cwd: repositoryRoot, stdio: "pipe" });
}

function resolveAsset(url: string): string | undefined {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname.startsWith("/dist/")) return join(sdkRoot, pathname.slice(1));
  if (pathname.startsWith("/ort/")) return join(ortRoot, basename(pathname));
  if (pathname.startsWith("/models/")) return join(modelRoot, basename(pathname));
  if (pathname.startsWith("/fixtures/")) return join(fixtureRoot, basename(pathname));
  return undefined;
}

function contentType(path: string): string {
  return (
    {
      ".js": "text/javascript; charset=utf-8",
      ".onnx": "application/octet-stream",
      ".png": "image/png",
      ".wasm": "application/wasm"
    }[extname(path)] ?? "application/octet-stream"
  );
}

test.beforeAll(async () => {
  test.skip(!["wasm-fp32", "webgpu-fp16"].includes(mode ?? ""), "Set benchmark mode");
  runPnpm(["--filter", "web-sdk-pp-doclayoutv3", "build"]);
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><script>globalThis.Worker=undefined;</script><script src="/dist/browser-global.js"></script>'
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

test("records complete real-model timings", async ({ browser, page }) => {
  const manifest = JSON.parse(readFileSync(join(modelRoot, "manifest.json"), "utf8")) as unknown;
  await page.goto(origin);
  const backend = mode === "wasm-fp32" ? "wasm" : "webgpu";
  const precision = mode === "wasm-fp32" ? "fp32" : "fp16";
  const result = await page.evaluate(
    async ({ backend, manifest, origin: browserOrigin, precision }) => {
      const configured = structuredClone(manifest) as {
        variants: Array<{ filename: string; url: string }>;
      };
      for (const variant of configured.variants)
        variant.url = `${browserOrigin}/models/${variant.filename}`;
      const options = {
        allowFallback: false,
        backend,
        cache: true,
        model: configured,
        ort: { wasm: { numThreads: 1, paths: `${browserOrigin}/ort/` } },
        precision
      } as const;
      await window.PPDocLayout!.clearModelCache();
      const cold = await window.PPDocLayout!.createDocLayout(options);
      const image = await (await fetch(`${browserOrigin}/fixtures/table.png`)).blob();
      const detection = await cold.detect(image, { threshold: 0.5 });
      const coldLoad = cold.loadTimings;
      const model = cold.model;
      const runtime = cold.runtime;
      await cold.dispose();
      const warm = await window.PPDocLayout!.createDocLayout(options);
      const warmLoad = warm.loadTimings;
      await warm.dispose();
      await window.PPDocLayout!.clearModelCache();
      const adapter =
        backend === "webgpu"
          ? await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })
          : undefined;
      return {
        adapter: adapter?.info ?? null,
        browser: navigator.userAgent,
        coldLoad,
        detection,
        model,
        runtime,
        warmLoad
      };
    },
    { backend, manifest, origin, precision }
  );
  expect(result.runtime).toMatchObject({ backend, precision });
  expect(result.detection.detections.length).toBeGreaterThan(0);
  expect(result.detection.detections[0]?.box.xMin).toBeCloseTo(
    reference.realImage.expected.boxes[0]![0]!,
    1
  );

  const report = {
    schemaVersion: 1,
    id: mode,
    status: "passed",
    generatedAt: new Date().toISOString(),
    sdkCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8"
    }).trim(),
    environment: {
      browser: { name: "Chromium", version: browser.version(), userAgent: result.browser },
      cpu: cpus()[0]?.model ?? "unknown",
      hardware:
        backend === "webgpu"
          ? (result.adapter?.description ?? result.adapter?.architecture ?? result.adapter?.vendor)
          : (cpus()[0]?.model ?? "unknown"),
      os: `${platform()} ${release()}`
    },
    ort: { version: "1.27.0" },
    model: {
      bytes: result.model.bytes,
      precision: result.model.precision,
      sha256: result.model.sha256
    },
    coldLoad: result.coldLoad,
    warmLoad: result.warmLoad,
    detection: {
      count: result.detection.detections.length,
      parity: "passed",
      timings: result.detection.timings
    },
    adapter: result.adapter,
    peakMemory: {
      bytes: null,
      reason: "Chromium does not expose reliable per-inference peak memory."
    }
  };
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(join(outputRoot, `${mode}.json`), `${JSON.stringify(report, null, 2)}\n`);
});

declare global {
  interface Window {
    PPDocLayout?: typeof import("../../packages/sdk/src/index");
  }
}
