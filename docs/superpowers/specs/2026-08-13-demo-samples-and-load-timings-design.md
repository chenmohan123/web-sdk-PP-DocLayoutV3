# Demo Samples And Load Timings Design

## Goal

Improve the public Demo so users can try verified PaddleOCR document samples and distinguish model acquisition time from ONNX Runtime Session creation time.

## Decisions

- Sample cards select and preview an image only. Detection still requires an explicit click on `开始检测` / `Run detection`, so selecting a sample cannot unexpectedly download a large model.
- Four local sample assets will be vendored under `apps/demo/public/samples/`: the official `layout_demo.jpg`, `doc_with_formula.png`, `table.png`, and `image-layout.jpg` fixtures already tracked by the model-pipeline fixture lock.
- Each sample will retain the upstream source URL, coverage labels, and SHA-256 in a small Demo metadata module. The UI will show the source attribution link.
- The SDK load contract remains backward compatible and additive. Existing `modelMs` and `totalMs` remain unchanged. New fields expose `modelDownloadMs`, `modelCacheMs`, `integrityMs`, and `modelSource` (`network`, `cache`, `memory`, or `custom`).
- Network download time measures the model byte acquisition only; cache time measures a cache read; integrity time measures SHA-256 verification. Session creation remains separately measured.
- A cache hit is presented as cache read time, not as a misleading zero-byte download.

## Data Flow

The Demo sample card creates a `File` from a local static asset, then reuses the existing image selection path. SDK initialization records the detailed load timings and exposes them on the detector. Detection behavior and result timing fields are unchanged.

## Error Handling

Sample fetch failures use the existing Demo error banner and do not start detection. Invalid or unavailable samples leave the previous selection intact. SDK timing instrumentation must not alter existing download, integrity, fallback, or disposal errors.

## Testing

- SDK unit tests verify network and cache timing/source fields while preserving legacy fields.
- Demo tests verify sample cards are present, selecting a card previews the image without entering loading/running state, and the detailed timing labels render.
- Existing package, browser, and workspace verification commands remain required.

## Attribution

The vendored images originate from the PaddleOCR/PaddleX official fixtures recorded in `tools/model-pipeline/fixtures/fixtures.lock.json`. The Demo will link each source and retain Apache-2.0 attribution metadata; image provenance remains distinct from the SDK/model license.
