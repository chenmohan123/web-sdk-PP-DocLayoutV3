# Pages 与模型声明审查记录

核验日期：2026-09-07。标准版本：1.1.0。

本次属于单 SDK Demo 修复与部署准备，补充现有能力声明，不扩展 runtime API、Examples 结构或浏览器兼容性承诺。模型身份、字节数和 SHA-256 来自 `models/pp-doclayoutv3/manifest.json`，npm 身份来自 `packages/sdk/package.json`。

## Pages 配置

`.github/workflows/pages.yml` 已有 main 分支限制、`github-pages` 环境、部署 URL、并发控制、构建与部署权限隔离、官方 Pages artifact/deploy actions，未发现需要修改的配置。

`pnpm --filter demo list --depth -1` 成功解析为 `@ppdoclayout/demo@0.0.0`，当前简称不会漏过 Demo 构建。发布依次构建 SDK、按仓库子路径构建 Demo，再运行 `scripts/stage-pages-models.mjs` 校验并复制模型资源。

## 本地检查

在门户仓库运行 `pnpm sdk:check -- --repo ../web-sdk-PP-DocLayoutV3 --format table`：修改前 required 失败 6 项；补齐 manifest 后失败 4 项，远程规则 4 项仍为 skip。仓库状态仍为 `partial`。

| 规则                                    | 现有证据与影响                                                                                                                                                   | 后续修复                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| CONFIG-001                              | `packages/sdk/src/model/model-manager.ts` 导出 `modelCacheMs`，尚未提供标准 `modelCacheReadMs`。                                                                 | 独立兼容性改造中补充标准别名与测试，保留旧 API。                    |
| CONFIG-001、CACHE-001                   | `clearModelCache()` 调用 `ModelManager.clearCache()` 清空 SDK 缓存；未实现仅当前模型清理和容量估计。manifest 如实声明 `clearCurrent: false`、`estimate: false`。 | 在 runtime 与 Demo 中分别实现单模型清理、全缓存清理和存储容量估计。 |
| EXAMPLE-001；EXAMPLE-003（recommended） | `examples/vanilla-vite` 有 package、入口与 README，manifest 已指向该目录；当前检查器只将 `examples/vanilla` 识别为 vanilla。                                     | 在专门的规范迁移中确认目录兼容规则，或补齐标准 vanilla 目录。       |

检查器的 `PERF-001` 会根据非空耗时数组判定通过，但 `CONFIG-001` 仍准确揭示标准缓存耗时字段缺项；不得据此宣称完全符合标准。

`GOV-001`、`GOV-002`、`DEPLOY-001`、`PAGES-001` 的 skip 不代表通过。实际分支 Ruleset、Pages Source、HTTPS 与成功部署提交需要发布阶段的 GitHub API 证据。

浏览器矩阵暂保留空数组，此次配置审查不能代替真实推理验证。

## 验证结果

- 使用 Ajv 2020 对门户 `standards/v1/sdk-manifest.schema.json` 校验通过；manifest 中包身份、版本、模型参数量、资源大小及 SHA-256 与仓库源文件逐项一致。
- 使用 YAML 结构化解析检查 Pages 的 main 限制、环境、job 依赖、官方 actions 和最小权限，通过。
- 对本次新增文件执行 Prettier 检查，通过；`git diff --check` 通过。
- Demo 构建、浏览器交互与发布后的远程核验由同一发布任务另行执行，本配置审查不将它们记为通过。
