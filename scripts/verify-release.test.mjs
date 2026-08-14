import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function modelStagingFixture({ corruptFp32 = false } = {}) {
  const fp16 = Buffer.from("fp16-model");
  const fp32 = Buffer.from("fp32-model");
  const manifest = {
    schemaVersion: 1,
    variants: [
      {
        bytes: fp16.byteLength,
        filename: "model-fp16.onnx",
        id: "fp16",
        sha256: sha256(fp16),
        url: "https://release.invalid/model-fp16.onnx"
      },
      {
        bytes: fp32.byteLength,
        filename: "model-fp32.onnx",
        id: "fp32",
        sha256: sha256(fp32),
        url: "https://release.invalid/model-fp32.onnx"
      }
    ]
  };
  const assets = new Map([
    ["https://release.test/manifest.json", JSON.stringify(manifest)],
    ["https://release.test/model-fp16.onnx", fp16],
    ["https://release.test/model-fp32.onnx", corruptFp32 ? Buffer.from("Fp32-model") : fp32]
  ]);
  return {
    fp16,
    fp32,
    fetchImpl: async (url) => {
      const body = assets.get(String(url));
      return body === undefined ? new Response(null, { status: 404 }) : new Response(body);
    }
  };
}

describe("release workflow contract", () => {
  test("validates the repository release configuration", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--static"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );

    assert.match(output, /Release contract verified:/);
    assert.match(output, /4 workflows, 2 model variants/);
  });

  test("verifies model 1.0.1 without changing the SDK 1.0.4 default", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--models", "1.0.1"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );

    assert.match(output, /model 1\.0\.1/);
  });

  test("creates the immutable model release without clobber", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/model-validation.yml"),
      "utf8"
    );

    assert.match(workflow, /model_version:[\s\S]*default:\s*["']?1\.0\.1/);
    assert.match(workflow, /release_tag:[\s\S]*default:\s*["']?v1\.0\.1-models/);
    assert.match(workflow, /gh release create/);
    assert.doesNotMatch(workflow, /--clobber/);
  });

  test("requires package repository metadata to match GitHub provenance", () => {
    const packageMetadata = JSON.parse(
      readFileSync(resolve(repositoryRoot, "packages/sdk/package.json"), "utf8")
    );

    assert.deepEqual(packageMetadata.repository, {
      type: "git",
      url: "git+https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3.git"
    });
  });

  test("keeps the 1.0.4 package, runtime, and changelog versions aligned", () => {
    const packageMetadata = JSON.parse(
      readFileSync(resolve(repositoryRoot, "packages/sdk/package.json"), "utf8")
    );
    const runtime = readFileSync(
      resolve(repositoryRoot, "packages/sdk/src/model/manifest.ts"),
      "utf8"
    );
    const changelog = readFileSync(resolve(repositoryRoot, "CHANGELOG.md"), "utf8");

    assert.equal(packageMetadata.version, "1.0.4");
    assert.match(runtime, /CURRENT_SDK_VERSION = "1\.0\.4"/);
    assert.match(changelog, /^## 1\.0\.4$/m);
  });

  test("recognizes standard list-form GitHub Action steps", () => {
    const ci = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
    const pages = readFileSync(resolve(repositoryRoot, ".github/workflows/pages.yml"), "utf8");

    assert.match(ci, /^\s*- uses: actions\/checkout@v7\r?$/m);
    assert.match(pages, /^\s*- uses: actions\/configure-pages@v6\r?$/m);
    assert.match(pages, /^\s*- uses: actions\/upload-pages-artifact@v5\r?$/m);

    const setupNodeWorkflows = [
      ["benchmark.yml", 4],
      ["ci.yml", 3],
      ["model-validation.yml", 2],
      ["pages.yml", 1],
      ["release.yml", 1]
    ];
    for (const [name, expectedCount] of setupNodeWorkflows) {
      const source = readFileSync(resolve(repositoryRoot, ".github/workflows", name), "utf8");
      assert.equal(
        source.match(/actions\/setup-node@v7/g)?.length ?? 0,
        expectedCount,
        `${name} must pin every Node setup step to v7`
      );
      assert.doesNotMatch(source, /actions\/setup-node@v4/);
    }
  });

  test("runs the workspace verify script without invoking pnpm's built-in verify command", () => {
    const ci = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
    const verifier = readFileSync(resolve(repositoryRoot, "scripts/verify-release.mjs"), "utf8");

    assert.match(ci, /^\s*- run: pnpm run verify$/m);
    assert.match(verifier, /runPnpm\(\["run", "verify"\]\)/);
  });

  test("rejects a release tag that does not match the SDK package version", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--release", "v9.9.9"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /tag v9\.9\.9 does not match package version/);
  });

  test("builds Pages assets with the repository base path", () => {
    const outputRoot = mkdtempSync(resolve(tmpdir(), "ppdoclayout-pages-"));
    try {
      const sdkBuildArgs = ["--filter", "web-sdk-pp-doclayoutv3", "build"];
      const args = [
        "--filter",
        "demo",
        "exec",
        "vite",
        "build",
        "--base",
        "/web-sdk-PP-DocLayoutV3/",
        "--outDir",
        outputRoot,
        "--emptyOutDir"
      ];
      if (process.platform === "win32") {
        execFileSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", "pnpm", ...sdkBuildArgs],
          {
            cwd: repositoryRoot,
            stdio: "pipe"
          }
        );
        execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
          cwd: repositoryRoot,
          stdio: "pipe"
        });
      } else {
        execFileSync("pnpm", sdkBuildArgs, { cwd: repositoryRoot, stdio: "pipe" });
        execFileSync("pnpm", args, { cwd: repositoryRoot, stdio: "pipe" });
      }

      const html = readFileSync(resolve(outputRoot, "index.html"), "utf8");
      assert.match(html, /(?:src|href)="\/web-sdk-PP-DocLayoutV3\/assets\//);
      const javascript = readdirSync(resolve(outputRoot, "assets"))
        .filter((filename) => filename.endsWith(".js"))
        .map((filename) => readFileSync(resolve(outputRoot, "assets", filename), "utf8"))
        .join("\n");
      assert.match(javascript, /\/web-sdk-PP-DocLayoutV3\/samples\//);
      assert.match(javascript, /layout-demo\.jpg/);
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });

  test("stages validated browser-fetchable models in the Pages artifact", () => {
    const pages = readFileSync(resolve(repositoryRoot, ".github/workflows/pages.yml"), "utf8");

    assert.match(
      pages,
      /vite build[\s\S]*node scripts\/stage-pages-models\.mjs[\s\S]*upload-pages-artifact/
    );
  });

  test("publishes through npm Trusted Publishing without token fallbacks", () => {
    const release = readFileSync(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8");

    assert.match(release, /environment:\s*npm/);
    assert.match(release, /id-token:\s+write/);
    assert.match(release, /npm publish --access public --provenance/);
    assert.doesNotMatch(release, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
  });

  test("retries npm integrity lookup without hiding a persistent failure", () => {
    const release = readFileSync(resolve(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const integrityStep = release.slice(release.indexOf("- name: Record published integrity"));

    assert.match(integrityStep, /shell: bash/);
    assert.match(integrityStep, /set -o pipefail/);
    assert.match(integrityStep, /for attempt in \{1\.\.5\}; do/);
    assert.match(
      integrityStep,
      /metadata="\$\(npm view "\$package" version dist\.integrity --json\)"/
    );
    assert.match(integrityStep, /sleep 3/);
    assert.match(integrityStep, /echo "\$metadata"/);
    assert.match(integrityStep, /exit 1/);
  });

  test("stages verified release models with public Pages URLs", async () => {
    const { stagePagesModels } = await import("./stage-pages-models.mjs");
    const outputRoot = mkdtempSync(resolve(tmpdir(), "ppdoclayout-model-stage-"));
    const fixture = modelStagingFixture();
    try {
      const staged = await stagePagesModels({
        fetchImpl: fixture.fetchImpl,
        outputRoot,
        publicRoot: "https://pages.test/models/v1.0.0",
        releaseRoot: "https://release.test"
      });

      assert.equal(staged.variants[0].url, "https://pages.test/models/v1.0.0/model-fp16.onnx");
      assert.equal(staged.variants[1].url, "https://pages.test/models/v1.0.0/model-fp32.onnx");
      assert.deepEqual(readFileSync(resolve(outputRoot, "model-fp16.onnx")), fixture.fp16);
      assert.deepEqual(readFileSync(resolve(outputRoot, "model-fp32.onnx")), fixture.fp32);
      assert.deepEqual(
        JSON.parse(readFileSync(resolve(outputRoot, "manifest.json"), "utf8")),
        staged
      );
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });

  test("rejects a staged model whose SHA-256 does not match", async () => {
    const { stagePagesModels } = await import("./stage-pages-models.mjs");
    const outputRoot = mkdtempSync(resolve(tmpdir(), "ppdoclayout-model-stage-"));
    const fixture = modelStagingFixture({ corruptFp32: true });
    try {
      await assert.rejects(
        stagePagesModels({
          fetchImpl: fixture.fetchImpl,
          outputRoot,
          publicRoot: "https://pages.test/models/v1.0.0",
          releaseRoot: "https://release.test"
        }),
        /model-fp32\.onnx SHA-256 mismatch/
      );
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });
});
