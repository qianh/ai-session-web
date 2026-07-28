# BrainHub Capture

BrainHub Capture 是独立安装的 Google Chrome 扩展。它把 ChatGPT、Claude、Gemini 和 Grok 的网页 AI 会话，以及用户主动选择的普通网页文本，直接写入用户自己的 Google Drive。

扩展不依赖 BrainHub MCP，不读取画像，不处理 cards 或周报，也没有遥测、远程崩溃上报和自更新代码。

## 安装

第一版只支持 Google Chrome。正式上架后，普通用户从 Chrome Web Store 安装，后续版本也只通过商店更新。上架状态与公开隐私资料见 [BrainHub 官网](https://brainhub.john-qh.com/)。

首次使用：

1. 点击扩展图标并连接 Google Drive。
2. Chrome 会使用当前 Chrome Profile 的 Google 登录状态打开授权页；用户确认自己的账号并同意授权即可。
3. 授权成功后，弹窗显示实际连接邮箱，并创建或绑定该账号 My Drive 根目录下唯一的 `brain-hub/`。
4. 分别启用需要归档的站点权限。每个站点第一次启用时默认全量回填可见历史，之后每 30 分钟增量同步。

若 Drive 中有多个可访问的同名 `brain-hub`，扩展会停止写入并要求用户明确选择，不会自动合并或删除目录。

## 账号切换与断开

扩展一次只绑定当前 Chrome Profile 的一个 Google 账号。需要切换时：

1. 在扩展弹窗中断开 Google Drive。
2. 切换到目标 Chrome Profile。
3. 在该 Profile 中重新连接并授权。

断开会撤销 OAuth 授权、清除 Chrome 缓存 token 和扩展本地状态。断开或卸载扩展都不会删除 Drive 内容。

## 数据边界

- AI 会话写入 `brain-hub/inbox/<device>/`，不会创建 `sessions/`。
- 用户右键保存的网页选中文本写入 `brain-hub/highlights/YYYY-MM/`。
- Google Drive 权限固定为 `drive.file`，扩展只能管理自己创建或用户授权给它的文件。
- 站点访问是逐站可选权限，只包含 `chatgpt.com`、`claude.ai`、`gemini.google.com` 和 `grok.com`。
- 会话与选中文本在上传前执行凭据脱敏；本地不持久化正文、媒体、Cookie 或 OAuth token。
- 禁用再启用站点会续接原水位；只有“下次全量补拉”会重置该站点回填状态。

完整说明见 [数据与隐私边界](docs/privacy.md) 与公开的 [隐私政策](https://brainhub.john-qh.com/privacy.html)。

## 源码开发

官方商店包在构建时注入与固定扩展 ID 匹配的 BrainHub OAuth Client ID。源码构建与 fork 必须使用自己的 Google Cloud Chrome Extension OAuth Client。

要求 Node.js `>=22.12.0` 与 pnpm 10.26：

```bash
pnpm install --frozen-lockfile
pnpm verify
```

开发构建可使用占位 OAuth，不能连接 Drive。可连接 Drive 的源码构建方法见 [Google OAuth 配置](docs/google-oauth-setup.md)。

## 许可

Apache License 2.0。安全问题请使用 GitHub Security Advisory 私下报告。
