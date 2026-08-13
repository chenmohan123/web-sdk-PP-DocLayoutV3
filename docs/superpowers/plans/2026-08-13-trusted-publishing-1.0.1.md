# v1.0.1 Trusted Publishing and Demo Model Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `web-sdk-pp-doclayoutv3@1.0.1` through npm Trusted Publishing while adding npm documentation and making the built-in PP-DocLayoutV3 models fetchable by browsers from GitHub Pages.

**Architecture:** A focused Node staging script downloads the immutable `v1.0.0-models` assets, validates size and SHA-256, rewrites only their public URLs, and places them in the Pages artifact. The SDK default points to that CORS-enabled Pages manifest. Static release-contract tests enforce tokenless OIDC publishing and package contents; existing runtime and browser tests protect the SDK behavior.

**Tech Stack:** TypeScript, Node.js 24 ESM, pnpm 11, Vitest, Node test runner, Playwright, GitHub Actions, npm OIDC Trusted Publishing, GitHub Pages.

---

## File Map

- Create `scripts/stage-pages-models.mjs`: download, validate, rewrite, and stage model assets for Pages.
- Modify `scripts/verify-release.test.mjs`: add executable staging tests and release/package workflow assertions.
- Modify `scripts/verify-release.mjs`: enforce Pages delivery, package README, version, and tokenless OIDC contracts.
- Modify `.github/workflows/pages.yml`: run the staging script after building the Demo.
- Modify `.github/workflows/release.yml`: remove all npm token fallback behavior.
- Modify `packages/sdk/src/detector.ts`: change only the built-in manifest URL to the Pages model endpoint.
- Modify `packages/sdk/tests/detector.test.ts`: protect the default URL and custom manifest pass-through.
- Create `packages/sdk/README.md`: Chinese-first npm landing documentation with English content and links.
- Modify `tests/browser/package.spec.ts`: assert README inclusion and public package version.
- Modify `packages/sdk/package.json`: bump to `1.0.1`.
- Modify `packages/sdk/src/model/manifest.ts`: bump `CURRENT_SDK_VERSION` to `1.0.1`.
- Modify `packages/sdk/tests/manifest.test.ts`: assert the runtime version.
- Modify `CHANGELOG.md`: record the `1.0.1` release.

The unrelated dirty root `package.json` is never staged or modified.

### Task 1: Protect the Pages Model Delivery Contract

**Files:**
- Test: `scripts/verify-release.test.mjs`
- Modify: `scripts/verify-release.mjs`
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: Write failing static workflow assertions**

Add tests that require the Pages workflow to invoke the model staging script after the Vite build and before `actions/upload-pages-artifact`:

```js
test("stages validated browser-fetchable models in the Pages artifact", () => {
  const pages = readFileSync(resolve(repositoryRoot, ".github/workflows/pages.yml"), "utf8");

  assert.match(
    pages,
    /vite build[\s\S]*node scripts\/stage-pages-models\.mjs[\s\S]*upload-pages-artifact/
  );
});
```

Update the static verifier to require the same ordering and the exact release tag `v1.0.0-models`.

- [ ] **Step 2: Run the release contract and observe failure**

Run:

```powershell
pnpm release:test
```

Expected: FAIL because `pages.yml` does not invoke `stage-pages-models.mjs`.

- [ ] **Step 3: Add the Pages workflow staging step**

After the Vite build, add:

```yaml
      - name: Stage validated model assets for browser delivery
        run: node scripts/stage-pages-models.mjs
```

Keep the existing Pages permissions and upload path unchanged.

- [ ] **Step 4: Run the focused contract again**

Run `pnpm release:test`.

Expected: the new workflow assertion passes; the suite may still fail until the staging script exists in Task 2.

- [ ] **Step 5: Commit the workflow contract**

```powershell
git add -- scripts/verify-release.test.mjs scripts/verify-release.mjs .github/workflows/pages.yml
git commit -m "test: require Pages model staging"
```

### Task 2: Build and Test the Model Staging Script

**Files:**
- Create: `scripts/stage-pages-models.mjs`
- Test: `scripts/verify-release.test.mjs`

- [ ] **Step 1: Write a failing end-to-end unit test with injected fetch**

