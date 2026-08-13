import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import { expect, test } from "playwright/test";

import { TINY_MODEL_BASE64, tinyModelManifest } from "./tiny-model";

const repositoryRoot = resolve(__dirname, "../..");
const sdkRoot = join(repositoryRoot, "packages/sdk");
let fixtureRoot = "";
let installedSdkRoot = "";
let origin = "";
let server: Server | undefined;
let tarball = "";

function run(command: string, args: readonly string[], cwd: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string };
    throw new Error(
      [failure.stdout, failure.stderr].filter((output) => output !== undefined).join("\n"),
      { cause: error }
    );
  }
}

function runPnpm(args: readonly string[], cwd: string): string {
  return process.platform === "win32"
    ? run(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], cwd)
    : run("pnpm", args, cwd);
}

function contentType(path: string): string {
  return extname(path) === ".wasm" ? "application/wasm" : "text/javascript; charset=utf-8";
}

test.beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "ppdoclayout-package-"));
  runPnpm(["--filter", "web-sdk-pp-doclayoutv3", "build"], repositoryRoot);
  runPnpm(["pack", "--pack-destination", fixtureRoot], sdkRoot);
  tarball = join(
    fixtureRoot,
    readdirSync(fixtureRoot).find((name) => name.endsWith(".tgz"))!
  );
  writeFileSync(
    join(fixtureRoot, "package.json"),
    JSON.stringify({
      dependencies: {
        "web-sdk-pp-doclayoutv3": `file:${tarball.replaceAll("\\", "/")}`
      },
      devDependencies: { typescript: "5.9.3", vite: "7.3.6" },
      packageManager: "pnpm@11.16.0",
      private: true,
      version: "0.0.0"
    })
  );
  runPnpm(["install", "--ignore-scripts"], fixtureRoot);
  installedSdkRoot = join(fixtureRoot, "node_modules/web-sdk-pp-doclayoutv3");
  const installedOrtRoot = join(sdkRoot, "node_modules/onnxruntime-web/dist");
  server = createServer((request, response) => {
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><script src="/dist/browser-global.js"></script>');
      return;
    }
    const pathname = new URL(request.url ?? "", "http://localhost").pathname;
    const asset = pathname.startsWith("/dist/")
      ? join(installedSdkRoot, pathname.slice(1))
      : pathname.startsWith("/ort/")
        ? join(installedOrtRoot, basename(pathname))
        : undefined;
    if (asset === undefined || !existsSync(asset) || !statSync(asset).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "content-length": statSync(asset).size,
      "content-type": contentType(asset)
    });
    createReadStream(asset).pipe(response);
  });
  await new Promise<void>((resolveListen) => {
    server!.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Package server failed");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolveClose, reject) => {
      server!.close((error) => (error === undefined ? resolveClose() : reject(error)));
    });
  }
  if (fixtureRoot !== "") rmSync(fixtureRoot, { force: true, recursive: true });
});

test("packed ESM and declarations install in a standalone Vite project", () => {
  const consumer = join(fixtureRoot, "consumer");
  writeFileSync(
    join(fixtureRoot, "index.html"),
    '<div id="app"></div><script type="module" src="/main.ts"></script>'
  );
  writeFileSync(
    join(fixtureRoot, "main.ts"),
    [
      'import { createDocLayout, type DocLayoutResult } from "web-sdk-pp-doclayoutv3";',
      "const result: DocLayoutResult | undefined = undefined;",
      'document.querySelector("#app")!.textContent = `${typeof createDocLayout}:${String(result)}`;'
    ].join("\n")
  );
  writeFileSync(
    join(fixtureRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        target: "ES2022"
      }
    })
  );

  runPnpm(["exec", "tsc", "--noEmit"], fixtureRoot);
  runPnpm(["exec", "vite", "build", "--outDir", consumer], fixtureRoot);

  expect(existsSync(join(consumer, "index.html"))).toBe(true);
  const assetNames = readdirSync(join(consumer, "assets"));
  const workerAssets = assetNames.filter(
    (name) => name.startsWith("inference.worker") && name.endsWith(".js")
  );
  expect(workerAssets).toHaveLength(1);
  const workerBundle = join(consumer, "assets", workerAssets[0]!);
  expect(readFileSync(workerBundle, "utf8").length).toBeGreaterThan(0);
  run(process.execPath, ["--check", workerBundle], consumer);
  const referencingBundles = assetNames.filter(
    (name) =>
      name.endsWith(".js") &&
      name !== workerAssets[0] &&
      readFileSync(join(consumer, "assets", name), "utf8").includes(workerAssets[0]!)
  );
  expect(referencingBundles.length).toBeGreaterThan(0);
});

test("publishes a browser global and a resolvable worker asset", async ({ page }) => {
  const globalBundle = join(installedSdkRoot, "dist/browser-global.js");
  const workerBundle = join(installedSdkRoot, "dist/inference.worker.js");

  expect(existsSync(globalBundle)).toBe(true);
  expect(existsSync(workerBundle)).toBe(true);
  expect(readFileSync(join(installedSdkRoot, "dist/index.js"), "utf8")).toContain(
    'new URL("./inference.worker.js", import.meta.url)'
  );
  await page.goto(origin);
  await expect
    .poll(() => page.evaluate(() => typeof window.PPDocLayout?.createDocLayout))
    .toBe("function");
  const result = await page.evaluate(
    async ({ base64, manifest, wasmBaseUrl }) => {
      const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)).buffer;
      let detector;
      try {
        detector = await window.PPDocLayout!.createDocLayout({
          allowFallback: false,
          backend: "wasm",
          cache: false,
          model: { data, manifest },
          ort: { wasm: { numThreads: 1, paths: wasmBaseUrl } },
          precision: "fp32"
        });
      } catch (error) {
        const failure = error as { code?: string; details?: unknown; message?: string };
        throw new Error(
          JSON.stringify({ code: failure.code, details: failure.details, message: failure.message })
        );
      }
      const detection = await detector.detect({
        height: 1,
        rgba: new Uint8ClampedArray([255, 255, 255, 255]),
        width: 1
      });
      await detector.dispose();
      return { detections: detection.detections.length, mode: detection.runtime.mode };
    },
    { base64: TINY_MODEL_BASE64, manifest: tinyModelManifest, wasmBaseUrl: `${origin}/ort/` }
  );
  expect(result).toEqual({ detections: 1, mode: "worker" });
});

test("keeps the CDN global separate from module bundler entry points", () => {
  const packageMetadata = JSON.parse(
    readFileSync(join(installedSdkRoot, "package.json"), "utf8")
  ) as Record<string, unknown>;

  expect(packageMetadata.browser).toBeUndefined();
  expect(packageMetadata.unpkg).toBe("./dist/browser-global.js");
  expect(packageMetadata.jsdelivr).toBe("./dist/browser-global.js");
});

test("keeps ONNX model files out of the npm tarball", () => {
  const entries = run("tar", ["-tf", tarball], fixtureRoot).split(/\r?\n/);

  expect(entries.some((entry) => entry.endsWith(".onnx"))).toBe(false);
  expect(entries).toContain("package/README.md");
  expect(entries).toContain("package/dist/inference.worker.js");
  expect(entries).toContain("package/dist/browser-global.js");

  const readme = readFileSync(join(installedSdkRoot, "README.md"), "utf8");
  expect(readme).toContain("# web-sdk-pp-doclayoutv3");
  expect(readme).toContain("## English");
  expect(readme).toContain("createDocLayout");
});

declare global {
  interface Window {
    PPDocLayout?: typeof import("../../packages/sdk/src/index");
  }
}
