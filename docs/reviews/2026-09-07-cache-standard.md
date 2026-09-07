# 缓存与标准耗时整改核验

日期：2026-09-07。适用标准：Web Model SDK Standard 1.1.0。范围为单 SDK runtime、Demo、公开文档与 manifest；本次未提交、推送或发布。

## 改动与回归

- `packages/sdk/src/model/model-manager.ts` 提供 `modelCacheReadMs`，与兼容字段 `modelCacheMs` 同值。针对性测试先观察到标准字段缺失，再验证网络、持久缓存路径。
- `clearCurrentModelCache({ modelId, version })` 匹配指定模型版本的全部精度；`clearAllModelCache()` 与旧 `clearModelCache()` 都仅清理 SDK 命名空间。普通键保持历史兼容，含冒号或百分号的身份使用独立 `ppdoclayout-v2` 前缀与逐段编码，避免历史文本被解码误删；无法解析的历史身份仍可由 SDK 全清移除。
- 默认实例与顶层 API 共享当前 JavaScript 环境的管理器，覆盖持久缓存写入失败后的内存回退。清理和写入串行；清理使先前下载的缓存写入失效。
- `estimateModelCache(identity?)` 使用缓存元数据统计 SDK 内存、持久缓存与模型条目；`originUsageBytes`、`originQuotaBytes` 单独表示整个源站。模型容量不含会话、图片和浏览器存储开销。
- Demo 根据选中清单或实际已加载模型确定身份；清理会取消并等待任务、释放 Worker/session，再清理缓存，并显示容量、忙碌和错误状态。
- `apps/demo/playwright.config.ts` 新增可选 `DEMO_BASE_URL`，供本次复用已运行的 `http://127.0.0.1:4274`。未配置时仍按原命令创建 4174 开发服务，避免测试重复争用端口。

## 已执行验证

| 命令                                                                     | 结果                                                                               |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 门户 `pnpm sdk:check -- --repo ../web-sdk-PP-DocLayoutV3 --format table` | `locally-compliant`，required 失败 0，远程 required skip 4，recommended 失败 0     |
| `pnpm --filter web-sdk-pp-doclayoutv3 test`                              | 9 个文件、85 项通过；包括模型身份/版本隔离、历史特殊字符键、容量分层、下载回填保护 |
| `pnpm lint`、`pnpm typecheck`                                            | 工作区通过；最终 SDK 类型/lint 再次通过                                            |
| `pnpm docs:test`                                                         | 6 项通过，双语 API 示例参与 TypeScript 编译                                        |
| `pnpm release:test`                                                      | 23 项通过，包括 Pages 子路径构建与资源暂存                                         |
| `pnpm benchmark:test`、`pnpm benchmark:parity`                           | 分别 5 项、14 项通过                                                               |
| `pnpm test`（设置 `DEMO_BASE_URL`）                                      | examples 12 项、Demo Chromium 22 项通过；SDK 后续新增历史键用例后的最终数量为 85   |
| `pnpm build`                                                             | SDK、Demo 和已有消费者示例全部构建通过                                             |

新增 `apps/demo/tests/cache.spec.ts` 的 3 项 Chromium 用例覆盖：当前模型清理保留其他模型、SDK 全清保留其他 SDK、双语控件及容量变化；删除失败后的可读错误与按钮恢复；真实 WASM Worker 推理后释放 Worker，并清理持久写入失败留下的内存缓存。其他 Demo 用例覆盖两种模型来源、取消、图片切换与响应式布局。

## 独立复查后的最终验证

复查发现 A 加载期间可以应用自定义清单 B，随后 A 创建完成会覆盖 B 的缓存身份。新增浏览器用例先复现“校验”按钮在加载中仍启用，再验证修复：加载、下载、推理及来源切换期间禁用应用，处理函数使用活跃任务引用同步防护。任务完成后恢复应用。

上表保留首轮验证记录；最终完整 Demo 回归为 23 项通过，其中 `cache.spec.ts` 为 4 项通过。最终 Demo 类型检查、lint、生产构建通过；SDK 85 项单元测试由主代理再次执行并通过。没有更改 SDK 版本或远程状态。

## 限制

- `pnpm run verify` 在 `format:check` 扫描既有 `work/pytest-basetemp-20260815` 时遇到 `EPERM`；提升权限后仍不可遍历该目录。未改动该目录或其权限。其余 verify 阶段已逐项执行，本次修改文件使用显式路径单独检查格式。
- 构建保留已有 ONNX Runtime 动态 WASM URL 警告；Pages 资源暂存与两来源同源 WASM 浏览器用例均通过。
- 缓存控件使用极小模型验证交互和 Worker 生命周期，不构成新的真实 PP-DocLayoutV3 性能或浏览器兼容矩阵证据。manifest 的 `verification.environments` 仍为空。
- 清理不自动销毁调用方自行持有的其他检测器；其他标签页或独立 JavaScript 环境的活跃任务需调用方协调。`cache: false` 的独立管理器通过检测器实例清理。
- 4 项远程治理规则仍未核验；本地通过不等于远程发布或完整 `compliant`。
