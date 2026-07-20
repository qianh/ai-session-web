# Google OAuth 配置

Brain Capture 使用 Chrome Identity 与 Google Drive API。Google Cloud 只用于给扩展创建 OAuth 身份；会话正文不会经过 Google Cloud 项目中的服务器。

## 固定信息

- 扩展 ID：`gljnhnhnkdjofigpbfdhiacbelljijmn`
- OAuth 客户端类型：Chrome Extension
- OAuth scope：`https://www.googleapis.com/auth/drive.file`
- Client Secret：不需要

## 创建步骤

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择项目。
2. 在 API Library 中启用 Google Drive API。
3. 在 Google Auth Platform 中配置 Branding、Audience 和 Data Access。
4. Audience 选择 External；保持 Testing 时，把实际使用 Drive 的 Google 账号加入 Test users。
5. Data Access 只添加 `drive.file`。
6. 在 Clients 中创建 Chrome Extension 类型的 OAuth Client。
7. Application ID 填写固定扩展 ID，复制生成的 Client ID。

正式构建命令：

```bash
WXT_GOOGLE_OAUTH_CLIENT_ID='实际-client-id.apps.googleusercontent.com' pnpm build:release
```

生成 ZIP：

```bash
WXT_GOOGLE_OAUTH_CLIENT_ID='实际-client-id.apps.googleusercontent.com' pnpm zip:release
```

发布命令会检查 Client ID、固定扩展 ID、权限集合、动态观察脚本和远程托管代码。占位 Client ID 无法通过正式构建。

## 授权范围说明

`drive.file` 允许扩展管理自己创建的文件，以及用户明确授权给该应用的文件。它不等于读取整个 Google Drive。Chrome 缓存短期访问令牌；Brain Capture 不把令牌写入 `chrome.storage`。