Import `stagePagesModels`, create a temporary output directory, and provide a fake manifest with two tiny byte arrays. The fake fetch returns the manifest and assets. Assert that:

```js
assert.equal(staged.variants[0].url, `${publicRoot}/model-fp16.onnx`);
assert.equal(staged.variants[1].url, `${publicRoot}/model-fp32.onnx`);
assert.deepEqual(readFileSync(resolve(outputRoot, "model-fp16.onnx")), fp16Bytes);
assert.deepEqual(readFileSync(resolve(outputRoot, "model-fp32.onnx")), fp32Bytes);
```

Add a second test whose fake asset bytes do not match the declared hash and assert rejection with `SHA-256 mismatch`.

- [ ] **Step 2: Run the test and observe the missing module failure**

Run `pnpm release:test`.

Expected: FAIL because `scripts/stage-pages-models.mjs` does not exist or does not export `stagePagesModels`.

- [ ] **Step 3: Implement the minimal staging API**

Create an ESM module with these constants and interface:

```js
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL_RELEASE_ROOT =
  "https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/releases/download/v1.0.0-models";
export const MODEL_PUBLIC_ROOT =
  "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.0";

async function requireOk(response, url) {
  if (!response.ok) throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  return response;
}

export async function stagePagesModels({
  fetchImpl = fetch,
  outputRoot,
  publicRoot = MODEL_PUBLIC_ROOT,
  releaseRoot = MODEL_RELEASE_ROOT
}) {
  const manifestUrl = `${releaseRoot}/manifest.json`;
  const manifestResponse = await requireOk(await fetchImpl(manifestUrl), manifestUrl);
  const manifest = await manifestResponse.json();
  const ids = manifest.variants.map(({ id }) => id).sort();
  if (JSON.stringify(ids) !== JSON.stringify(["fp16", "fp32"])) {
    throw new Error("Model release must contain exactly fp16 and fp32 variants");
  }
  await mkdir(outputRoot, { recursive: true });
  const variants = [];
  for (const variant of manifest.variants) {
    const assetUrl = `${releaseRoot}/${variant.filename}`;
    const response = await requireOk(await fetchImpl(assetUrl), assetUrl);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength !== variant.bytes) {
      throw new Error(`${variant.filename} byte length mismatch`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== variant.sha256) {
      throw new Error(`${variant.filename} SHA-256 mismatch`);
    }
    await writeFile(resolve(outputRoot, variant.filename), bytes);
    variants.push({ ...variant, url: `${publicRoot}/${variant.filename}` });
  }
  const staged = { ...manifest, variants };
  await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(staged, null, 2)}\n`);
  return staged;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stagePagesModels({
    outputRoot: resolve(repositoryRoot, "apps/demo/dist/models/v1.0.0")
  });
}
```

Keep URL roots configurable for the unit tests, but do not add command-line options or environment variables.

- [ ] **Step 4: Run the staging tests**

Run `pnpm release:test`.

Expected: PASS, including rejection of corrupted asset bytes.

- [ ] **Step 5: Format and commit**

Run `pnpm exec prettier --write scripts/stage-pages-models.mjs scripts/verify-release.test.mjs scripts/verify-release.mjs .github/workflows/pages.yml`, then `pnpm release:test`.

```powershell
git add -- scripts/stage-pages-models.mjs scripts/verify-release.test.mjs scripts/verify-release.mjs .github/workflows/pages.yml
git commit -m "feat: stage models for GitHub Pages"
```

### Task 3: Make the SDK Default Model Browser-Fetchable

**Files:**
- Modify: `packages/sdk/tests/detector.test.ts`
- Modify: `packages/sdk/src/detector.ts`

- [ ] **Step 1: Write failing default and custom manifest tests**

Add or update the detector test to assert:

```ts
expect(DEFAULT_MANIFEST_URL).toBe(
  "https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.0/manifest.json"
);
```

In the dependency-injected detector test, capture the URL passed to `fetchManifest`. Call once without `model` and once with `model: "https://models.example/custom.json"`; assert the default URL is used only in the first call and the custom URL is unchanged in the second.

- [ ] **Step 2: Run the SDK test and observe failure**

Run:

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 test -- detector.test.ts
```

