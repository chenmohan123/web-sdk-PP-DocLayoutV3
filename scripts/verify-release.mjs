import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowRoot = join(repositoryRoot, ".github/workflows");
const requiredWorkflows = ["ci.yml", "pages.yml", "model-validation.yml", "release.yml"];
const packageManager = "11.16.0";
const nodeVersion = readFileSync(join(repositoryRoot, ".nvmrc"), "utf8").trim();

function fail(message) {
  throw new Error(`Release contract violation: ${message}`);
}

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) fail(message);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)])
    );
  }
  return value;
}

function withoutVolatileEvidenceFields(value) {
  if (Array.isArray(value)) return value.map(withoutVolatileEvidenceFields);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "generatedAt")
        .map(([key, entry]) => [key, withoutVolatileEvidenceFields(entry)])
    );
  }
  return value;
}

function read(relativePath) {
  try {
    return readFileSync(join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    fail(`missing ${relativePath}: ${error.message}`);
  }
}

function verifyActions(name, source) {
  const actionReferences = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)].map(
    (match) => match[1]
  );
  if (actionReferences.length === 0) fail(`${name} does not use any pinned actions`);
  for (const action of actionReferences) {
    if (!/@v\d+$/.test(action)) fail(`${name} action ${action} must pin a major version`);
  }
}

