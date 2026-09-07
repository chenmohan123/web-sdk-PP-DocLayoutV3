# React 示例

组件仅使用公开 SDK API，并在组件卸载时释放检测器与 ONNX Runtime 会话。

在仓库根目录运行：

```bash
pnpm install --frozen-lockfile
pnpm --filter web-sdk-pp-doclayoutv3 build
pnpm --filter @ppdoclayout/example-react dev
```

仓库内使用本地 SDK 1.2.0；独立复制本例时，将 SDK 依赖改为 `1.2.0`，运行 `pnpm install`、`pnpm dev`。`pnpm build` 执行类型检查和生产构建；仓库示例测试使用当前打包的 1.2.0 tarball 验证独立安装。
