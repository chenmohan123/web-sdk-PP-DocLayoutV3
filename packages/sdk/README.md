# web-sdk-pp-doclayoutv3

[English](#english) | [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/)

基于 ONNX Runtime Web 的浏览器端 PP-DocLayoutV3 版面分析 SDK，支持 PC、移动端与各类 H5 页面。

## 安装

```bash
pnpm add web-sdk-pp-doclayoutv3
```

也可以使用 `npm install web-sdk-pp-doclayoutv3`。

## 快速开始

```ts
import { createDocLayout } from "web-sdk-pp-doclayoutv3";

const detector = await createDocLayout({
  backend: "auto",
  precision: "auto"
});
const result = await detector.detect(file);
console.log(result.detections, result.runtime, result.timings);
await detector.dispose();
```

默认模型由 SDK 自动加载，无需额外配置。

## 运行后端与精度

- `backend: "auto"` 优先使用 WebGPU，不可用时回退到 WASM（CPU）。也可手动指定 `"webgpu"` 或 `"wasm"`。
- `precision: "auto"` 在兼容的 WebGPU 环境优先 FP16，否则使用 FP32。也可手动指定 `"fp16"` 或 `"fp32"`。
- FP16 模型用于 WebGPU；FP32 模型支持 WASM 与 WebGPU。

## 自定义模型

通过 `model` 传入微调模型的 Custom manifest URL 或 manifest 对象。自定义 manifest 必须遵循仓库中的模型契约，并为每个模型文件提供大小、SHA-256、精度及后端兼容信息。

```ts
const detector = await createDocLayout({
  model: "https://models.example.com/pp-doclayoutv3/manifest.json"
});
```

## 资源管理

模型加载进度通过 `onProgress` 回调提供。可捕获结构化的 `DocLayoutError` 并读取 `code` 与 `details`。SDK 支持模型缓存；可以通过 detector 的缓存方法查询或清理。使用结束后必须调用 `dispose()` 释放 Worker、ONNX Runtime session 与 GPU/CPU 资源。

## 微信环境

支持微信公众号页面以及微信内嵌浏览器中的 H5/WebView 集成。当前不宣称支持 native Mini Program 原生小程序直接推理；原生小程序需要通过 WebView 承载 H5 页面或使用服务端推理。

## 完整文档

- [中文文档](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3#readme)
- [English documentation](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/blob/main/README.en.md)
- [在线 Demo](https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/)
- [示例目录](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/tree/main/examples)

## English

A browser-first PP-DocLayoutV3 document layout analysis SDK powered by ONNX Runtime Web for desktop, mobile, and H5 pages.

### Installation

```bash
pnpm add web-sdk-pp-doclayoutv3
```

`npm install web-sdk-pp-doclayoutv3` is also supported.

### Quick start

```ts
import { createDocLayout } from "web-sdk-pp-doclayoutv3";

const detector = await createDocLayout({
  backend: "auto",
  precision: "auto"
});
const result = await detector.detect(file);
console.log(result.detections, result.runtime, result.timings);
await detector.dispose();
```

The SDK loads its default model automatically.

### Backend and precision

- `backend: "auto"` prefers WebGPU and falls back to WASM (CPU). Use `"webgpu"` or `"wasm"` for an explicit choice.
- `precision: "auto"` prefers FP16 on compatible WebGPU devices and otherwise uses FP32. Use `"fp16"` or `"fp32"` for an explicit choice.
- The FP16 model targets WebGPU. The FP32 model supports WASM and WebGPU.

### Custom models

Pass a fine-tuned model's Custom manifest URL or manifest object through `model`. Each manifest variant must declare its byte size, SHA-256 digest, precision, and compatible backends.

```ts
const detector = await createDocLayout({
  model: "https://models.example.com/pp-doclayoutv3/manifest.json"
});
```

### Resource management

Use `onProgress` for model loading progress. Structured failures are exposed as `DocLayoutError` with `code` and `details`. Model cache entries can be listed or cleared through the detector. Always call `dispose()` when finished to release the Worker, ONNX Runtime session, and GPU/CPU resources.

### WeChat environments

WeChat official-account pages and other H5/WebView integrations are supported. Native Mini Program inference is not claimed; a native Mini Program should host the H5 experience in a WebView or use server-side inference.

### Documentation

- [Chinese documentation](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3#readme)
- [English documentation](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/blob/main/README.en.md)
- [Live Demo](https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/)
- [Examples](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/tree/main/examples)

Apache-2.0