Expected: FAIL because the default still points at the GitHub Release.

- [ ] **Step 3: Change the single default URL constant**

Set `DEFAULT_MANIFEST_URL` to:

```ts
"https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.0/manifest.json";
```

Do not change `resolveModel`, the custom manifest types, caching, or download logic.

- [ ] **Step 4: Run SDK tests and type checking**

Run:

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 test
pnpm --filter web-sdk-pp-doclayoutv3 typecheck
```

Expected: all SDK tests and type checking pass.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/sdk/src/detector.ts packages/sdk/tests/detector.test.ts
git commit -m "fix: serve default models from Pages"
```

### Task 4: Enforce Tokenless npm Trusted Publishing

**Files:**
- Test: `scripts/verify-release.test.mjs`
- Modify: `scripts/verify-release.mjs`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Replace the token-fallback test contract**

Add a test that asserts:

```js
assert.match(release, /environment:\s*npm/);
assert.match(release, /id-token:\s+write/);
assert.match(release, /npm publish --access public --provenance/);
assert.doesNotMatch(release, /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/);
```

Change `verify-release.mjs` to fail if any of those token identifiers occur and to require the OIDC/environment fields.

- [ ] **Step 2: Run the contract and observe failure**

Run `pnpm release:test`.

Expected: FAIL because `release.yml` contains `NPM_TOKEN`, `NODE_AUTH_TOKEN`, and `_authToken`.

- [ ] **Step 3: Remove the fallback and token environment**

Delete the entire `Use NPM_TOKEN when Trusted Publishing is not configured` step. Keep the publish step as:

```yaml
      - name: Publish with npm provenance
        working-directory: packages/sdk
        run: npm publish --access public --provenance
```

- [ ] **Step 4: Run release tests**

Run `pnpm release:test`.

Expected: PASS with no npm token reference in the workflow.

- [ ] **Step 5: Commit**

```powershell
git add -- scripts/verify-release.test.mjs scripts/verify-release.mjs .github/workflows/release.yml
git commit -m "ci: use npm trusted publishing only"
```

### Task 5: Add the Published npm README

**Files:**
- Create: `packages/sdk/README.md`
- Test: `tests/browser/package.spec.ts`
- Modify: `scripts/verify-release.mjs`

- [ ] **Step 1: Write failing tarball and static checks**

Extend the packed-package test:

```ts
expect(entries).toContain("package/README.md");
const readme = readFileSync(join(installedSdkRoot, "README.md"), "utf8");
expect(readme).toContain("# web-sdk-pp-doclayoutv3");
expect(readme).toContain("## English");
expect(readme).toContain("createDocLayout");
```

Make `verify-release.mjs` read `packages/sdk/README.md` and require the package name, installation command, API name, WebGPU, WASM, FP16, FP32, custom manifest, and WeChat H5/WebView limitation.

- [ ] **Step 2: Run the packed-package test and observe failure**

Run:

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 build
pnpm exec playwright test tests/browser/package.spec.ts
```

Expected: FAIL because the package tarball has no README.

- [ ] **Step 3: Write the Chinese-first package README**

Create `packages/sdk/README.md` with:

```md
# web-sdk-pp-doclayoutv3

