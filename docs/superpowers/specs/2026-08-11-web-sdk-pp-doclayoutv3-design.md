# PP-DocLayoutV3 Web SDK 设计规格

日期：2026-08-11

状态：已由用户确认

## 1. 目标

创建公开项目 `chenmohan123/web-sdk-PP-DocLayoutV3`，提供基于 ONNX Runtime Web 的 PP-DocLayoutV3 浏览器端版面检测 SDK，并发布到 npm。

首版正式支持：

- PC 现代浏览器。
- 移动端现代浏览器。
- 微信公众号 H5。
- 微信小程序 `<web-view>` 中的 H5。
- CPU/WASM 与 GPU/WebGPU 自动选择和手动指定。
- 官方模型的 FP32、FP16，以及通过精度验收后的 INT8 变体。
- 用户通过模型 manifest 加载兼容的微调模型；内存二进制必须与 manifest 一起提供。
- 中文优先、中英文完整的文档和示例。
- 本地 Demo 与 GitHub Pages 在线 Demo。

## 2. 非目标

首版不承诺：

- 微信原生小程序 JavaScript 运行环境中的端侧 ONNX 推理。
- Node.js 服务端推理。
- OCR 文字识别或完整文档解析流水线。
- 对任意结构 ONNX 检测模型的通用兼容。
- 在不支持 WebGPU 的环境中模拟 GPU。

## 3. 许可证与来源

SDK 使用 Apache License 2.0。官方模型同为 Apache-2.0，仓库必须保留：

- PaddlePaddle/PaddleOCR 的原始许可证与归属。
- 官方模型下载地址和版本标识。
- ONNX、FP16、INT8 为衍生模型的说明。
- PP-DocLayoutV3 论文引用。
- 第三方依赖许可证清单。

## 4. 支持矩阵

| 场景 | 首版级别 | 执行后端 |
| --- | --- | --- |
| Chrome / Edge 桌面 | 正式支持 | WebGPU 优先，WASM 回退 |
| Firefox 桌面 | 正式支持 | WASM；可用时启用 WebGPU |
| Safari 桌面与 iOS | 正式支持 | 能力探测后选择 WebGPU 或 WASM |
| Android 现代浏览器 | 正式支持 | 能力探测后选择 WebGPU 或 WASM |
| 微信公众号 H5 | 正式支持 | WebView 能力探测后选择 |
| 微信小程序 `<web-view>` | 正式支持 | 由其中加载的 H5 页面执行 |
| 微信原生小程序逻辑层 | 不支持 | 无 |

“正式支持”指 SDK 能进行能力检测、成功走至少一个执行后端，并在不满足条件时返回结构化错误。WebGPU 和 FP16 是否可用始终以运行时探测为准，不能仅根据 User-Agent 判断。

## 5. 总体架构

采用“轻量 npm SDK + 版本化模型 manifest + GitHub Release 模型资源”的分层方案。

SDK 是单个无框架依赖的 TypeScript 包，输出：

- ESM 构建。
- 浏览器 `<script>` 使用的 IIFE/UMD 构建。
- TypeScript 类型声明。
- source map。

内部模块边界：

### 5.1 ModelManager

负责读取 manifest、选择模型变体、下载、进度、取消、SHA-256 校验和缓存。它不理解推理输出语义。

### 5.2 RuntimeSelector

负责探测 WebGPU、`shader-f16`、WASM 和跨源隔离能力，按策略生成候选执行计划并记录回退原因。它不下载模型。

### 5.3 Preprocessor

负责图片输入标准化、解码、缩放到 800×800、RGB 排列、数值缩放和 NCHW Tensor 构造。具体参数来自 manifest。

### 5.4 InferenceEngine

负责创建和释放 ONNX Runtime Web session、执行推理、管理 Worker/主线程策略并收集 session 与模型执行耗时。

### 5.5 Postprocessor