function verifyStaticContract() {
  const packageMetadata = JSON.parse(read("packages/sdk/package.json"));
  const packageReadme = read("packages/sdk/README.md");
  for (const required of [
    "web-sdk-pp-doclayoutv3",
    "pnpm add web-sdk-pp-doclayoutv3",
    "createDocLayout",
    "WebGPU",
    "WASM",
    "FP16",
    "FP32",
    "Custom manifest",
    "H5/WebView",
    "native Mini Program"
  ]) {
    if (!packageReadme.includes(required)) fail(`package README must include ${required}`);
  }
  const expectedRepositoryUrl = "git+https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3.git";
  if (
    packageMetadata.repository?.type !== "git" ||
    packageMetadata.repository?.url !== expectedRepositoryUrl
  ) {
    fail(`packages/sdk/package.json repository.url must be ${expectedRepositoryUrl}`);
  }

  const workflows = Object.fromEntries(
    requiredWorkflows.map((name) => [name, read(`.github/workflows/${name}`)])
  );
  for (const [name, source] of Object.entries(workflows)) {
    verifyActions(name, source);
    requireMatch(
      source,
      /^permissions:\s*\n\s+contents:\s+read\s*$/m,
      `${name} needs read-only default permissions`
    );
    if (/permissions:\s+(?:write-all|read-all)/.test(source))
      fail(`${name} grants broad permissions`);
    requireMatch(source, /node-version-file:\s*["']?\.nvmrc["']?/, `${name} must use .nvmrc`);
    requireMatch(
      source,
      new RegExp(`version:\\s*["']?${packageManager.replaceAll(".", "\\.")}["']?`),
      `${name} must use pnpm ${packageManager}`
    );
  }
  if (nodeVersion !== "24") fail(`expected Node 24 in .nvmrc, received ${nodeVersion}`);

  const ci = workflows["ci.yml"];
  requireMatch(ci, /push:\s*\n\s+branches:\s*\[main\]/, "CI must run on main pushes");
  requireMatch(
    ci,
    /pull_request:\s*\n\s+branches:\s*\[main\]/,
    "CI must run on pull requests targeting main"
  );
  requireMatch(ci, /pnpm run verify/, "CI must run the workspace verify script");
  requireMatch(
    ci,
    /tests\/browser\/package\.spec\.ts/,
    "CI must run the packed-package browser smoke test"
  );
  requireMatch(
    ci,
    /runs-on:\s*\[self-hosted, windows, x64, webgpu-hardware\]/,
    "WebGPU CI must use a hardware-tagged runner"
  );
  if (/swiftshader/i.test(ci)) fail("WebGPU CI must not use a software adapter");

  const pages = workflows["pages.yml"];
  requireMatch(pages, /branches:\s*\[main\]/, "Pages must deploy only from main");
  requireMatch(
    pages,
    /if:\s*github\.ref == ['"]refs\/heads\/main['"]/,
    "manual Pages runs must also be restricted to main"
  );
  requireMatch(
    pages,
    /pnpm --filter web-sdk-pp-doclayoutv3 build[\s\S]*pnpm --filter demo exec vite build/,
    "Pages must build the SDK before the Demo"
  );
  requireMatch(
    pages,
    /pnpm --filter demo exec vite build --base \/web-sdk-PP-DocLayoutV3\//,
    "Pages must build with the repository base path"
  );
  requireMatch(
    pages,
    /vite build[\s\S]*node scripts\/stage-pages-models\.mjs[\s\S]*upload-pages-artifact/,
    "Pages must stage model assets after the Demo build and before upload"
  );
  requireMatch(
    read("scripts/stage-pages-models.mjs"),
    /releases\/download\/v1\.0\.2-models/,
    "Pages model staging must use the immutable v1.0.2-models manifest release"
  );
  requireMatch(
    read("scripts/stage-pages-models.mjs"),
    /releases\/download\/v1\.0\.1-models/,
    "Pages model staging must retain the immutable v1.0.1-models binary release"
  );
  requireMatch(
    read("scripts/stage-pages-models.mjs"),
    /releases\/download\/v1\.0\.0-models/,
    "Pages model staging must retain the immutable v1.0.0-models release"
  );
  requireMatch(pages, /pages:\s+write/, "Pages deploy job needs pages: write");
  requireMatch(pages, /pages:\s+read/, "Pages build job needs pages: read");
  requireMatch(pages, /id-token:\s+write/, "Pages deploy job needs id-token: write");

  const model = workflows["model-validation.yml"];
  requireMatch(model, /workflow_dispatch:/, "model validation must be manual");
  requireMatch(
    model,
    /verify-release\.mjs --models/,
    "model workflow must verify reports and hashes"
  );
  requireMatch(
    model,
    /upload_assets.*type:\s+boolean/s,
    "model uploads must require an explicit boolean input"
  );
  requireMatch(
    model,
    /upload-model-assets:\s*\n\s*if:\s*github\.ref == ['"]refs\/heads\/main['"] && inputs\.upload_assets/,
    "model uploads must run only from main"
  );
  requireMatch(
    model,
    /gh release create "\$\{RELEASE_TAG\}"[\s\S]*--target "\$\{GITHUB_SHA\}"/,
    "model release tags must target the verified commit"
  );
  requireMatch(
    model,
    /git fetch --force origin "refs\/tags\/\$\{RELEASE_TAG\}:refs\/tags\/\$\{RELEASE_TAG\}"[\s\S]*git rev-list -n 1 "\$\{RELEASE_TAG\}"[\s\S]*\[\[ "\$\{tag_sha\}" != "\$\{GITHUB_SHA\}" \]\]/,
    "existing model release tags must match the verified commit"
  );
  requireMatch(model, /contents:\s+write/, "model upload job needs contents: write");
  requireMatch(
    model,
    /UPLOAD_ASSETS[\s\S]*GITHUB_REF[\s\S]*refs\/heads\/main/,
    "model uploads must be restricted to main"
  );
  requireMatch(
    model,
    /git ls-remote --exit-code --tags origin "refs\/tags\/\$\{RELEASE_TAG\}"/,
    "model uploads must reject an existing Git tag"
  );
  requireMatch(
    model,
    /--target "\$\{GITHUB_SHA\}"/,
    "model releases must target the validated commit SHA"
  );
  if (/--target main/.test(model)) fail("model releases must not target a moving branch name");

  const release = workflows["release.yml"];
  requireMatch(release, /tags:\s*\n\s+-\s+["']v\*["']/, "npm release must use v* tags");
  requireMatch(
    release,
    /merge-base --is-ancestor.*origin\/main/,
    "release tags must point to main history"
  );
  requireMatch(
    release,
    /verify-release\.mjs --release/,
    "release must compare tag and package version"
  );
  requireMatch(
    release,
    /npm publish --access public --provenance/,
    "npm publish must enable provenance"
  );
  requireMatch(release, /environment:\s*npm/, "Trusted Publishing must use the npm environment");
  requireMatch(release, /id-token:\s+write/, "Trusted Publishing needs id-token: write");
  if (/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/.test(release)) {
    fail("Trusted Publishing must not use npm token fallbacks");
  }
  if (/develop/.test(release) || /branches:\s*\n\s+-\s+develop/.test(release)) {
    fail("npm publishing must never run from develop");
  }

  const manifest = JSON.parse(read("models/pp-doclayoutv3/1.0.2/manifest.json"));
  if (manifest.variants.length !== 2) fail("manifest must contain exactly FP16 and FP32 variants");
  for (const variant of manifest.variants) {
    if (!/^[a-f0-9]{64}$/.test(variant.sha256)) fail(`${variant.id} has an invalid SHA-256`);
    if (!Number.isSafeInteger(variant.bytes) || variant.bytes <= 0)
      fail(`${variant.id} has invalid bytes`);
  }

  for (const path of [
    ".github/actionlint.yaml",
    ".github/dependabot.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/pull_request_template.md"
  ]) {
    read(path);
  }

  return manifest;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const fp32BrowserParityThresholds = {
  maxBoxCoordinateDeltaPixels: 1,
  maxPolygonCoordinateDeltaPixels: 1.5,
  maxScoreDelta: 0.001
};

function verifyFp32BrowserEvidence({
  acceptedFp32Sha256,
  benchmark,
  evidence,
  fixtures,
  manifestVariant,
  provider
}) {
  const displayName = provider === "wasm" ? "FP32 WASM" : "FP32 WebGPU";
  if (evidence?.schemaVersion !== 1) fail(`${displayName} browser evidence schema is invalid`);
  if (evidence.status !== "passed") fail(`${displayName} browser evidence did not pass`);
  if (evidence.executionProvider !== provider) {
    fail(`${displayName} browser evidence execution provider is invalid`);
  }
  if (evidence.precision !== "fp32") fail(`${displayName} browser evidence precision is invalid`);
  if (!Array.isArray(evidence.fallbacks) || evidence.fallbacks.length !== 0) {
    fail(`${displayName} browser evidence contains fallback`);
  }
  if (evidence.modelBytes !== manifestVariant?.bytes) {
    fail(`${displayName} browser evidence byte size does not match the manifest`);
  }
  if (evidence.modelSha256 !== manifestVariant?.sha256) {
    fail(`${displayName} browser evidence does not match the manifest`);
  }

  const expectedFilenames = fixtures.map(({ filename }) => filename);
  if (!Array.isArray(evidence.fixtures)) {
    fail(`${displayName} browser evidence fixture set is incomplete`);
  }
  const actualFilenames = evidence.fixtures.map(({ filename }) => filename);
  if (JSON.stringify(actualFilenames) !== JSON.stringify(expectedFilenames)) {
    fail(`${displayName} browser evidence fixture set is incomplete`);
  }
  if (evidence.fixtures.some((fixture) => fixture.parity !== "passed")) {
    fail(`${displayName} browser evidence fixture parity failed`);
  }
  if (
    JSON.stringify(canonicalJson(withoutVolatileEvidenceFields(evidence))) !==
    JSON.stringify(canonicalJson(withoutVolatileEvidenceFields(benchmark)))
  ) {
    fail(`${displayName} browser evidence differs from the benchmark artifact`);
  }
  if (evidence.acceptedModelSha256 !== acceptedFp32Sha256) {
    fail(`${displayName} browser evidence accepted model SHA-256 is invalid`);
  }

  for (const [index, fixture] of evidence.fixtures.entries()) {
    const lockedFixture = fixtures[index];
    if (fixture.fixtureSha256 !== lockedFixture.sha256) {
      fail(`${displayName} browser evidence fixture SHA-256 is invalid`);
    }
    if (!/^[a-f0-9]{64}$/.test(fixture.acceptedOutputSha256 ?? "")) {
      fail(`${displayName} browser evidence accepted output SHA-256 is invalid`);
    }
    if (!/^[a-f0-9]{64}$/.test(fixture.outputSha256 ?? "")) {
      fail(`${displayName} browser evidence output SHA-256 is invalid`);
    }
    if (
      fixture.detectionCount !== fixture.expectedDetectionCount ||
      fixture.labelSequenceEqual !== true ||
      fixture.readingOrderEqual !== true
    ) {
      fail(`${displayName} browser evidence structural parity failed`);
    }
    if (JSON.stringify(fixture.parityThresholds) !== JSON.stringify(fp32BrowserParityThresholds)) {
      fail(`${displayName} browser evidence parity thresholds are invalid`);
    }
    const metrics = fixture.parityMetrics;
    if (
      !Number.isFinite(metrics?.maxBoxCoordinateDeltaPixels) ||
      !Number.isFinite(metrics?.maxPolygonCoordinateDeltaPixels) ||
      !Number.isFinite(metrics?.maxScoreDelta) ||
      metrics.maxBoxCoordinateDeltaPixels >
        fp32BrowserParityThresholds.maxBoxCoordinateDeltaPixels ||
      metrics.maxPolygonCoordinateDeltaPixels >
        fp32BrowserParityThresholds.maxPolygonCoordinateDeltaPixels ||
      metrics.maxScoreDelta > fp32BrowserParityThresholds.maxScoreDelta
    ) {
      fail(`${displayName} browser evidence numeric parity failed`);
    }
  }
}

async function verifyModels(modelVersion) {
  const manifestRoot = `models/pp-doclayoutv3/${modelVersion}`;
  const artifactRoot = modelVersion === "1.0.2" ? "models/pp-doclayoutv3/1.0.1" : manifestRoot;
  const reportRoot =
    modelVersion === "1.0.0"
      ? "tools/model-pipeline/reports"
      : `tools/model-pipeline/reports/${modelVersion}`;
  const manifest = JSON.parse(read(`${manifestRoot}/manifest.json`));
  const manifestVariants = Object.fromEntries(
    manifest.variants.map((variant) => [variant.id, variant])
  );
  for (const variant of manifest.variants) {
    const path = join(repositoryRoot, artifactRoot, variant.filename);
    const size = statSync(path).size;
    if (size < 1024) fail(`${variant.filename} is probably an unresolved Git LFS pointer`);
    if (size !== variant.bytes)
      fail(`${variant.filename} size ${size} does not match ${variant.bytes}`);
    const digest = await sha256(path);
    if (digest !== variant.sha256) fail(`${variant.filename} SHA-256 does not match the manifest`);
  }

  const fp32 = JSON.parse(read(`${reportRoot}/fp32-validation.json`));
  const variants = JSON.parse(read(`${reportRoot}/variant-validation.json`));
  const browser = JSON.parse(read(`${reportRoot}/browser-evidence.json`));
  if (fp32.overallPass !== true) fail("FP32 validation report did not pass");
  if (variants.variants?.fp16?.pass !== true) fail("FP16 validation report did not pass");
  if (browser.fp16Webgpu?.status !== "passed") fail("FP16 hardware WebGPU evidence is missing");
  const requiresFp16Wasm = modelVersion === "1.0.2";
  if (requiresFp16Wasm && browser.fp16Wasm?.status !== "passed")
    fail("FP16 browser WASM evidence is missing");
  if (fp32.sourceHashes?.onnx !== manifestVariants.fp32?.sha256)
    fail("FP32 validation report does not match the manifest SHA-256");
  if (variants.source?.fp32Sha256 !== manifestVariants.fp32?.sha256)
    fail("variant validation report does not match the FP32 manifest SHA-256");
  if (variants.variants?.fp16?.browser?.webgpu?.modelSha256 !== manifestVariants.fp16?.sha256)
    fail("variant validation report does not match the FP16 manifest SHA-256");
  if (browser.fp16Webgpu?.modelSha256 !== manifestVariants.fp16?.sha256)
    fail("browser evidence does not match the FP16 manifest SHA-256");
  if (requiresFp16Wasm) {
    if (browser.fp16Wasm?.modelSha256 !== manifestVariants.fp16?.sha256)
      fail("WASM browser evidence does not match the FP16 manifest SHA-256");
    if (variants.variants?.fp16?.browser?.wasm?.modelSha256 !== manifestVariants.fp16?.sha256)
      fail("variant validation report does not match the FP16 WASM evidence");
  }

  if (["1.0.1", "1.0.2"].includes(modelVersion)) {
    const fixtureLock = JSON.parse(read("tools/model-pipeline/fixtures/fixtures.lock.json"));
    const acceptedManifest = JSON.parse(read("models/pp-doclayoutv3/1.0.0/manifest.json"));
    const acceptedFp32 = acceptedManifest.variants.find(({ id }) => id === "fp32");
    verifyFp32BrowserEvidence({
      acceptedFp32Sha256: acceptedFp32?.sha256,
      benchmark: JSON.parse(read("benchmarks/1.0.1/wasm-fp32.json")),
      evidence: browser.fp32Wasm,
      fixtures: fixtureLock.fixtures,
      manifestVariant: manifestVariants.fp32,
      provider: "wasm"
    });
    verifyFp32BrowserEvidence({
      acceptedFp32Sha256: acceptedFp32?.sha256,
      benchmark: JSON.parse(read("benchmarks/1.0.1/webgpu-fp32.json")),
      evidence: browser.fp32Webgpu,
      fixtures: fixtureLock.fixtures,
      manifestVariant: manifestVariants.fp32,
      provider: "webgpu"
    });
    if (manifestVariants.fp32?.backendCompatibility.join(",") !== "wasm,webgpu") {
      fail("FP32 manifest compatibility must be wasm,webgpu");
    }
  }
  return manifest;
}

function runPnpm(args) {
  if (process.platform === "win32") {
    execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
      cwd: repositoryRoot,
      stdio: "inherit"
    });
    return;
  }
  execFileSync("pnpm", args, { cwd: repositoryRoot, stdio: "inherit" });
}

function verifyTag(tag) {
  const packageMetadata = JSON.parse(read("packages/sdk/package.json"));
  const expectedTag = `v${packageMetadata.version}`;
  if (tag !== expectedTag)
    fail(`tag ${tag} does not match package version ${packageMetadata.version}`);
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) fail(`tag ${tag} is not semver`);
}

const [mode, value, ...extraArguments] = process.argv.slice(2);
if (extraArguments.length > 0 || ![undefined, "--static", "--models", "--release"].includes(mode)) {
  fail("usage: verify-release.mjs [--static | --models X.Y.Z | --release vX.Y.Z]");
}
if (mode === "--release" && value === undefined) fail("--release requires a tag");
if (mode === "--models" && value === undefined) fail("--models requires a version");
if (mode === "--models" && !/^\d+\.\d+\.\d+$/.test(value))
  fail(`model version ${value} is not semver`);
if (!["--models", "--release"].includes(mode) && value !== undefined)
  fail(`${mode} does not accept a value`);

const staticManifest = verifyStaticContract();
const modelVersion = mode === "--models" ? value : "1.0.2";
const manifest = mode === "--static" ? staticManifest : await verifyModels(modelVersion);
if (mode === "--release") verifyTag(value);
if (mode === undefined || mode === "--release") {
  runPnpm(["run", "verify"]);
  runPnpm(["exec", "playwright", "test", "tests/browser/package.spec.ts"]);
}

console.log(
  `Release contract verified: ${requiredWorkflows.length} workflows, ${manifest.variants.length} model variants, model ${modelVersion}.`
);
