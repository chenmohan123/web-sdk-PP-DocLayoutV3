# 微信 H5/WebView 示例

本例面向微信公众号 H5 页面和微信小程序的 `web-view` 页面，要求 HTTPS、允许下载模型资源的域名及足够内存。它不支持微信小程序原生推理，也不应作为原生小程序 SDK 使用。iOS 微信 WebView 通常使用 WASM；支持 WebGPU 的环境会由 SDK 自动优先选择 GPU。

在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm --filter web-sdk-pp-doclayoutv3 build
pnpm --filter @ppdoclayout/example-wechat-webview dev
```

仓库内使用本地 SDK 1.2.0；独立复制本例时，将 SDK 依赖改为 `1.2.0`，运行 `pnpm install`、`pnpm dev`。`pnpm build` 执行类型检查和生产构建；仓库示例测试使用当前打包的 1.2.0 tarball 验证独立安装。
