# 2026-09-08 fast-uri 安全补丁验证

本轮将开发工具链中的 `fast-uri` 从 `3.1.5` 更新到 `3.1.6`。
本地补丁与验证已就绪；远端 CI、合并、告警关闭和 Pages 部署需在后续流程核验。

- 仓库：`chenmohan123/web-sdk-PP-DocLayoutV3`。
- 基线：`53cbbfb3cfa350abdd505765ca36540708fdd213`，已核对远端 `main`。
- 分支：`codex/fix-fast-uri-security`。
- 日期：2026-09-08；系统：Windows；Node.js：`24.16.0`；pnpm：`11.16.0`。
- 分层：单 SDK 的开发依赖维护；SDK runtime、模型、公共 API 和包版本未修改。

## 告警与安全边界

GitHub API 在本次核验时返回以下 4 条开放告警，作用域均为 `development`，
首个修复版本均为 `3.1.6`：

| 编号 | 公告                | 问题                                 |
| ---- | ------------------- | ------------------------------------ |
| 5    | GHSA-jqff-g426-hqxp | 百分号编码的协议名称可能引入主机混淆 |
| 4    | GHSA-f65p-4m7j-42xc | 畸形 IPv6 规范化可能改变主机         |
| 3    | GHSA-fph4-wmhf-6fwf | 主机名重复百分号解码                 |
| 2    | GHSA-5jgf-p345-68v8 | 无协议引用跳过 IDN 规范化            |

`pnpm why fast-uri -r` 确认两条直接消费路径：

1. `@microsoft/api-extractor → @microsoft/tsdoc-config → ajv@8.18.0 → fast-uri`。
2. `@microsoft/api-extractor → @rushstack/node-core-library → ajv@8.20.0 → fast-uri`，
   同时覆盖 `ajv-draft-04` 和 `ajv-formats`。

两个 Ajv 版本的 `dist/runtime/uri.js` 均直接加载 `fast-uri`，声明的 `^3.0.1`
范围接受补丁版本。TSDoc 和 API Extractor 使用该解析器处理 JSON Schema 引用；
本仓库未发现 SDK runtime 或 Demo 将用户模型 URL 交给 `fast-uri` 的直接调用。
由此只能认定存在受影响的开发依赖，不能将公告中的 SSRF 描述等同于已证实的
在线 SDK SSRF 路径。

修复边界是完整替换锁文件中该包的解析版本：包条目、官方 integrity、两个 Ajv
引用和 snapshot，共 5 行替换。没有增加 override，也没有升级无关依赖。

官方元数据：<https://registry.npmjs.org/fast-uri/3.1.6>。

## 安全行为验证

安装后的两个 Ajv 路径各执行 7 项断言，共 14 项通过，见
[安全用例证据](2026-09-08-fast-uri-security-cases.json)：

- 编码协议不再引入新的主机，`resolve` 拒绝含结构字符的无效协议。
- 畸形 IPv6 返回错误，保留原始输入，`resolve` 拒绝继续解析。
- 嵌套主机百分号保持编码，不再变成 `localhost`。
- 无协议 IDN 引用按最终 HTTP 协议规范化到 `127.0.0.1`。
- 正常相对路径继续正确解析，正常域名大小写仍可等价比较。

独立的补丁前后对照还观察到：`3.1.5` 会将嵌套主机解码为 `localhost`，
并保留 `127。0。0。1` 的非规范形式；`3.1.6` 对应结果均符合预期。
这些用例在本地直接运行，不发起指向测试 URL 的网络请求。

## 本地校验结果

| 命令／检查                                         | 结果                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| 门户 `pnpm sdk:check -- --repo <本仓库>`，修改前后 | 均为 18 项 required 通过、0 失败、4 项远端检查跳过；`locally-compliant`       |
| `CI=true pnpm install --frozen-lockfile`           | 通过；372 个锁条目通过供应链策略检查                                          |
| `pnpm why fast-uri -r`                             | 仅解析到 `fast-uri@3.1.6`                                                     |
| 全部 Git 跟踪文件的分批 Prettier 内容检查          | 通过；使用 `--ignore-unknown --end-of-line auto` 适配 Windows 检出            |
| `pnpm docs:test`                                   | 6 项通过，保留真实 TypeScript 文档示例编译                                    |
| `pnpm release:test`                                | 25 项通过，包含 Pages 基路径构建和 npm 发布契约                               |
| `pnpm benchmark:test`                              | 5 项通过                                                                      |
| `pnpm benchmark:parity`                            | 14 项通过                                                                     |
| `pnpm lint`、`pnpm typecheck`                      | 通过                                                                          |
| `pnpm test`                                        | SDK 单测 89 项、示例消费者 12 项、Demo 浏览器 26 项通过                       |
| `pnpm build`                                       | SDK、Demo、React、Vue、Vanilla Vite、微信 web-view 示例构建通过               |
| `pnpm test:browser`                                | 20 项通过、3 项按既有条件跳过；覆盖真实浏览器 WASM 生命周期、缓存和打包消费者 |
| `git diff --check`                                 | 通过                                                                          |

完整 `pnpm run verify` 在格式扫描阶段被既有
`work/pytest-basetemp-20260815` 目录的 `EPERM` 阻断，宿主环境下同样如此。
本轮未改动该目录或校验脚本，而是分批检查全部跟踪文件，再按 `verify` 中的
相同顺序逐项执行剩余阶段；全部阶段通过。Windows 工作区使用 CRLF，格式内容
检查保留现有换行符；远端 Linux CI 的原始 `pnpm run verify` 结果仍需单独核验。

根浏览器套件跳过的是七图片真实模型基准、真实模型 FP32 WASM、真实模型 FP16
WebGPU。这些需要显式真实模型／硬件环境，本轮开发依赖补丁未扩展相关兼容性声明。
构建仍有 ONNX Runtime 的既有 WASM URL 静态解析提示；浏览器 WASM 和同源资源
测试通过。

标准证据：[修改前](2026-09-08-dependencies-standard-before.json)、
[修改后](2026-09-08-dependencies-standard-after.json)。

## 后续远端核验

本地结果不代表远端告警已关闭或 Pages 已部署。合并前应核验最新提交的必需 CI，
合并后核验 4 条告警状态、Pages 成功部署及其源提交。此次未创建标签或发布 npm 包。
