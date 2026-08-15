# Performance

[中文](../zh-CN/performance.md)

Performance metrics have two independent scopes. `detector.loadTimings` records one-time initialization: capability probing, manifest retrieval, model download or cache access, integrity verification, and Session creation; its `totalMs` is the wall-clock duration of the full initialization. `result.timings` records the current image detection: image decode, preprocessing, model inference, and postprocessing; its `totalMs` is the end-to-end wall-clock duration from starting image processing until the result is returned. It also includes small amounts of Worker communication, scheduling, and result-transfer overhead, so the phase timings do not necessarily sum exactly to `totalMs`.

Existing real-runtime evidence used Windows, Chrome 151, an NVIDIA Blackwell adapter, and ONNX Runtime Web 1.27.0. FP16 passed physical WebGPU validation on a single sample; FP32 passed on seven licensed fixtures. FP32 is about twice the file size of FP16 and can increase download, initialization, and GPU-memory costs; timings vary with hardware, browser, cache, and network.

This proves real WebGPU execution for both precisions but is not a general product benchmark. Do not use one device's cold-start timing to predict every user's experience.

Prioritize detector reuse, IndexedDB caching, FP16 on WebGPU with `shader-f16`, avoiding multiple large simultaneous sessions, and bounded/cancellable mobile work. Do not treat first session creation as steady-state inference throughput.
