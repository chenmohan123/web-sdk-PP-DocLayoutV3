import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyWithJsonMutation(relativePath, mutate) {
  const path = resolve(repositoryRoot, relativePath);
  const original = readFileSync(path, "utf8");
  const value = JSON.parse(original);
  mutate(value);
  try {
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
    return spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--models", "1.0.1"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );
  } finally {
    writeFileSync(path, original);
  }
}

function verifyWithCurrentFp32Schema() {
  const benchmarkPath = resolve(repositoryRoot, "benchmarks/1.0.1/wasm-fp32.json");
  const evidencePath = resolve(
    repositoryRoot,
    "tools/model-pipeline/reports/1.0.1/browser-evidence.json"
  );
  const originalBenchmark = readFileSync(benchmarkPath, "utf8");
  const originalEvidence = readFileSync(evidencePath, "utf8");
  const benchmark = JSON.parse(originalBenchmark);
  for (const fixture of benchmark.fixtures) {
    delete fixture.labelSequenceEqual;
    delete fixture.readingOrderEqual;
    fixture.parityThresholds.policy = "fp32-equality";
  }
  const evidence = JSON.parse(originalEvidence);
  evidence.fp32Wasm = structuredClone(benchmark);
  try {
    writeFileSync(benchmarkPath, `${JSON.stringify(benchmark, null, 2)}\n`);
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    return spawnSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--models", "1.0.1"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );
  } finally {
    writeFileSync(benchmarkPath, originalBenchmark);
    writeFileSync(evidencePath, originalEvidence);
  }
}

