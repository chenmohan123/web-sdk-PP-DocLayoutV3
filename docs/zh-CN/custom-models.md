# 自定义模型

[English](../en/custom-models.md)

微调模型必须提供 schemaVersion 1 清单，并保持 PP-DocLayoutV3 的输入、四个输出和标签契约。每个变体都要声明 URL、字节数、SHA-256、opset、精度、兼容后端和验证状态。

清单可通过 URL 加载；也可以在内存中同时传入已校验的清单与 ONNX 数据：

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

`{ manifest, data }` 仍会按清单校验 SHA-256，不能用于绕过完整性检查。自定义模型若更改输出语义、查询数、mask 形状或标签映射，必须先适配 SDK；仅文件能被 ONNX Runtime 加载并不等于兼容。

生产部署应使用不可变版本 URL、正确 CORS、HTTPS 和长期缓存，并为每次发布保留验证报告。
