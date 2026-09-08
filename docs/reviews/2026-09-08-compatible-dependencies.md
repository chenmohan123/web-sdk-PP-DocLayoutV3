# 2026-09-08 工作区依赖兼容升级验证

本轮从 fast-uri 安全补丁提交
`c86d43f12da45a07a15964a423c17f423488786b` 建立本地分支
`codex/dependencies-compatible-upgrade`，处理 Dependabot #38 的兼容升级。
参考的 Dependabot 提交为 `a0985b62b0e4bab3128938b740f64e62532b69d1`。
本报告记录本地验证；远端最新提交 CI、合并和 Pages 部署仍需后续核验。

变更属于单 SDK 的开发工具和 Demo／示例依赖维护。SDK 仍为 `1.2.0`，
默认模型仍为 `1.0.2`；SDK runtime、模型文件、公开 API、测试断言和 CI 流程均保持原状。

## 最终升级范围

共承接 #38 中 14 个包的版本升级，涉及 8 个工作区 `package.json` 与对应锁文件。
表中版本为锁文件实际解析结果；根目录继续沿用现有范围版本声明风格。

| 依赖                       | 升级前  | 最终版本 | 使用位置                                           |
| -------------------------- | ------- | -------- | -------------------------------------------------- |
| `@eslint/js`               | 9.39.5  | 10.0.1   | 根目录                                             |
| `eslint`                   | 9.39.5  | 10.10.0  | 根目录、SDK                                        |
| `typescript-eslint`        | 8.66.0  | 8.69.0   | 根目录                                             |
| `vitest`                   | 3.2.7   | 5.0.0    | 根目录、SDK、示例测试                              |
| `@microsoft/api-extractor` | 7.58.12 | 7.59.0   | SDK                                                |
| `vite`                     | 7.3.6   | 8.2.2    | Demo、React、Vue、Vanilla Vite、微信 web-view 示例 |
| `@vitejs/plugin-react`     | 5.0.4   | 6.1.1    | Demo、React 示例                                   |
| `react`                    | 19.1.0  | 19.2.8   | Demo、React 示例                                   |
| `react-dom`                | 19.1.0  | 19.2.8   | Demo、React 示例                                   |
| `@types/react`             | 19.1.10 | 19.2.18  | Demo、React 示例                                   |
| `@types/react-dom`         | 19.1.7  | 19.2.7   | Demo、React 示例                                   |
| `@vitejs/plugin-vue`       | 6.0.1   | 6.0.8    | Vue 示例                                           |
| `vue`                      | 3.5.21  | 3.5.42   | Vue 示例                                           |
| `vue-tsc`                  | 3.0.8   | 3.3.11   | Vue 示例                                           |

锁文件保留安全补丁 `fast-uri@3.1.6`，没有重新引入 `3.1.5`。
安装时没有 peer 冲突；冻结安装通过。

## 未采纳的版本

| 依赖              | #38 提议 | 最终保留                   | 依据                                                                     |
| ----------------- | -------- | -------------------------- | ------------------------------------------------------------------------ |
| `typescript`      | 7.0.2    | 5.9.3，根目录范围 `^5.9.0` | 7.0.2 根入口不再提供现有 compiler API，且超出 typescript-eslint 支持范围 |
| `@types/node`     | 26.4.1   | 24.13.3，范围 `^24.0.0`    | 与 `.nvmrc` 的 Node 24 基线一致                                          |
| `onnxruntime-web` | 1.29.0   | 1.27.0                     | 本轮限定为兼容工具链升级，沿用现有真实模型和浏览器证据对应的运行时       |
| `lucide-react`    | 1.41.0   | 0.468.0                    | 实测新版本缺少当前 Demo 的 `Github` 导出，类型检查与 Vite 生产构建均失败 |

### TypeScript 证据

