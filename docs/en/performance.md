# Performance

[中文](../zh-CN/performance.md)

Measure cold download, cache read, capability probing, session creation, image decode, preprocessing, inference, postprocessing, and total duration separately. `detector.loadTimings` and `result.timings` expose loading and per-image metrics.

Existing real-runtime evidence (2026-08-11) used Windows, Chrome 151, an NVIDIA Blackwell adapter, ONNX Runtime Web 1.27.0, the 74,279,796-byte FP16 graph, and a `[1,3,800,800]` input. Recorded values were approximately 440 ms download, 1785 ms session creation, and 682 ms inference; all four outputs passed finite-value checks.

This proves real WebGPU/FP16 execution but is not a general product benchmark: it does not include the CPU model, network bandwidth, peak memory, or repeated-sample statistics. Task 20 will publish the formal 1.0.0 matrix with explicit hardware, browser, model hash, cold/warm cache, and CPU/GPU combinations.

Prioritize detector reuse, IndexedDB caching, FP16 on WebGPU with `shader-f16`, avoiding multiple large simultaneous sessions, and bounded/cancellable mobile work. Do not treat first session creation as steady-state inference throughput.
