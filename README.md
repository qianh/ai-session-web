# Brain Capture

Brain Capture 是 BrainHub 的 Chrome Manifest V3 采集扩展。它按站点授权访问当前已登录的网页会话，将 ChatGPT、Claude、Gemini 和 Grok 的可见活动分支转换为统一 Markdown；用户也可以把任意普通网页中手动选中的文本上报为精华内容。两类内容都直接写入个人 Google Drive 的 `brain-hub/` 目录。

## 当前能力

- 四站同一版本：`chatgpt.com`、`claude.ai`、`gemini.google.com`、`grok.com`
- 首次启用站点时默认全量补拉，之后每 30 分钟按水位增量同步
- 网页回答持久化后触发一次站点级即时补拉；若站点主接口失效，则把内存中当前一轮作为明确标记的降级文件归档
- 默认只采集个人空间；团队或组织空间必须逐站显式开启
- 归档可访问的图片与附件，单文件默认上限 100 MB；失败时保留原链接和警告
- 任意普通网页选中文本后，可通过右键“上报 Google Drive”立即保存为独立精华条目
- 精华条目以 UTF-8 纯文本永久保存到 `highlights/YYYY-MM/`，不记录页面标题或来源 URL
- Drive 使用 `drive.file` 最小权限，只能管理本扩展创建或经用户授权给它的文件
- 扩展本地只保存设置、水位、哈希和错误状态，不保存会话正文、媒体、Cookie 或访问令牌

降级文件只包含触发完成事件的当前一轮问答，不冒充完整会话。它使用内容哈希去重，仍经过统一脱敏、字节校验和原子上传；主适配器错误状态与 `!` 徽标会继续保留，提示后续修复并补拉完整会话。

## 为什么需要 Google Cloud

Google Drive 本身只负责文件存储，不能直接给一个 Chrome 扩展分配 OAuth 身份。Google Cloud 项目用于启用 Drive API、配置授权提示页并创建扩展专用的 OAuth Client ID。它不承载 BrainHub 会话，也不需要部署服务器或开通付费资源。

OAuth Client ID 是公开的应用标识，不是 Client Secret。扩展通过 Chrome Identity 获取短期访问令牌；令牌不会写入扩展存储。

## 创建 OAuth Client ID

固定扩展 ID：

```text
gljnhnhnkdjofigpbfdhiacbelljijmn
```

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择一个项目。
2. 在“API 和服务 / 库”中搜索并启用 **Google Drive API**。
3. 打开 **Google Auth Platform**，填写应用名称 `Brain Capture`、支持邮箱和联系邮箱。
4. Audience 选择 **External**。保持 Testing 状态，并把实际使用 Drive 的 Google 账号加入 Test users；个人自用不必发布应用。
5. 在 Data Access 中加入 `https://www.googleapis.com/auth/drive.file`。
6. 在 Clients 中创建 OAuth Client，应用类型选择 **Chrome Extension**。
7. Application ID 填入上面的固定扩展 ID，创建后复制以 `.apps.googleusercontent.com` 结尾的 Client ID。

本项目不需要 Client Secret。若 Google Cloud 的新界面名称略有变化，关键对象仍是：Drive API、OAuth consent/branding、Test user、Chrome Extension client。

## 构建与安装

环境要求：Node.js 22+、pnpm 10.26+、Chrome 120+。

```bash
pnpm install
WXT_GOOGLE_OAUTH_CLIENT_ID='你的-client-id.apps.googleusercontent.com' pnpm build:release
```

然后打开 `chrome://extensions`：

1. 开启“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择本项目的 `.output/chrome-mv3/` 目录。
4. 确认扩展 ID 等于 `gljnhnhnkdjofigpbfdhiacbelljijmn`。

`pnpm build` 允许使用占位 Client ID，便于本地开发和测试，但此产物无法连接 Drive。`pnpm build:release` 和 `pnpm zip:release` 会拒绝占位或格式错误的 Client ID。

## 首次使用

1. 点击扩展图标，再点击 Google Drive“连接”，在 Chrome 弹出的 Google 授权页确认 `drive.file` 权限。
2. 授权成功后，扩展会创建或复用 `brain-hub/` 根目录。
3. 在任意普通网页中选中文字，右键点击“上报 Google Drive”；成功后会收到系统通知。
4. 如需归档 AI 会话，先打开并登录目标 AI 站点，再在弹窗中逐站开启；Chrome 只会请求该站点的访问权限。
5. 点击站点旁的同步按钮，或点击顶部“同步全部”。首次同步会进行全量补拉。
6. 站点内部接口发生变化时，弹窗和扩展徽标会显示异常；其他站点仍独立继续同步。

单条精华按 UTF-8 字节计算最大为 512 KiB。扩展会裁剪选区首尾空白、保留正文内部排版，并沿用凭证脱敏规则；超限或空白选区会直接失败，不截断也不在本地排队。

## 开发验证

```bash
pnpm verify
```

单独运行开发服务器：

```bash
pnpm dev
```

补充资料：

- [Google OAuth 配置](./docs/google-oauth-setup.md)
- [数据与隐私边界](./docs/privacy.md)
- [站点适配器与协议边界](./docs/site-adapters.md)

实现依据见 [BrainHub-开发手册-v0.2.md](./BrainHub-开发手册-v0.2.md) 和 [实施计划](./docs/superpowers/plans/2026-07-19-brain-capture.md)。
