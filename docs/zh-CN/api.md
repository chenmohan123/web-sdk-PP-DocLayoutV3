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
- `listModelCache()` / `clearModelCache()`: 查看或清除该检测器缓存管理器内的全部 SDK 模型缓存，保持原全清语义。
- `clearCurrentModelCache()` / `estimateModelCache()`: 按实际加载模型的 ID 和版本清理或统计全部精度缓存。
- `clearAllModelCache()`: 与旧 `clearModelCache()` 等价。
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

顶层 `clearCurrentModelCache({ modelId, version })` 精确匹配一个模型及版本，`clearAllModelCache()` 删除本 SDK 的全部模型缓存，`clearModelCache()` 保留同样的全清语义。普通模型缓存键保持兼容；身份含 `:` 或 `%` 时逐段编码，无法无歧义识别的历史键只会由 SDK 全清移除。默认检测器和顶层 API 共享当前 JavaScript 环境的缓存管理器，覆盖持久缓存失败后的内存回退；`cache: false` 的独立管理器需要通过检测器实例清理。

`estimateModelCache(identity?)` 返回 `bytes`（内存与持久副本字节数之和）、`memoryBytes`、`persistentBytes`、`entryCount`（按键去重）。省略身份时统计本 SDK 全部模型；容量来自模型字节元数据，不含 ONNX 会话、图片、浏览器存储开销。可选 `originUsageBytes` 和 `originQuotaBytes` 来自 `navigator.storage.estimate()`，表示整个源站，不能当作 SDK 缓存容量。

```ts
import {
  clearCurrentModelCache,
  clearAllModelCache,
  estimateModelCache
} from "web-sdk-pp-doclayoutv3";

const identity = { modelId: "pp-doclayoutv3", version: "1.0.2" };
const usage = await estimateModelCache(identity);
await clearCurrentModelCache(identity);
await clearAllModelCache();
```

清理会阻止同一管理器中先前启动的下载回填缓存，但不会自动销毁正在运行的检测器会话。Demo 会先取消并等待当前任务，再 `dispose()` 释放 Worker/session，最后清理缓存。其他标签页或独立 JavaScript 环境的活跃任务需要由调用方协调；SDK 全清不会删除其他 SDK 的 Cache Storage。

`loadTimings.modelCacheReadMs` 是标准缓存读取耗时，`modelCacheMs` 保留为同值兼容字段。两者均不包含 SHA-256 校验耗时。

`probeDocLayoutCapabilities()`、`listModelCache()`、`clearModelCache()`、`parseModelManifest()`、`DocLayoutError`、默认清单/WASM URL，以及所有公开 TypeScript 类型。错误消息保持英文稳定，界面可按 `error.code` 本地化。
