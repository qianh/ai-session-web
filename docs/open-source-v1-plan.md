# BrainHub Capture 开源 v1 改造计划

## 目标

通过 Chrome Web Store 独立发布 BrainHub Capture。普通用户安装后使用当前 Chrome Profile 的 Google 账号授权，只把网页 AI 会话和用户主动选择的网页文本写入该账号 My Drive 的唯一 `brain-hub/` 目录。

## P0：清理公开边界

- 将扩展名称、标题、描述和文档中的 `Brain Capture` 统一为 `BrainHub Capture`；仓库名可以继续使用 `ai-session-web`。
- 保留 `package.json` 的 `private: true`，因为该仓库不发布 npm 包；补充 `license: Apache-2.0` 和标准 `LICENSE`。
- 删除普通用户自建 Google Cloud 项目、填写 OAuth Client ID、克隆源码安装等说明。
- 明确只支持 Google Chrome、ChatGPT、Claude、Gemini、Grok；其他网页只允许手动保存选中文本。
- 删除所有 cards、周报、蒸馏或读取 Drive 内容的公开表述。

## P1：官方授权与 Drive 根目录

- 在同一 Google Cloud 项目中维护 Chrome Extension OAuth Client 与 MCP Desktop OAuth Client；官方构建注入商店扩展 ID 对应的客户端配置。
- Capture 保持 `drive.file`，授权后显示实际连接邮箱；不提供扩展内账号选择器，切换通过 Chrome Profile 完成。
- 正常路径自动查找或创建 My Drive 根目录下唯一的 `brain-hub/`；绑定并持久化 folder ID，避免仅依赖名称。
- 发现多个可访问的同名根目录时停止写入并让用户选择；不自动合并、删除或猜测。
- 修正“断开 Google 账号”：撤销 OAuth 授权、清除缓存 token 和扩展本地状态，但不删除 Drive 内容。
- 官方商店包使用官方 OAuth 身份；源码构建和 fork 必须注入自己的 OAuth 配置。

## P2：首次使用与采集

- 新增首次使用流程：连接 Drive、展示账号、按站点独立启用权限。
- 每个站点首次启用时默认展示并确认可见历史回填，完成后建立独立水位。
- 禁用再启用默认续接原水位；只有显式重置才重新全量回填。
- 所有会话只写入 `brain-hub/inbox/<device>/`；不创建 `sessions/`。
- 保留任意网页的手动选中文本保存；不增加通用网页自动抓取。
- 所有写入继续执行凭据脱敏、临时文件校验、稳定身份去重和失败重试。

## P3：商店与开源发布

- 补充 `SECURITY.md`、`CONTRIBUTING.md`、隐私政策、权限用途说明、数据删除说明和支持入口。
- Chrome Web Store 隐私申报必须与实际权限一致：无遥测、无远程崩溃上报、无远程可执行代码。
- CI 在固定 pnpm 和最低 Node 版本上执行测试、类型检查、lint、格式检查、构建和发布包审计。
- 发布流水线生成可复现 zip，检查没有开发 OAuth 占位符、调试源映射、测试凭据或未声明 host 权限。
- 版本只通过 Chrome Web Store 更新；源码仓库用 tag 和 changelog 对应商店版本。

## 验收

- 新 Chrome Profile 从商店安装后，无需 Google Cloud 配置即可完成授权和首次站点回填。
- Capture 与先安装的 BrainHub MCP 能复用同一 `brain-hub/`，反向安装顺序同样成立。
- 断开或卸载扩展后，Drive 内容保持不变。
- 四个站点的增量采集、回填恢复、权限撤销和根目录冲突均有自动化测试。
- `pnpm verify` 和发布包审计在干净 CI 环境通过。
