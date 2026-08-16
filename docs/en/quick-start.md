# Quick start

[中文](../zh-CN/quick-start.md)

After installing `web-sdk-pp-doclayoutv3`, the first detector creation probes browser capabilities, downloads the manifest and model, checks SHA-256, and creates an ONNX Runtime session. The defaults `backend: "auto"`, `precision: "auto"`, and `allowFallback: true` prefer GPU execution.

Start with a single-image file input:

```ts
import { createDocLayout, DocLayoutError } from "web-sdk-pp-doclayoutv3";

export async function detectOne(file: File): Promise<void> {
  const detector = await createDocLayout({
    onProgress: (event) => console.log(event.phase, event.status)
  });
  try {
    const result = await detector.detect(file, {
      threshold: 0.5,
      classThresholds: {
        formula: 0.4,
        table: 0.55,
        text: 0.6
      }
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof DocLayoutError) console.error(error.code, error.message);
    else throw error;
  } finally {
    await detector.dispose();
  }
}
```

`classThresholds` overrides confidence filtering for matching manifest label names and falls back to `threshold` for unspecified classes. The global `threshold` still controls mask binarization and polygon extraction. Unknown class names and values outside `0` through `1` are rejected.

The result includes original-image coordinates for each box and polygon, category, score, and reading order. It also reports loading/inference timings, the actual backend and precision, and fallback records. Production pages should expose loading state and cancellation and call `dispose()` during page teardown.

Complete CDN, Vanilla Vite, React, Vue, and WeChat H5/WebView integrations live under [`examples/`](../../examples/).
