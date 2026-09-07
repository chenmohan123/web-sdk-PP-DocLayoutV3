# CDN 示例

本例固定使用 `web-sdk-pp-doclayoutv3@1.2.0` 的 `browser-global.js`，通过 `window.PPDocLayout` 调用公开 API。

在仓库根目录运行 `pnpm exec vite examples/cdn --host 127.0.0.1`，打开终端显示的地址。部署时使用 HTTPS，并允许访问 jsDelivr 和默认模型资源域名。1.2.0 发布到 npm 前，该固定 CDN 地址尚不可用；发布前浏览器验证由 `tests/browser/package.spec.ts` 对当前本地 tarball 执行。
