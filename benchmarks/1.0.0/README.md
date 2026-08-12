# 1.0.0 Benchmark Evidence / 1.0.0 基准证据

`runtime.json` contains the release benchmark from [GitHub Actions run 31614796054](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/actions/runs/31614796054). Both accepted variants ran through the public SDK API with real models, cold and warm cache loads, one licensed image detection, parity checks, and explicit capabilities. Responsive screenshots passed at 390, 768, 1440, and 1920 pixel widths.

`runtime.json` 记录 [GitHub Actions run 31614796054](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/actions/runs/31614796054) 的正式发布基准。两个 accepted variant 均通过公开 SDK API 运行真实模型，覆盖冷加载、热缓存加载、单张授权图片检测、精度一致性与能力信息。响应式截图在 390、768、1440、1920 像素宽度全部通过。

The benchmark gate is marked `releaseReady: true`. This means the runtime and responsive verification gates passed; it does not mean npm, model assets, tags, or GitHub Pages have been published. Browser peak memory remains `null` with an explicit observability limitation. INT8 is unsupported and must not be advertised.

基准门禁已标记为 `releaseReady: true`，表示运行时与响应式验证通过；这不表示 npm、模型资产、tag 或 GitHub Pages 已经发布。浏览器无法可靠提供单次推理峰值内存，因此该字段为 `null` 并附有明确原因。INT8 不受支持，不得作为 accepted variant 宣传。