[原始 CI 失败](https://github.com/chenmohan123/web-sdk-PP-DocLayoutV3/actions/runs/34138453167)
在 `scripts/check-doc-parity.mjs:63` 访问 `ts.ModuleKind.ESNext` 时抛出
`TypeError: Cannot read properties of undefined (reading 'ESNext')`。

2026-09-08 查询官方 npm registry 得到：

- `typescript@7.0.2` 的根导出是 `./lib/version.cjs`，编译器接口改为独立 unstable 入口。
- `typescript-eslint@8.69.0` 的 TypeScript peer 范围是 `>=4.8.4 <6.1.0`。
- `@microsoft/api-extractor@7.59.0` 自带 `typescript: 5.9.3`。
- `vue-tsc@3.3.11` 的 TypeScript peer 范围是 `>=5.0.0`，接受 5.9.3。

保留 5.9.3 后，原有文档示例真实编译、SDK 声明生成、Vue 类型检查均通过。
此次没有替换或削弱 compiler API 校验。

### Lucide 证据

候选 `lucide-react@1.41.0` 安装后，`pnpm typecheck` 返回
`apps/demo/src/App.tsx(7,3): error TS2305: Module '"lucide-react"' has no exported member 'Github'`。
`pnpm release:test` 中的 Pages 基路径构建也返回同一导出的 `MISSING_EXPORT`。
当前 `App.tsx:454` 将此组件用于 GitHub 链接；保留 0.468.0 后，两项检查均通过。

## 最终校验

环境：2026-09-08，Windows、Node.js `24.16.0`、pnpm `11.16.0`、
Playwright Chromium `151.0.7922.34`。以下结果针对最终依赖候选。

| 检查                                                                         | 结果                                                                    |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 修改前／后标准检查                                                           | 均为 18 项 required 通过、0 失败、4 项远端规则跳过，`locally-compliant` |
| `CI=true pnpm install --frozen-lockfile`                                     | 通过，锁文件无需重新解析                                                |
| `pnpm docs:test`                                                             | 6 项通过，包含所有现有 TypeScript 文档片段编译                          |
| `pnpm lint`                                                                  | ESLint 10 检查 SDK 与 Demo 通过                                         |
| `pnpm typecheck`                                                             | SDK、示例测试、Demo 通过                                                |
| `pnpm --filter web-sdk-pp-doclayoutv3 test`                                  | Vitest 5：89 项通过                                                     |
| `pnpm release:test`                                                          | 25 项通过，包含 Vite 8 的 Pages 基路径构建                              |
| `pnpm benchmark:test`                                                        | 5 项通过                                                                |
| `pnpm benchmark:parity`                                                      | 14 项通过                                                               |
| `pnpm build`                                                                 | SDK、Demo 和 4 种框架／H5 示例构建通过；API 报告未变化                  |
| `pnpm --filter './examples/tests' test`                                      | Vitest 5：12 项通过，包含 4 个独立安装消费者的类型检查与 Vite 8 构建    |
| `DEMO_BASE_URL=http://127.0.0.1:4374 pnpm --filter '@ppdoclayout/demo' test` | 26 项通过，包含缓存、Worker、WASM 资源、交互和响应式布局                |
| `pnpm test:browser`                                                          | 20 项通过、3 项按既有真实模型条件跳过；包含 WASM 推理、缓存和包消费者   |
| 全部 Git 跟踪文件的分批格式检查                                              | 通过；使用 `prettier --check --ignore-unknown --end-of-line auto`       |
| `git diff --check`                                                           | 通过                                                                    |

Demo 验证使用本轮新建的 `4374` 服务，启动日志明确为 `VITE v8.2.2`。
安装版本核验同时确认 React `19.2.8`、lucide-react `0.468.0`、
TypeScript `5.9.3` 和 ONNX Runtime `1.27.0`。测试后已停止该服务，
原有 `4274` 服务未被终止。

额外检查 `1440×900` 与 `390×844` 视口：无 pageerror、无横向溢出、无坏图，
两种视口均显示 15 个 Lucide 图标，人工查看截图未见布局重叠。
截图：[桌面](2026-09-08-compatible-dependencies-1440.png)、
[手机](2026-09-08-compatible-dependencies-390.png)。

## 验证限制

原始 `pnpm run verify` 仍在 Prettier 扫描时遭遇既有目录
`work/pytest-basetemp-20260815` 的 `EPERM`。本轮保留校验配置，通过分批检查
全部 Git 跟踪文件并单独运行其余相同检查内容完成本地验证。
格式检查使用 `--end-of-line auto` 保留 Windows 检出的 CRLF；远端 Linux CI
仍必须执行原始 `pnpm run verify`，不能由本地结果推定通过。

3 项浏览器跳过分别为七图片真实模型基准、真实模型 FP32 WASM、真实模型 FP16
WebGPU。本轮未重新运行这些硬件／模型矩阵，也未扩大相应兼容承诺。
构建保留既有 ONNX Runtime WASM URL 的静态解析提示，实际 WASM 资源和推理测试通过。

标准报告：[修改前](2026-09-08-compatible-dependencies-standard-before.json)、
[修改后](2026-09-08-compatible-dependencies-standard-after.json)。
本轮未修改 Dependabot 分支，未提交、推送、创建 PR、合并或发布 npm／标签。
