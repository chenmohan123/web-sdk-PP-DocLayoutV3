# web-sdk-PP-DocLayoutV3

[English](README.en.md)

在浏览器中运行 PP-DocLayoutV3 的 TypeScript SDK，基于 ONNX Runtime Web。SDK 默认加载版本化模型清单，优先选择 WebGPU 和 FP16；能力不足或会话创建失败时，可自动回退到 WebGPU FP32 或 WASM FP32。

> 当前支持 PC、移动端浏览器、微信公众号 H5 和微信小程序 `web-view` 页面。不支持微信小程序原生推理。

## 安装与零配置使用

```bash
pnpm add web-sdk-pp-doclayoutv3
```

```ts
import { createDocLayout, DocLayoutError } from "web-sdk-pp-doclayoutv3";

const detector = await createDocLayout({
  onProgress(event) {
    console.log(event.phase, event.status, event.loadedBytes, event.totalBytes);
  }
});

try {
  const file = document.querySelector<HTMLInputElement>("input[type=file]")!.files![0]!;
  const result = await detector.detect(file, { threshold: 0.5 });
  console.log(result.detections, result.runtime, result.timings);
} catch (error) {
  if (error instanceof DocLayoutError) console.error(error.code, error.details);
} finally {
  await detector.dispose();
}
```

初始化完成后可通过 `detector.loadTimings` 查看耗时拆分：`totalMs` 为初始化总耗时，`modelMs` 为模型获取与校验聚合耗时；`modelDownloadMs`、`modelCacheMs`、`integrityMs`、`sessionMs` 分别对应网络下载、缓存读取、SHA-256 完整性校验和 ONNX Runtime Session 创建，`modelSource` 表示 `network`、`cache`、`memory` 或 `custom`。

## 手动选择与自定义模型

`backend` 可设为 `auto`、`webgpu`、`wasm`；`precision` 可设为 `auto`、`fp16`、`fp32`。全自动选择时 `allowFallback` 默认为 `true`；显式指定后端或精度时默认为 `false`，需要跨有效候选回退可主动设为 `true`。用户可传清单 URL、清单对象，或内存中的 `{ manifest, data }`；自定义模型必须遵循相同输入、输出和后处理契约。

默认模型的支持矩阵为：WebGPU 支持 FP16 和 FP32，CPU/WASM 仅支持 FP32。使用默认模型时，SDK 会以 `CAPABILITY_UNSUPPORTED` 拒绝显式的 `backend: "wasm", precision: "fp16"` 组合；`allowFallback` 不会覆盖清单中不存在的后端/精度组合。在线 Demo 选择 CPU 时会禁用 FP16；若先选 FP16 再切换 CPU，会自动改为 FP32 并显示提示。自定义清单若包含已验证的 WASM FP16 变体，SDK 和 Demo 仍允许该组合。

默认模型：FP16 为 74,279,796 字节，仅用于 WebGPU；FP32 为 143,216,104 字节，支持 WebGPU 与 WASM。模型使用 Apache-2.0，来源为 PaddlePaddle `PP-DocLayoutV3_safetensors`，详见 [模型文档](docs/zh-CN/models.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。

## 部署与隐私

推理在用户浏览器本地完成，SDK 不会把文档图片上传到项目服务器。默认模型需要 HTTPS 下载和正确的 CORS 响应；模型缓存使用 IndexedDB。若要启用多线程 WASM，请配置 COOP/COEP 形成 `crossOriginIsolated` 环境。首次加载会下载约 71 MB 或 137 MB 模型，请在移动网络场景明确提示用户。

已记录的真实 WebGPU 验证环境为 Windows、Chrome 151、NVIDIA Blackwell、ONNX Runtime Web 1.27.0；FP16 单次样本的下载、会话创建和推理分别约 440 ms、1785 ms、682 ms。这不是跨设备基准，正式矩阵将在 1.0.0 发布验证中提供。

## 文档

- [快速开始](docs/zh-CN/quick-start.md)
- [API](docs/zh-CN/api.md)
- [兼容性](docs/zh-CN/compatibility.md)
- [模型与精度](docs/zh-CN/models.md)
- [模型转换](docs/zh-CN/conversion.md)
- [自定义模型](docs/zh-CN/custom-models.md)
- [部署](docs/zh-CN/deployment.md)
- [性能](docs/zh-CN/performance.md)
- [错误码](docs/zh-CN/errors.md)
- [故障排查](docs/zh-CN/troubleshooting.md)
- [CDN、Vite、React、Vue、微信 H5 示例](examples/)

## 开发

```bash
pnpm install --frozen-lockfile
pnpm verify
```

项目代码和 ONNX 衍生产物按 Apache-2.0 开源。模型与上游项目的归属信息见 `THIRD_PARTY_NOTICES.md`。
