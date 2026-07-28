# Chrome Web Store 上架填写清单

本文对应 BrainHub Capture 0.1.6。商店声明必须与 `manifest.json`、扩展实际行为和公开隐私政策保持一致。

## 商品详情

- 类别：工作流程与规划（Workflow & Planning）
- 语言：中文（简体）
- 商店图标：`public/icons/icon-128.png`
- 屏幕截图：`assets/store/brainhub-capture-screenshot-1280x800.png`
- 宣传视频：留空
- 小型宣传图块：第一版留空

说明：

```text
BrainHub Capture 将 ChatGPT、Claude、Gemini 和 Grok 的网页 AI 会话，以及你主动选择的网页文本，直接归档到你自己的 Google Drive。

扩展不要求 BrainHub 云端账号。连接 Drive 时，由你选择并授权自己的 Google 账号；会话内容从浏览器直接写入该账号的 My Drive，不经过维护者控制的内容服务器。

主要功能：
• 分别启用 ChatGPT、Claude、Gemini 和 Grok，首次启用默认回填当前账号可见的历史会话。
• 每 30 分钟执行增量同步，也可以随时手动同步。
• 在普通网页中选择文本，通过右键菜单保存到 Drive。
• 会话写入 brain-hub/inbox/<device>/，网页选中文本写入 brain-hub/highlights/YYYY-MM/。
• 每个站点的访问权限都由用户单独授予，可以随时关闭。
• 断开或卸载扩展不会删除 Google Drive 中已经归档的内容。

数据与隐私：
• Google Drive 权限为 drive.file，只管理扩展创建或用户明确授权给扩展的文件。
• 会话正文、网页选中文本和媒体只在本次处理的内存管道中使用，不在扩展本地持久化。
• OAuth token 由 Chrome 管理，不写入扩展存储。
• 不包含广告、产品遥测、远程崩溃上报或远程执行代码。
• 维护者不会接收、存储或查看用户归档的内容。

项目开源，采用 Apache-2.0 许可证。
```

如页面提供网站字段：

- 官方网站：`https://brainhub.john-qh.com/`
- 支持网址：`https://github.com/qianh/ai-session-web/issues`

## 隐私权

单一用途说明：

```text
在用户逐项授权后，将受支持的网页 AI 会话和用户主动选择的网页文本直接归档到用户自己的 Google Drive。
```

权限理由：

- `alarms`：每 30 分钟触发已启用站点的增量同步。
- `contextMenus`：仅在用户选择网页文本后提供“保存到 Google Drive”的右键命令。
- `identity`：通过 Chrome Identity 请求用户授权的 Google OAuth token，以访问用户自己的 Drive；断开时撤销授权并清除缓存 token。
- `notifications`：在用户主动保存选中文本后显示本地成功或错误结果；通知不包含正文。
- `offscreen`：在扩展离屏文档中完成会话媒体的本地格式处理，不显示页面，也不加载远程代码。
- `scripting`：仅在用户启用并授予对应站点权限后，动态注册该站点的会话完成观察脚本；禁用站点时注销。
- `storage`：保存设备 ID、站点开关、同步水位、Drive 根目录 ID、连接账号标识和运行状态；不保存会话正文、网页选中文本、Cookie 或 OAuth token。
- `https://www.googleapis.com/*`：调用 Google Drive API，创建和更新用户授权范围内的 BrainHub 文件。
- `https://oauth2.googleapis.com/*`：仅在用户点击断开时调用 OAuth 撤销端点。
- 可选站点权限：用户可分别授权 `chatgpt.com`、`claude.ai`、`gemini.google.com` 和 `grok.com`，用于读取当前账号可见的会话并识别回答完成；未授权站点不运行采集脚本。

远程代码：选择“否，我没有使用远程代码”。

数据类型选择：

- 个人身份信息：连接账号的邮箱、显示名称和 Google Drive permission ID，只保存在扩展本地状态中。
- 身份验证信息：Chrome 提供的短期 OAuth token 仅在内存中用于 HTTPS Drive API 请求，不持久化。
- 个人通信：用户选择归档的 AI 会话内容。
- 网络历史记录：归档会话包含对应受支持站点的来源链接；扩展不读取 Chrome 浏览历史。
- 用户活动：启用站点后，仅观察该站点第一方会话请求的完成事件以触发同步，不记录点击、按键或通用浏览行为。
- 网站内容：用户选择归档的 AI 会话、媒体引用和主动选择的网页文本。

不要选择：健康信息、财务和付款信息、位置。

数据用途认证：页面列出的 Limited Use、禁止出售、禁止广告、禁止信用评估和限制人工读取等认证全部勾选。扩展当前行为符合这些声明。

隐私政策网址：

```text
https://brainhub.john-qh.com/privacy.html
```

## 分发

- 可见性：公开
- 地区：所有地区
- 应用内购买：否
- 付费功能：无

## 测试说明

测试账号或凭据：不提供，也不需要 BrainHub 专用账号。审核人员使用自己的 Google 账号完成 Drive OAuth；AI 站点同步使用审核人员自己的站点账号。

测试步骤：

```text
1. 安装扩展后，点击 Chrome 工具栏中的 BrainHub Capture。
2. 点击“连接 Google Drive”，选择测试用 Google 账号并同意 drive.file 授权。弹窗会显示实际连接邮箱，并在 My Drive 根目录创建或绑定 brain-hub/。
3. 打开已登录的 ChatGPT、Claude、Gemini 或 Grok，回到扩展弹窗启用该站点并同意可选站点权限。首次启用会开始回填可见历史，也可点击同步按钮手动触发。
4. 在 Google Drive 的 brain-hub/inbox/<device>/ 中确认生成会话 Markdown 文件。
5. 另一个无需 AI 站点账号的测试方式：在任意普通 HTTPS 网页选择一段文本，右键选择 BrainHub Capture 的保存命令；在 brain-hub/highlights/YYYY-MM/ 中确认生成 UTF-8 文本文件。
6. 点击“断开”可撤销 OAuth 授权并清除扩展本地状态；该操作不会删除 Drive 中已归档的文件。

扩展没有维护者控制的内容服务器、付费墙或专用测试凭据。所有正文均直接写入审核人员授权的 Google Drive。
```

## 提交前

依次保存“商品详情”“隐私权”“分发”和“测试说明”。处理页面显示的所有红色必填项后再点击“提交审核”。首次提交建议选择延迟发布，审核通过后再由维护者手动公开发布。
