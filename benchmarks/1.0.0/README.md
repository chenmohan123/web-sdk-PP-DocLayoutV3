# 1.0.0 Benchmark Evidence / 1.0.0 基准证据

`runtime.json` inventories real-model validation evidence for the accepted FP32 WASM and FP16 WebGPU variants. The FP16 entry includes measured download, session creation, and inference timings from Chrome 151 on an NVIDIA Blackwell adapter.

`runtime.json` 记录已接受的 FP32 WASM 与 FP16 WebGPU 真实模型验证证据。FP16 条目包含 Chrome 151、NVIDIA Blackwell 环境下实测的下载、会话创建和推理耗时。

The report is intentionally marked `releaseReady: false`: cold/warm load, capability probing, decode, preprocess, postprocess, total time, and responsive screenshot capture still require a dedicated hardware run before a public 1.0.0 release. INT8 is unsupported and must not be advertised.

报告明确标记为 `releaseReady: false`：正式发布前仍需在硬件环境补采冷/热加载、能力探测、解码、预处理、后处理、总耗时和响应式截图。INT8 不受支持，不得作为 accepted variant 宣传。
