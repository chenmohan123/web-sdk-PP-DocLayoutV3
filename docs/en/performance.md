# Performance

[中文](../zh-CN/performance.md)

Performance metrics have two independent scopes. `detector.loadTimings` records one-time initialization: capability probing, manifest retrieval, model download or cache access, integrity verification, and Session creation; its `totalMs` is the wall-clock duration of the full initialization. `result.timings` records the current image detection: image decode, preprocessing, model inference, and postprocessing; its `totalMs` is the end-to-end wall-clock duration from starting image processing until the result is returned. It also includes small amounts of Worker communication, scheduling, and result-transfer overhead, so the phase timings do not necessarily sum exactly to `totalMs`.

Existing real-runtime evidence (2026-08-11) used Windows, Chrome 151, an NVIDIA Blackwell adapter, ONNX Runtime Web 1.27.0, the 74,279,796-byte FP16 graph, and a `[1,3,800,800]` input. Recorded values were approximately 440 ms download, 1785 ms session creation, and 682 ms inference; all four outputs passed finite-value checks.

This proves real WebGPU/FP16 execution but is not a general product benchmark: it does not include the CPU model, network bandwidth, peak memory, or repeated-sample statistics. Task 20 will publish the formal 1.0.0 matrix with explicit hardware, browser, model hash, cold/warm cache, and CPU/GPU combinations.

Prioritize detector reuse, IndexedDB caching, FP16 on WebGPU with `shader-f16`, avoiding multiple large simultaneous sessions, and bounded/cancellable mobile work. Do not treat first session creation as steady-state inference throughput.
