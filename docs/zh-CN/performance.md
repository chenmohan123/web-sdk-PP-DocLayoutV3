# 性能

[English](../en/performance.md)

性能指标分成两个独立范围。`detector.loadTimings` 记录一次性的初始化过程：能力探测、manifest 获取、模型下载或缓存读取、完整性校验和 Session 创建；其中 `totalMs` 是整个初始化过程的墙钟时间。`result.timings` 记录当前图片的单次检测：图片解码、预处理、模型推理和后处理；其中 `totalMs` 是从开始处理图片到返回检测结果的端到端墙钟时间，还包含 Worker 通信、调度和结果传输等少量开销，因此各阶段耗时之和不一定与 `totalMs` 完全相等。

现有真实运行证据：Windows、Chrome 151、NVIDIA Blackwell、ONNX Runtime Web 1.27.0；FP16 已通过单次样本的物理 WebGPU 验证，FP32 已在 7 张授权图片上通过物理 WebGPU 验证。FP32 文件约为 FP16 两倍大小，可能带来更高下载、初始化和显存成本；具体耗时会随硬件、浏览器、缓存和网络变化。

上述记录证明两种精度均可真实 WebGPU 运行，但不是可泛化的产品基准。不要直接用单台设备的首次加载时间推断所有用户体验。

优化优先级：复用检测器、启用 IndexedDB、在支持 `shader-f16` 的 WebGPU 上选择 FP16、避免同时创建多个大模型会话、在移动端限制并发并允许取消。不要用首轮会话创建时间代表稳定推理吞吐。
