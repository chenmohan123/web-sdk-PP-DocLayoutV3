# Custom models

[中文](../zh-CN/custom-models.md)

A fine-tuned model needs a schemaVersion 1 manifest and must preserve the PP-DocLayoutV3 input, four outputs, and label contract. Every variant declares its URL, byte count, SHA-256, opset, precision, compatible backends, and validation status.

Load a manifest by URL, or provide the validated manifest and ONNX bytes together:

```ts
import { createDocLayout, parseModelManifest } from "web-sdk-pp-doclayoutv3";

const manifest = parseModelManifest(await (await fetch("/models/custom/manifest.json")).json());
const data = await (await fetch("/models/custom/model-fp32.onnx")).arrayBuffer();
const detector = await createDocLayout({
  model: { manifest, data },
  backend: "wasm",
  precision: "fp32"
});
await detector.dispose();
```

`{ manifest, data }` still verifies SHA-256 and cannot bypass integrity checks. A custom graph that changes output semantics, query count, mask shape, or label mapping needs an SDK adaptation; merely loading in ONNX Runtime does not prove compatibility.

Production deployments should use immutable version URLs, correct CORS, HTTPS, long-lived caching, and a retained validation report for each release.
