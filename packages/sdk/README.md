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

模型初始化耗时可以通过 `detector.loadTimings` 查看。`totalMs` 是初始化总耗时，`modelMs` 是模型获取与校验的聚合耗时；同时提供 `modelDownloadMs`（网络下载）、`modelCacheMs`（缓存读取）、`integrityMs`（SHA-256 完整性校验）、`sessionMs`（ONNX Runtime Session 创建）和 `modelSource`（`network`、`cache`、`memory` 或 `custom`）。

## 运行后端与精度

- `backend: "auto"` 优先使用 WebGPU，不可用时回退到 WASM（CPU）。也可手动指定 `"webgpu"` 或 `"wasm"`。
- `precision: "auto"` 在有 `shader-f16` 的 WebGPU 环境优先 FP16，没有该能力时可使用 WebGPU FP32，必要时回退到 WASM/CPU + FP16 或 FP32。也可手动指定 `"fp16"` 或 `"fp32"`。
- 默认模型 `1.0.2` 的 FP16 和 FP32 变体均支持 WebGPU 和 WASM/CPU；模型二进制复用不可变的 `v1.0.1-models`。
- 使用默认模型时，显式请求清单中未声明的组合会抛出 `CAPABILITY_UNSUPPORTED`，不会改写无效组合；自定义清单可在单独验证后声明其他组合。上游模型是 float32，不支持 FP64；FP32 约为 FP16 两倍大小并可能更慢、更占显存。

## 自定义模型

通过 `model` 传入微调模型的 Custom manifest URL 或 manifest 对象。自定义 manifest 必须遵循仓库中的模型契约，并为每个模型文件提供大小、SHA-256、精度及后端兼容信息。

```ts
const detector = await createDocLayout({
  model: "https://models.example.com/pp-doclayoutv3/manifest.json"
});
```

## 资源管理

模型加载进度通过 `onProgress` 回调提供。`phase: "model"`、`status: "progress"` 事件中的 `loadedBytes` 和可选的 `totalBytes` 仅表示网络下载字节，不代表完整初始化百分比，也不包含完整性校验或 Session 创建。响应没有 `Content-Length` 时 `totalBytes` 可能缺失，缓存、内存或自定义二进制模型也可能不产生字节进度。可捕获结构化的 `DocLayoutError` 并读取 `code` 与 `details`。SDK 支持模型缓存；可以通过 detector 的缓存方法查询或清理。使用结束后必须调用 `dispose()` 释放 Worker、ONNX Runtime session 与 GPU/CPU 资源。

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

Detailed initialization timings are available through `detector.loadTimings`. `totalMs` is the full initialization duration and `modelMs` is the aggregate model acquisition and verification duration. The additive fields `modelDownloadMs`, `modelCacheMs`, `integrityMs`, `sessionMs`, and `modelSource` (`network`, `cache`, `memory`, or `custom`) separate network download, cache reads, SHA-256 verification, Session creation, and the selected model source.

### Backend and precision

- `backend: "auto"` prefers WebGPU and falls back to WASM (CPU). Use `"webgpu"` or `"wasm"` for an explicit choice.
- `precision: "auto"` prefers FP16 on WebGPU with `shader-f16`, can use WebGPU FP32 without it, and falls back to FP16 or FP32 on WASM/CPU when needed. Use `"fp16"` or `"fp32"` for an explicit choice.
- The default `1.0.2` model supports FP16 and FP32 on both WebGPU and WASM/CPU; model binaries are reused from immutable `v1.0.1-models`.
- Explicit pairs absent from the default manifest throw `CAPABILITY_UNSUPPORTED` instead of rewriting an invalid pair. The upstream model is float32, not FP64; FP64 inference is unsupported. FP32 is about twice the size of FP16 and may be slower or use more GPU memory.

### Custom models

Pass a fine-tuned model's Custom manifest URL or manifest object through `model`. Each manifest variant must declare its byte size, SHA-256 digest, precision, and compatible backends.

```ts
const detector = await createDocLayout({
  model: "https://models.example.com/pp-doclayoutv3/manifest.json"
});
```

### Resource management

Use `onProgress` for model loading progress. On `phase: "model"`, `status: "progress"` events, `loadedBytes` and the optional `totalBytes` describe network-transfer bytes only; they are not an overall initialization percentage and exclude integrity verification and Session creation. `totalBytes` can be absent without a `Content-Length` response header, while cache, memory, or custom binary model sources may emit no byte progress. Structured failures are exposed as `DocLayoutError` with `code` and `details`. Model cache entries can be listed or cleared through the detector. Always call `dispose()` when finished to release the Worker, ONNX Runtime session, and GPU/CPU resources.

### WeChat environments

WeChat official-account pages and other H5/WebView integrations are supported. Native Mini Program inference is not claimed; a native Mini Program should host the H5 experience in a WebView or use server-side inference.

### Documentation

- [Chinese documentation](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3#readme)
- [English documentation](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/blob/main/README.en.md)
- [Live Demo](https://chenmohan123.github.io/web-sdk-PP-DocLayoutV3/)
- [Examples](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/tree/main/examples)

Apache-2.0
