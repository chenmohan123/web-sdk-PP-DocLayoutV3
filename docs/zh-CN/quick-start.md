# 快速开始

[English](../en/quick-start.md)

安装 `web-sdk-pp-doclayoutv3` 后，浏览器会在第一次创建检测器时探测能力、下载清单与模型、校验 SHA-256，并创建 ONNX Runtime 会话。默认 `backend: "auto"`、`precision: "auto"` 和 `allowFallback: true` 优先使用 GPU。

页面至少需要一个单图文件输入：

```ts
import { createDocLayout, DocLayoutError } from "web-sdk-pp-doclayoutv3";

export async function detectOne(file: File): Promise<void> {
  const detector = await createDocLayout({
    onProgress: (event) => console.log(event.phase, event.status)
  });
  try {
    const result = await detector.detect(file, { threshold: 0.5 });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (error instanceof DocLayoutError) console.error(error.code, error.message);
    else throw error;
  } finally {
    await detector.dispose();
  }
}
```

检测结果包含原图坐标系下的 `box`、`polygon`、类别、置信度与阅读顺序，也包含加载/推理耗时、实际后端、精度和回退记录。生产页面应展示加载状态、允许取消，并在页面卸载时调用 `dispose()`。

CDN、Vanilla Vite、React、Vue 和微信 H5/WebView 的完整用法在 [`examples/`](../../examples/) 中。