负责解析类别分数、矩形框、多点 polygon 和阅读顺序，将坐标映射回原图。类别与输出签名来自 manifest。

## 6. 公开 API

主入口：

```ts
const detector = await createDocLayout({
  backend: "auto",
  precision: "auto",
  model: undefined,
  cache: true,
  allowFallback: true,
  onProgress(event) {}
});

const result = await detector.detect(image, {
  threshold: 0.5,
  signal
});

detector.dispose();
```

### 6.1 创建选项

- `backend`: `auto | webgpu | wasm`，默认 `auto`。
- `precision`: `auto | fp32 | fp16 | int8`，默认 `auto`。
- `model`: 默认模型、自定义 manifest URL、manifest 对象，或 `{ manifest, data: ArrayBuffer }`。模型 URL 必须作为 manifest 变体的一部分提供，不能脱离输入输出与预处理元数据单独加载。
- `cache`: 是否启用持久缓存，默认启用。
- `allowFallback`: `auto` 模式默认 `true`；显式指定后端或精度时默认 `false`。
- `onProgress`: 接收能力检测、下载、校验、session 创建和回退事件。
- `ort`: WASM 文件路径、线程数和日志等级等高级选项。

### 6.2 图片输入

`detect` 接受 `Blob`、`File`、`ImageBitmap`、`HTMLImageElement`、`HTMLCanvasElement`、`OffscreenCanvas` 和包含像素数据的结构化输入。不同构建目标不支持的 DOM 类型不会出现在对应运行路径中。

### 6.3 检测结果

每个检测项包含：

- `labelId`、`label`、`score`。
- 原图坐标系中的 `box`。
- 原图坐标系中的 `polygon`。
- 从 1 开始的 `readingOrder`。

整体结果还包含：

- `timings`: 解码、预处理、模型执行、后处理和总耗时。
- `runtime`: 实际后端、精度、设备能力和全部回退记录。
- `model`: 名称、版本、字节数、参数量、哈希、输入输出签名和来源。
- `image`: 原始尺寸和模型输入尺寸。

## 7. 模型 manifest

manifest 是 SDK 与模型之间的稳定协议，至少包含：

```json
{
  "schemaVersion": 1,
  "name": "PP-DocLayoutV3",
  "version": "1.0.0",
  "sdk": { "minVersion": "1.0.0" },
  "source": { "framework": "transformers", "license": "Apache-2.0" },
  "input": { "name": "pixel_values", "shape": [1, 3, 800, 800] },
  "outputs": {
    "logits": "logits",
    "boxes": "pred_boxes",
    "order": "order_logits",
    "masks": "out_masks"
  },
  "preprocess": { "width": 800, "height": 800, "rescale": 0.00392156862745098 },
  "labels": ["abstract", "algorithm"],
  "variants": []
}
```

每个变体必须声明 `precision`、推荐后端、URL、字节数、SHA-256、ONNX opset 和验证摘要。manifest 的实际输出名以转换产物为准，不能为了匹配示例而改写模型语义。`polygon_points` 不是原始模型张量；SDK 必须按照官方 processor，使用 `out_masks`、box 和原图尺寸派生多边形。

## 8. 模型转换与验证

### 8.1 来源

以 `E:\models\PP-DocLayoutV3_safetensors` 为主要转换源，以 `E:\models\PP-DocLayoutV3` 的 Paddle 推理模型和官方 Transformers 推理结果为参考基准。

### 8.2 产物

- FP32：权威 ONNX 基准产物。
- FP16：用于支持 FP16 的 WebGPU 设备。
- INT8：用于 WASM/CPU，仅在精度与性能均通过验收时发布。

最终输入、输出、opset 和 ONNX Runtime Web 版本由转换探针确定并固定在构建脚本中。转换必须可重复执行，不能依赖手工编辑 ONNX 图。

### 8.3 验证

验证集覆盖中文、英文、表格、图片、公式、倾斜、弯曲和屏幕拍照文档。比较内容包括：

