import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const benchmarkRoot = join(repositoryRoot, "benchmarks/1.0.0");

function readJson(name, version = "1.0.0") {
  const path = join(repositoryRoot, "benchmarks", version, name);
  assert.ok(existsSync(path), `missing benchmark artifact: benchmarks/${version}/${name}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("1.0.0 benchmark release contract", () => {
  test("provides a manual hardware benchmark workflow", () => {
    const workflow = readFileSync(join(repositoryRoot, ".github/workflows/benchmark.yml"), "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /push:\s+branches:\s+\[main\]\s+paths:/);
    assert.match(workflow, /tests\/browser\/benchmark\.spec\.ts/);
    assert.match(workflow, /PPDOCLAYOUT_BENCHMARK_MODE:\s*["']?wasm-fp32/);
    assert.match(workflow, /PPDOCLAYOUT_BENCHMARK_MODE:\s*["']?webgpu-fp16/);
    assert.match(workflow, /PPDOCLAYOUT_BENCHMARK_MODE:\s*["']?webgpu-fp32/);
    assert.match(workflow, /name:\s*benchmark-webgpu-fp32/);
    assert.match(workflow, /runs-on:\s*\[self-hosted, windows, x64, webgpu-hardware\]/);
    assert.match(workflow, /benchmark\.spec\.ts/);
    const artifactWorkflows = [
      ["benchmark.yml", workflow, 4],
      ["ci.yml", readFileSync(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8"), 1],
      [
        "model-validation.yml",
        readFileSync(join(repositoryRoot, ".github/workflows/model-validation.yml"), "utf8"),
        1
      ]
    ];
    for (const [name, source, expectedCount] of artifactWorkflows) {
      assert.equal(
        source.match(/actions\/upload-artifact@v7/g)?.length ?? 0,
        expectedCount,
        `${name} must pin every artifact upload to v7`
      );
      assert.doesNotMatch(source, /actions\/upload-artifact@v4/);
    }
    assert.match(workflow, /responsive-screenshots/);
    assert.match(
      workflow,
      /pnpm --filter web-sdk-pp-doclayoutv3 build[\s\S]+pnpm --filter demo test/
    );
    const benchmark = readFileSync(join(repositoryRoot, "tests/browser/benchmark.spec.ts"), "utf8");
    assert.match(benchmark, /causeMessage/);
    assert.match(benchmark, /capabilities/);
    assert.match(benchmark, /\.mjs["']:\s*["']text\/javascript/);
    assert.match(benchmark, /channel:\s*["']chrome["']/);
    assert.match(benchmark, /Cross-Origin-Embedder-Policy/);
    assert.match(benchmark, /mode === ["']wasm-fp32["'][\s\S]+globalThis\.Worker=undefined/);
    assert.match(benchmark, /iou:\s*0\.95/);
    assert.match(benchmark, /maxScoreDelta:\s*0\.02/);
    assert.match(benchmark, /meanPolygonPointDistancePixels:\s*2/);
    assert.match(benchmark, /architecture:\s*adapter\.info\.architecture/);
    assert.match(benchmark, /vendor:\s*adapter\.info\.vendor/);
    assert.match(benchmark, /capabilities:\s*result\.runtime\.capabilities/);
  });

  test("keeps the historical benchmark aligned with its changelog release", () => {
    const changelog = readFileSync(join(repositoryRoot, "CHANGELOG.md"), "utf8");
    const report = readJson("runtime.json");
    assert.equal(report.release, "1.0.0");
    assert.match(changelog, /^## 1\.0\.0/m);
  });

  test("publishes an auditable report for every accepted variant", () => {
    const report = readJson("runtime.json");
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.release, "1.0.0");
    assert.deepEqual(
      report.modes.map(({ id }) => id),
      ["wasm-fp32", "webgpu-fp16"]
    );
    for (const mode of report.modes) {
      assert.equal(mode.status, "passed");
      assert.match(mode.model.sha256, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(mode.model.bytes) && mode.model.bytes > 0);
      assert.equal(mode.ort.version, "1.27.0");
      assert.ok(mode.environment.browser.userAgent);
      assert.ok(mode.environment.os);
      assert.ok(mode.environment.cpu);
      assert.ok(mode.environment.hardware);
      assert.ok(Array.isArray(mode.evidence));
      assert.ok(mode.evidence.length > 0);
      assert.ok(mode.environment.capabilities);
      assert.ok(Number.isFinite(mode.coldLoad.totalMs));
      assert.ok(Number.isFinite(mode.warmLoad.totalMs));
      assert.ok(Number.isFinite(mode.detection.timings.totalMs));
      assert.equal(mode.detection.parity, "passed");
      assert.ok(mode.detection.parityMetrics.iou >= mode.detection.parityThresholds.iou);
      assert.equal(mode.peakMemory.bytes, null);
      assert.ok(mode.peakMemory.reason);
    }
    assert.equal(report.releaseReady, true);
    assert.equal(report.githubActions.runId, 31614796054);
    assert.match(report.githubActions.url, /actions\/runs\/31614796054$/);
    assert.deepEqual(report.responsiveScreenshots.viewports, [390, 768, 1440, 1920]);
  });

  test("publishes seven-fixture evidence for model 1.0.1 FP32 runtimes", () => {
    const fixtureLock = JSON.parse(
      readFileSync(join(repositoryRoot, "tools/model-pipeline/fixtures/fixtures.lock.json"), "utf8")
    );
    const fixtureHashes = new Map(
      fixtureLock.fixtures.map((fixture) => [fixture.filename, fixture.sha256])
    );
    const thresholds = {
      maxBoxCoordinateDeltaPixels: 1,
      maxPolygonCoordinateDeltaPixels: 1.5,
      maxScoreDelta: 0.001
    };
    for (const name of ["wasm-fp32.json", "webgpu-fp32.json"]) {
      const report = readJson(name, "1.0.1");
      assert.equal(report.status, "passed");
      assert.equal(report.fallbacks.length, 0);
      assert.equal(report.fixtures.length, 7);
      for (const fixture of report.fixtures) {
        assert.equal(fixture.parity, "passed");
        assert.equal(fixture.fixtureSha256, fixtureHashes.get(fixture.filename));
        assert.match(fixture.acceptedOutputSha256, /^[a-f0-9]{64}$/);
        assert.match(fixture.outputSha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(fixture.parityThresholds, thresholds);
        assert.ok(
          fixture.parityMetrics.maxBoxCoordinateDeltaPixels <=
            thresholds.maxBoxCoordinateDeltaPixels
        );
        assert.ok(
          fixture.parityMetrics.maxPolygonCoordinateDeltaPixels <=
            thresholds.maxPolygonCoordinateDeltaPixels
        );
        assert.ok(fixture.parityMetrics.maxScoreDelta <= thresholds.maxScoreDelta);
      }
    }
  });

  test("documents evidence provenance and unsupported variants", () => {
    const readme = readFileSync(join(benchmarkRoot, "README.md"), "utf8");
    assert.match(readme, /真实|real/i);
    assert.match(readme, /INT8/);
    assert.match(readme, /不支持|unsupported/i);
    assert.match(readme, /runtime\.json/);
  });
});
