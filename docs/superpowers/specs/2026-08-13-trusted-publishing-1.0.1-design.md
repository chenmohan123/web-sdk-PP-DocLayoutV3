# v1.0.1 Trusted Publishing and Demo Model Delivery Design

## Goal

Release `web-sdk-pp-doclayoutv3@1.0.1` as a release-infrastructure and demo-reliability update. The release must prove npm Trusted Publishing works without npm tokens, make the npm package documentation useful, and make the public GitHub Pages demo load the official FP16 and FP32 models successfully in browsers.

## Scope

- Add a Chinese-first, bilingual-linked README to the published SDK package.
- Change the npm release workflow to GitHub Actions OIDC only. It must not read `NPM_TOKEN`, write an npm auth token, or set `NODE_AUTH_TOKEN`.
- Configure npm Trusted Publishing for repository `chenmohan123/web-sdk-PP-DocLayoutV3`, workflow `release.yml`, and GitHub environment `npm`.
- Publish version `1.0.1` through the existing `develop -> pull request -> main -> v1.0.1` flow.
- Add the Pages URL, concise description, and relevant topics to the GitHub repository About metadata.
- Fix the public demo's model loading by deploying the official release assets into the Pages artifact and using a same-origin default manifest URL.
- Preserve the existing `v1.0.0-models` release as the immutable source archive.

The SDK public API, preprocessing, postprocessing, model hashes, FP16/FP32 selection contract, custom manifests, caches, workers, and ONNX Runtime backend selection are out of scope and must not change.

## Model Delivery

GitHub Release asset downloads redirect to `release-assets.githubusercontent.com`, whose responses do not include `Access-Control-Allow-Origin`. A browser can navigate to and download these URLs, but JavaScript on GitHub Pages cannot fetch them. The manifest and both ONNX variants are affected.

During the Pages build, the workflow downloads these three immutable assets from `v1.0.0-models`:

- `manifest.json`
- `model-fp16.onnx`
- `model-fp32.onnx`

The files are placed under `apps/demo/dist/models/v1.0.0/`. The deployed manifest is rewritten only for delivery: each variant URL becomes an absolute GitHub Pages URL under `https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/models/v1.0.0/`. Model bytes and hashes remain unchanged. GitHub Pages returns `Access-Control-Allow-Origin: *`, so both the official Demo and third-party H5 consumers can fetch these assets.

The SDK's built-in default manifest URL becomes the absolute Pages manifest URL. The Demo continues to use the SDK default, so it does not gain a private configuration path that differs from normal npm consumers. Custom manifest behavior remains untouched.

The Pages workflow verifies downloaded file hashes against the manifest before uploading the artifact. A failure stops deployment rather than publishing a partially usable demo.

## npm Package README

`packages/sdk/README.md` is a package-specific landing page and is included in the tarball alongside `dist`. It is Chinese-first and links to an English section or companion document. It covers installation, `createDocLayout`, automatic/manual WebGPU and WASM selection, FP16/FP32 selection, custom manifests, cleanup, the live demo, and full repository documentation. It explicitly describes WeChat support as H5/WebView support and does not claim native Mini Program inference.

Release verification must inspect the packed tarball and fail if the README is absent.

## Trusted Publishing

The npm package settings bind the trusted publisher to:

- GitHub owner: `chenmohan123`
- Repository: `web-sdk-PP-DocLayoutV3`
- Workflow: `release.yml`
- Environment: `npm`

The workflow retains `id-token: write`, uses `npm publish --access public --provenance`, and contains no token fallback. After `1.0.1` publishes successfully, the stale GitHub environment secret named `NPM_TOKEN` is deleted. The four temporary tokens already deleted by the user require no further action.

## Repository Metadata

GitHub About uses the Pages URL and an English description suitable for repository discovery. Topics cover PP-DocLayoutV3, ONNX Runtime Web, document layout analysis, WebGPU, WASM, TypeScript, PaddleOCR, and OCR.

## Version and Release Notes

The SDK package version and runtime version constant become `1.0.1`. The changelog records the README, OIDC publishing migration, and same-origin demo model delivery. No new model release or model tag is created. A normal `v1.0.1` source release may be created from the tag; `v1.0.0-models` remains unchanged.

## Testing

Tests are added before implementation for these contracts:

- the packed npm package includes its README;
- the release workflow grants OIDC and contains no npm token reference;
- the Pages workflow stages and verifies all model assets;
- the SDK default manifest and staged variant URLs use the public Pages model path;
- the public Pages model responses allow cross-origin browser requests;
- custom manifest input still passes through unchanged;
- version metadata is consistently `1.0.1`.

Required final verification is `pnpm verify`, the release verifier against `v1.0.1`, an independently installed packed-package browser smoke test, and a real deployed Pages browser smoke test that loads a model and runs one image. The npm page must show the README and npm metadata must show `1.0.1` with provenance.

## Safety and Existing Work

The unrelated uncommitted root `package.json` changes are excluded from every commit. Remote mutations are staged: push and PR creation follow local verification; merge, tag, and public npm release happen only after explicit confirmation. Trusted Publisher configuration and About updates are limited to the named public package and repository.