[English](#english) | [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/)

基于 ONNX Runtime Web 的浏览器端 PP-DocLayoutV3 版面分析 SDK。

## 安装

```bash
pnpm add web-sdk-pp-doclayoutv3
```

## 快速开始

```ts
import { createDocLayout } from "web-sdk-pp-doclayoutv3";

const detector = await createDocLayout({ backend: "auto", precision: "auto" });
const result = await detector.detect(file);
await detector.dispose();
```
```

The remaining Chinese headings are exactly `运行后端与精度`, `自定义模型`, `资源管理`, `微信环境`, and `完整文档`. The English half starts at `## English` and contains `Installation`, `Quick start`, `Backend and precision`, `Custom models`, `Resource management`, `WeChat environments`, and `Documentation`. Both halves state that `backend: "auto"` prefers WebGPU and falls back to WASM, `precision: "auto"` prefers FP16 on compatible WebGPU and otherwise uses FP32, a custom manifest is passed through `model`, progress arrives through `onProgress`, structured failures are `DocLayoutError`, and detectors must be disposed. Both halves link to the live Demo, root Chinese README, and `README.en.md`.

- [ ] **Step 4: Run documentation and package tests**

Run:

```powershell
pnpm release:test
pnpm --filter web-sdk-pp-doclayoutv3 build
pnpm exec playwright test tests/browser/package.spec.ts
```

Expected: PASS and tarball contains `package/README.md`.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/sdk/README.md tests/browser/package.spec.ts scripts/verify-release.mjs
git commit -m "docs: add npm package README"
```

### Task 6: Bump and Document v1.0.1

**Files:**
- Modify: `packages/sdk/package.json`
- Modify: `packages/sdk/src/model/manifest.ts`
- Modify: `packages/sdk/tests/manifest.test.ts`
- Modify: `CHANGELOG.md`
- Modify: `scripts/verify-release.test.mjs`

- [ ] **Step 1: Write failing version consistency assertions**

Assert in `manifest.test.ts`:

```ts
expect(CURRENT_SDK_VERSION).toBe("1.0.1");
```

Add a release-contract assertion that `packages/sdk/package.json` has `version === "1.0.1"` and the changelog contains `## 1.0.1`.

- [ ] **Step 2: Run focused tests and observe failure**

Run:

```powershell
pnpm --filter web-sdk-pp-doclayoutv3 test -- manifest.test.ts
pnpm release:test
```

Expected: FAIL because package and runtime versions are `1.0.0` and the changelog lacks `1.0.1`.

- [ ] **Step 3: Apply the version bump**

Set the package version and `CURRENT_SDK_VERSION` to `1.0.1`. Add:

```md
## 1.0.1

- Added Chinese-first bilingual npm package documentation.
- Migrated npm releases to GitHub Actions Trusted Publishing with provenance and no npm token.
- Served validated FP16 and FP32 model assets from GitHub Pages so browsers can load the built-in model without CORS failures.
```

Do not change the model manifest's `model.version` or `minSdkVersion`; those describe the unchanged model release.

- [ ] **Step 4: Run focused tests**

Run the two commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- packages/sdk/package.json packages/sdk/src/model/manifest.ts packages/sdk/tests/manifest.test.ts CHANGELOG.md scripts/verify-release.test.mjs
git commit -m "chore: prepare 1.0.1 release"
```

### Task 7: Run Local Release Verification

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Confirm the dirty root file remains excluded**

Run `git status --short` and verify the only unrelated entry is root `package.json`. Use explicit paths for every later `git add`; never use `git add .`.

- [ ] **Step 2: Run formatting and the complete workspace gate**

Run:

```powershell
pnpm exec prettier --write .github/workflows/pages.yml .github/workflows/release.yml scripts/stage-pages-models.mjs scripts/verify-release.mjs scripts/verify-release.test.mjs packages/sdk/README.md packages/sdk/src/detector.ts packages/sdk/tests/detector.test.ts packages/sdk/src/model/manifest.ts packages/sdk/tests/manifest.test.ts tests/browser/package.spec.ts CHANGELOG.md
pnpm verify
```

Expected: formatting, documentation parity, release contracts, benchmark contracts, lint, type checking, unit tests, Demo tests, and builds all pass.

- [ ] **Step 3: Run release and packed-package gates**

Run:

```powershell
node scripts/verify-release.mjs --release v1.0.1
pnpm exec playwright test tests/browser/package.spec.ts
```

Expected: both pass; release verifier reports four workflows and two model variants.

- [ ] **Step 4: Perform a real staging dry run**

Run `node scripts/stage-pages-models.mjs` against `apps/demo/dist`, then verify all three files exist, model sizes match the manifest, and the staged manifest URLs point at GitHub Pages. Remove generated model assets from the worktree only if they are untracked build output under `apps/demo/dist/models/v1.0.0`.

- [ ] **Step 5: Review the complete diff and commit formatting-only changes if any**

Run `git diff --check`, `git status --short`, and `git diff --stat`. Commit only task files with `git add -- <explicit paths>`.

### Task 8: Configure Trusted Publisher and Repository About

**External state:**
- npm package `web-sdk-pp-doclayoutv3`
- GitHub repository `chenmohan123/web-sdk-PP-DocLayoutV3`

- [ ] **Step 1: Configure npm Trusted Publishing in the authenticated browser**

Create exactly one GitHub Actions trusted publisher using:

```text
Owner: chenmohan123
Repository: web-sdk-PP-DocLayoutV3
Workflow filename: release.yml
Environment: npm
```

Read the saved settings back from the page before proceeding. Do not create or expose any npm access token.

- [ ] **Step 2: Update GitHub About metadata**

Set:

```text
Description: PP-DocLayoutV3 browser SDK powered by ONNX Runtime Web, with WebGPU/WASM, FP16/FP32, workers, caching, and custom model manifests.
Website: https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/
Topics: pp-doclayoutv3, onnx-runtime-web, document-layout-analysis, webgpu, wasm, typescript, paddleocr, ocr
```

Read the repository page back and verify the saved description, website, and topics.

- [ ] **Step 3: Request authorization for remote Git operations**

Present local verification results and the exact commits. Ask for confirmation before pushing `develop` and creating the PR if no current authorization covers those mutations.

### Task 9: Push, Review, and Merge

**External state:** GitHub `develop`, pull request, CI.

- [ ] **Step 1: Push develop using the explicit GitHub URL**

Because `origin` is a local repository, use:

```powershell
git push https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3.git develop:develop
```

- [ ] **Step 2: Create a PR from develop to main**

Title: `Release v1.0.1 with Trusted Publishing and browser-safe model delivery`.

The body must summarize npm README, tokenless OIDC, Pages model staging/CORS fix, test evidence, and explicitly state that SDK APIs and model bytes are unchanged.

- [ ] **Step 3: Wait for all CI and review checks**

Require CI, packed-package browser smoke, Pages-related contract tests, and hardware jobs required by branch protection to succeed. Diagnose failures before changing code.

- [ ] **Step 4: Request explicit merge authorization**

Report PR URL and checks. Do not merge until the user confirms.

- [ ] **Step 5: Merge and verify main**

Merge through GitHub, wait for the main CI and Pages deployment, and verify the deployed manifest plus both model responses return HTTP 200 and `Access-Control-Allow-Origin: *`.

### Task 10: Tag, Publish, and Verify v1.0.1

**External state:** Git tag, GitHub Actions, npm registry, GitHub environment secret.

- [ ] **Step 1: Real browser smoke test before publishing**

At `https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/`, load one image, run automatic detection, and verify a selected FP16/WebGPU or FP32/WASM model produces detections without a manifest/model download error. Record backend, precision, model size, and timing shown by the Demo.

- [ ] **Step 2: Request explicit tag and public release authorization**

Report the main commit, Pages run, real-model smoke result, Trusted Publisher configuration, and the exact `v1.0.1` tag to be created. Do not push the tag until confirmed.

- [ ] **Step 3: Create and push the source tag**

Tag the verified main merge commit as `v1.0.1` and push it to the explicit GitHub URL. Do not modify `v1.0.0-models`.

- [ ] **Step 4: Monitor the npm release workflow**

The workflow must publish without `NPM_TOKEN`, complete provenance, and report registry integrity. A Trusted Publishing authentication failure stops the release investigation; do not create a token fallback.

- [ ] **Step 5: Independently verify the public package**

Run:

```powershell
npm view web-sdk-pp-doclayoutv3@1.0.1 version dist.integrity dist.shasum repository --json
npm pack web-sdk-pp-doclayoutv3@1.0.1
```

Install the registry tarball in a clean temporary project and verify `createDocLayout` and `CURRENT_SDK_VERSION === "1.0.1"`. Open the npm package page and confirm the README renders.

- [ ] **Step 6: Delete the stale GitHub environment secret**

After the OIDC publication succeeds, delete only the `NPM_TOKEN` secret from the GitHub `npm` environment. Read the environment settings back to verify no secret remains. The four npm website tokens were already removed by the user and are not touched.

- [ ] **Step 7: Publish the final evidence**

Report the npm version, integrity, shasum, provenance, workflow and Pages URLs, PR and merge commit, tag, npm README status, About metadata, real-model backend/precision result, and confirmation that no npm token is used or stored.
