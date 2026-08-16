# API

[English](../en/api.md)

所有稳定入口都从包根路径导出，不要导入 `src/` 或其他内部文件。

## `createDocLayout(options?)`

返回 `Promise<DocLayoutDetector>`。常用选项：

- `backend`: `"auto" | "webgpu" | "wasm"`
- `precision`: `"auto" | "fp16" | "fp32" | "int8"`；默认清单不包含 INT8
- `allowFallback`: 会话失败时是否尝试下一有效候选；全自动选择时默认 `true`，显式指定后端或精度时默认 `false`
- `model`: 清单 URL、清单对象或 `{ manifest, data }`
- `cache`: 是否使用模型缓存
- `signal`: 取消加载
- `onProgress`: 接收 capabilities、manifest、model、session、fallback、ready 等阶段
- `ort.wasm`: WASM 路径与线程选项

当 `phase: "model"` 且 `status: "progress"` 时，事件中的 `loadedBytes` 和可选的 `totalBytes` 仅表示模型网络下载字节，不是完整初始化进度；它们不包含完整性校验或 ONNX Runtime Session 创建。响应没有 `Content-Length` 时 `totalBytes` 可能缺失，缓存、内存或自定义二进制模型也可能不产生字节进度。

默认模型 `1.0.2` 中，`webgpu` 支持已验证的 `fp16` 和 `fp32`，`wasm`（CPU）支持已验证的 `fp16` 和 `fp32`。自动模式在 `shader-f16` 可用时优先 WebGPU FP16，没有该能力时可使用 WebGPU FP32，运行时失败后再回退到 WASM FP16 或 FP32。清单中不存在的显式组合会抛出 `CAPABILITY_UNSUPPORTED`；`allowFallback` 只处理有效候选的运行时失败，不会改写无效组合。Demo 仅在“自动后端 + 自动精度”时允许回退，任何手动后端或精度选择都会严格执行。原始模型是 float32，不支持 FP64 推理。

```ts
import { createDocLayout } from "web-sdk-pp-doclayoutv3";

const detector = await createDocLayout({
  backend: "wasm",
  precision: "fp32",
  allowFallback: false,
  onProgress: ({ phase, status }) => console.log(phase, status)
});
await detector.dispose();
```

## `DocLayoutDetector`

- `detect(image, { threshold, classThresholds, signal })`: 接收 Blob、CanvasImageSource 或标准化 raster。
- `dispose()`: 等待已排队操作完成并释放 Worker/session；可重复调用。
- `listModelCache()` / `clearModelCache()`: 查看或清除该检测器的模型缓存。
- `model`, `runtime`, `capabilities`, `loadTimings`: 实际加载信息。

```ts
import type { DocLayoutDetector } from "web-sdk-pp-doclayoutv3";

declare const detector: DocLayoutDetector;
declare const file: Blob;

const result = await detector.detect(file, {
  threshold: 0.5,
  classThresholds: {
    formula: 0.4,
    table: 0.55,
    text: 0.6
  }
});
```

`classThresholds` 按 manifest 标签名称覆盖置信度过滤阈值，未配置的类别回退到 `threshold`。全局 `threshold` 仍用于 mask 二值化和多边形提取。未知类别名称或超出 `0` 到 `1` 的值会被拒绝。

## 其他导出

`probeDocLayoutCapabilities()`、`listModelCache()`、`clearModelCache()`、`parseModelManifest()`、`DocLayoutError`、默认清单/WASM URL，以及所有公开 TypeScript 类型。错误消息保持英文稳定，界面可按 `error.code` 本地化。