- FP32 ONNX 与官方实现的原始输出数值误差。
- 经过后处理后的类别、分数、box、polygon 和阅读顺序。
- FP16、INT8 相对 FP32 的检测结果保真度。
- 各变体在真实浏览器中的 session 创建和推理成功率。
- 模型文件大小、峰值内存、冷加载、热加载和推理耗时。

FP16 或 INT8 若未达到实施计划中固定的验收阈值，则该变体不会进入默认 manifest 或 Release。FP32 必须通过后才能发布 SDK 1.0。

## 9. 运行时选择

`auto` 模式按以下顺序尝试：

```text
WebGPU FP16
  -> WebGPU FP32
  -> WASM INT8
  -> WASM FP32
```

FP16 候选需要 WebGPU 与相应 FP16 能力。INT8 候选需要 manifest 中存在已验证的 INT8 变体。

显式指定后端或精度时不跨出用户指定范围，除非 `allowFallback: true`。每次回退都通过事件和最终结果公开：候选项、失败阶段、稳定错误码和底层原因。

WASM 多线程仅在环境具备所需跨源隔离条件时启用；否则使用单线程，不把缺少 COOP/COEP 当作致命错误。

## 10. 模型分发与缓存

- ONNX 文件使用 Git LFS 保存在仓库的模型目录。
- 每个版本同步上传为 GitHub Release 资源。
- npm 包内置版本固定的默认 manifest 地址，不包含数百 MB 的模型二进制。
- 浏览器首次运行只下载所选变体，并显示可取消的下载进度。
- 下载完成后先校验 SHA-256，再创建 session。
- 优先使用 Cache Storage 或适合大对象的浏览器缓存；能力不足或配额失败时退化为当次内存缓存。
- 提供 `clearModelCache` 和缓存状态查询 API。
- 支持 `baseUrl` 和完整 URL 重写，便于国内镜像、私有部署和离线打包。

SDK 版本不能引用可变的 `latest` 模型资源；默认 URL 必须固定到模型版本和哈希。

## 11. 数据流

1. `createDocLayout` 读取默认或自定义 manifest。
2. RuntimeSelector 生成有序候选执行计划。
3. ModelManager 查缓存或下载候选模型并校验哈希。
4. InferenceEngine 创建 session；失败时根据策略尝试下一候选。
5. `detect` 解码图片并记录原始尺寸。
6. Preprocessor 按 manifest 生成 Tensor。
7. InferenceEngine 执行模型。
8. Postprocessor 还原坐标、过滤阈值并生成阅读顺序结果。
9. SDK 返回检测结果、耗时、模型信息和运行时诊断。

## 12. 错误与资源管理

稳定错误类别包括：

- 能力不支持。
- manifest/schema 不兼容。
- 模型下载、HTTP 或 CORS 失败。
- 哈希不匹配。
- 模型输入输出契约不匹配。
- 图片类型、解码或尺寸无效。
- session 创建或执行失败。
- 内存或 GPU 资源不足。
- 操作被取消。

错误对象必须包含 `code`、用户可读消息、阶段、是否可重试、候选后端和原始 cause。中文和英文文档说明错误码，但运行时消息保持英文以便搜索和跨语言日志处理。

所有下载和检测接受 `AbortSignal`。`dispose` 可重复调用，并释放 session、Tensor、Worker、ImageBitmap 和持有的 GPU/内存资源。SDK 不上传用户图片，不采集遥测。

## 13. Demo

桌面布局由三部分构成：

- 顶部紧凑运行设置：自动/WebGPU/WASM、自动/FP32/FP16/INT8、模型选择、阈值。
- 主检测画布：选择或拖放单张图片，显示矩形、多点 polygon、类别、置信度和阅读顺序。
- 右侧信息区：模型加载、下载、session 创建、预处理、推理、后处理耗时；实际后端与精度；模型名称、大小、参数量和哈希；检测元素列表。