function modelStagingFixture({ corruptFp32 = false, unsafeFp16Url = false } = {}) {
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
        url: unsafeFp16Url
          ? "https://evil.example/model-fp16.onnx"
          : "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp16.onnx"
      },
      {
        bytes: fp32.byteLength,
        filename: "model-fp32.onnx",
        id: "fp32",
        sha256: sha256(fp32),
        url: "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp32.onnx"
      }
    ]
  };
  const assets = new Map([
    ["https://release.test/manifest.json", JSON.stringify(manifest)],
    [
      "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp16.onnx",
      fp16
    ],
    [
      "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models/model-fp32.onnx",
      corruptFp32 ? Buffer.from("Fp32-model") : fp32
    ]
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

  test("verifies model 1.0.2 as the SDK 1.1.0 default", () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, "scripts/verify-release.mjs"), "--models", "1.0.2"],
      { cwd: repositoryRoot, encoding: "utf8" }
    );

    assert.match(output, /model 1\.0\.2/);
  });

  test("creates the immutable model release without clobber", () => {
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/model-validation.yml"),
      "utf8"
    );

    assert.match(workflow, /model_version:[\s\S]*default:\s*["']?1\.0\.2/);
    assert.match(workflow, /release_tag:[\s\S]*default:\s*["']?v1\.0\.2-models/);
    assert.match(workflow, /gh release create/);
    assert.doesNotMatch(workflow, /--clobber/);
    assert.match(workflow, /GITHUB_REF[\s\S]*refs\/heads\/main/);
    assert.match(
      workflow,
      /git ls-remote --exit-code --tags origin "refs\/tags\/\$\{RELEASE_TAG\}"/
    );
    assert.match(workflow, /--target "\$\{GITHUB_SHA\}"/);
    assert.doesNotMatch(workflow, /--target main/);
  });

  test("rejects FP32 browser evidence for a different model", () => {
    const result = verifyWithJsonMutation(
      "tools/model-pipeline/reports/1.0.1/browser-evidence.json",
      (evidence) => {
        evidence.fp32Wasm.modelSha256 = "0".repeat(64);
      }
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FP32 WASM browser evidence does not match the manifest/);
  });

  test("rejects incomplete or inconsistent FP32 browser evidence", () => {
    const evidencePath = "tools/model-pipeline/reports/1.0.1/browser-evidence.json";
    const cases = [
      [
        (evidence) => {
          evidence.fp32Wasm.modelBytes += 1;
        },
        /FP32 WASM browser evidence byte size does not match the manifest/
      ],
      [
        (evidence) => {
          evidence.fp32Wasm.executionProvider = "webgpu";
        },
        /FP32 WASM browser evidence execution provider is invalid/
      ],
      [
        (evidence) => {
          evidence.fp32Wasm.precision = "fp16";
        },
        /FP32 WASM browser evidence precision is invalid/
      ],
      [
        (evidence) => {
          evidence.fp32Wasm.fixtures.pop();
        },
        /FP32 WASM browser evidence fixture set is incomplete/
      ],
      [
        (evidence) => {
          evidence.fp32Wasm.fixtures[0].parity = "failed";
        },
        /FP32 WASM browser evidence fixture parity failed/
      ]
    ];

    for (const [mutate, expectedError] of cases) {
      const result = verifyWithJsonMutation(evidencePath, mutate);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, expectedError);
    }
  });

  test("rejects browser evidence that differs from the committed benchmark", () => {
    const result = verifyWithJsonMutation("benchmarks/1.0.1/wasm-fp32.json", (report) => {
      report.modelBytes += 1;
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /FP32 WASM browser evidence differs from the benchmark artifact/);
  });

  test("accepts current FP32 parity evidence while preserving historical compatibility", () => {
    const result = verifyWithCurrentFp32Schema();

    assert.equal(result.status, 0, result.stderr);
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

  test("keeps the 1.1.0 package, runtime, and changelog versions aligned", () => {
    const packageMetadata = JSON.parse(
      readFileSync(resolve(repositoryRoot, "packages/sdk/package.json"), "utf8")
    );
    const runtime = readFileSync(
      resolve(repositoryRoot, "packages/sdk/src/model/manifest.ts"),
      "utf8"
    );
    const changelog = readFileSync(resolve(repositoryRoot, "CHANGELOG.md"), "utf8");

    assert.equal(packageMetadata.version, "1.1.0");
    assert.match(runtime, /CURRENT_SDK_VERSION = "1\.1\.0"/);
    assert.match(changelog, /^## 1\.1\.0$/m);
  });

  test("binds the model manifest release to the verified main commit", () => {
    const modelWorkflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/model-validation.yml"),
      "utf8"
    );

    assert.match(
      modelWorkflow,
      /upload-model-assets:\s*\n\s*if:\s*github\.ref == ['"]refs\/heads\/main['"] && inputs\.upload_assets/
    );
    assert.match(
      modelWorkflow,
      /gh release create "\$\{RELEASE_TAG\}"[\s\S]*--target "\$\{GITHUB_SHA\}"/
    );
    assert.match(
      modelWorkflow,
      /git fetch --force origin "refs\/tags\/\$\{RELEASE_TAG\}:refs\/tags\/\$\{RELEASE_TAG\}"/
    );
    assert.match(modelWorkflow, /tag_sha="\$\(git rev-list -n 1 "\$\{RELEASE_TAG\}"\)"/);
    assert.match(modelWorkflow, /\[\[ "\$\{tag_sha\}" != "\$\{GITHUB_SHA\}" \]\]/);
  });

  test("recognizes standard list-form GitHub Action steps", () => {
    const ci = readFileSync(resolve(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
    const pages = readFileSync(resolve(repositoryRoot, ".github/workflows/pages.yml"), "utf8");

    assert.match(ci, /^\s*- uses: actions\/checkout@v7\r?$/m);
    assert.match(pages, /^\s*- uses: actions\/configure-pages@v6\r?$/m);
    assert.match(pages, /^\s*- uses: actions\/upload-pages-artifact@v5\r?$/m);
    assert.match(pages, /^\s*uses: actions\/deploy-pages@v5\r?$/m);

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
            stdio: "pipe",
            env: { ...process.env, CI: "true" }
          }
        );
        execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
          cwd: repositoryRoot,
          stdio: "pipe",
          env: { ...process.env, CI: "true" }
        });
      } else {
        execFileSync("pnpm", sdkBuildArgs, {
          cwd: repositoryRoot,
          stdio: "pipe",
          env: { ...process.env, CI: "true" }
        });
        execFileSync("pnpm", args, {
          cwd: repositoryRoot,
          stdio: "pipe",
          env: { ...process.env, CI: "true" }
        });
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
        publicRoot: "https://pages.test/models/v1.0.2",
        releaseRoot: "https://release.test"
      });

      assert.equal(staged.variants[0].url, "https://pages.test/models/v1.0.2/model-fp16.onnx");
      assert.equal(staged.variants[1].url, "https://pages.test/models/v1.0.2/model-fp32.onnx");
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

  test("keeps historical and current models in the Pages artifact", async () => {
    const stagingSource = readFileSync(
      resolve(repositoryRoot, "scripts/stage-pages-models.mjs"),
      "utf8"
    );
    const { stageAllPagesModels } = await import("./stage-pages-models.mjs");
    const outputRoot = mkdtempSync(resolve(tmpdir(), "ppdoclayout-model-versions-"));
    const fixture = modelStagingFixture();
    const fetchImpl = (url) =>
      fixture.fetchImpl(
        String(url).endsWith("/manifest.json") ? "https://release.test/manifest.json" : String(url)
      );

    try {
      assert.match(stagingSource, /await stageAllPagesModels\(/);
      const staged = await stageAllPagesModels({ fetchImpl, outputRoot });

      assert.deepEqual(
        staged.map(({ model }) => model.version),
        ["1.0.0", "1.0.1", "1.0.2"]
      );
      for (const version of ["1.0.0", "1.0.1", "1.0.2"]) {
        const publicVersion = `v${version}`;
        const manifest = JSON.parse(
          readFileSync(resolve(outputRoot, publicVersion, "manifest.json"), "utf8")
        );
        assert.equal(
          manifest.variants[0].url,
          `https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/${publicVersion}/model-fp16.onnx`
        );
        assert.deepEqual(
          readFileSync(resolve(outputRoot, publicVersion, "model-fp16.onnx")),
          fixture.fp16
        );
        assert.deepEqual(
          readFileSync(resolve(outputRoot, publicVersion, "model-fp32.onnx")),
          fixture.fp32
        );
      }
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
          publicRoot: "https://pages.test/models/v1.0.2",
          releaseRoot: "https://release.test"
        }),
        /model-fp32\.onnx SHA-256 mismatch/
      );
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });

  test("rejects a staged model URL outside immutable repository releases", async () => {
    const { stagePagesModels } = await import("./stage-pages-models.mjs");
    const outputRoot = mkdtempSync(resolve(tmpdir(), "ppdoclayout-model-stage-"));
    const fixture = modelStagingFixture({ unsafeFp16Url: true });
    try {
      await assert.rejects(
        stagePagesModels({
          fetchImpl: fixture.fetchImpl,
          outputRoot,
          publicRoot: "https://pages.test/models/v1.0.2",
          releaseRoot: "https://release.test"
        }),
        /Unsafe or unexpected model URL/
      );
    } finally {
      rmSync(outputRoot, { force: true, recursive: true });
    }
  });
});