移动端按“运行设置、图片结果、元素列表、性能与模型详情”纵向排列。

Demo 还提供：

- 加载进度与取消。
- 默认模型、自定义 manifest 和本地模型选择。
- JSON 结果导出。
- 缓存查看与清理。
- 结构化错误详情。
- 中文/英文切换。

## 14. 文档与示例

中文是默认入口：

- `README.md`：中文。
- `README.en.md`：英文。
- `docs/zh-CN`：中文完整文档。
- `docs/en`：英文完整文档。

两种语言都覆盖安装、快速开始、API、兼容性、模型变体、模型转换、自定义微调模型、部署/CORS/缓存、性能、错误码和故障排查。

示例包含：

- CDN `<script>`。
- Vanilla + Vite。
- React。
- Vue。
- 微信公众号 H5。
- 微信小程序 `<web-view>` 容器和域名配置说明。

## 15. 仓库与分支

远程仓库：`https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3`。

最终本地目录：`F:\git\00_chenmohan\github\web-sdk-PP-DocLayoutV3`。

分支策略：

- `main`：稳定发布。
- `develop`：日常开发、集成和测试。
- `feature/*`：独立功能分支，合入 `develop`。

首个 npm 名称尝试 `web-sdk-pp-doclayoutv3`；如被占用则使用 `@chenmohan123/pp-doclayout-v3`。

## 16. CI/CD

Pull Request 和 push 检查包括：

- 格式、lint、TypeScript 类型检查。
- 单元测试和覆盖率。
- SDK 构建。
- npm tarball 内容与安装 smoke test。
- WASM 浏览器集成测试。
- 中英文文档链接和示例构建。

真实 WebGPU 验证在具备 GPU 的本机浏览器运行，并生成带浏览器、GPU、模型哈希和测试图片版本的基准报告。CI 中有可用 GPU 时再增加相同测试，不能用软件回退结果冒充 WebGPU 验证。

发布流程：

1. `develop` 验证通过后合入 `main`。
2. 创建语义化版本标签和 GitHub Release。
3. 上传模型 manifest、已验证模型资产、校验和与基准报告。
4. 使用 npm Trusted Publishing 或仓库 secret 发布公开 npm 包，并启用 provenance。
5. 部署 GitHub Pages Demo。

## 17. 验收标准

首版完成需要同时满足：

- 在至少一个 WebGPU 桌面浏览器成功运行 FP32 与通过验证的 FP16。
- 在 Chrome、Edge、Firefox 和 Safari 的代表性版本中至少通过 WASM 路径；无法在当前机器直接测试的平台必须明确记录测试缺口，不得声称通过。
- `auto`、显式 `webgpu`、显式 `wasm` 和回退行为均有自动化测试。
- 官方样例与验证集上的 FP32 检测结果通过与官方实现的既定阈值。
- FP16 和 INT8 仅在各自阈值通过时出现在默认 manifest。
- Demo 完整显示加载时间、各阶段耗时、模型信息和单图检测叠加结果。
- 自定义模型 manifest 至少有一个可运行示例和契约错误示例。
- npm tarball 可在全新示例项目安装并运行，不包含模型大文件。
- GitHub 仓库公开，`main` 与 `develop` 存在，GitHub Pages 可访问。
- npm 包公开可安装，中文与英文文档完整且互相链接。

## 18. 已解决的关键决策

- 原生微信小程序端侧推理不进入首版；支持小程序 WebView。
- 模型不直接塞入 npm 包；以零配置默认 manifest 的形式“内置”。
- 发布 FP32 和 FP16；INT8 通过精度验收后发布。
- 自动模式速度优先，WebGPU 和 FP16 优先。
- SDK 是单包，不在首版拆成插件包。
- Demo 同时提供在线 Pages、本地项目和 CDN 最小示例。
- 文档中英文完整，中文优先。
