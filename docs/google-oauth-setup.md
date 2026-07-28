# 源码构建的 Google OAuth 配置

普通用户从 Chrome Web Store 安装时无需执行本文步骤。本文只面向源码构建者和 fork 维护者。

BrainHub Capture 使用 Chrome Identity 与 Google Drive API。Google Cloud 只用于给扩展创建 OAuth 身份；会话正文不会经过 Google Cloud 项目中的服务器。

## 固定信息

- OAuth 客户端类型：Chrome Extension
- OAuth scope：`https://www.googleapis.com/auth/drive.file`
- Client Secret：不需要

扩展 ID 与公钥由 Chrome Web Store 的首次上传确定，不应在创建商店条目前自行猜测。

## 创建步骤

1. 运行 `pnpm zip:store-bootstrap`，生成不包含 `key`、不能公开发布的首次上传包。
2. 在 Chrome Web Store Developer Dashboard 创建条目并上传该 ZIP，但不要提交审核。
3. 在 Package 页面记录商店分配的 Item ID，并复制 `View public key` 中的公钥正文。
4. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择项目并启用 Google Drive API。
5. 在 Google Auth Platform 中配置 Branding、Audience 和 Data Access；Capture 只添加 `drive.file`。
6. 创建 Chrome Extension 类型的 OAuth Client，Application ID 填写商店 Item ID。
7. 使用商店公钥、Item ID 和 OAuth Client ID 构建正式包。

正式构建命令：

```bash
WXT_EXTENSION_PUBLIC_KEY='商店公钥正文' \
WXT_EXPECTED_EXTENSION_ID='商店Item ID' \
WXT_GOOGLE_OAUTH_CLIENT_ID='实际-client-id.apps.googleusercontent.com' \
pnpm build:release
```

生成 ZIP：

```bash
WXT_EXTENSION_PUBLIC_KEY='商店公钥正文' \
WXT_EXPECTED_EXTENSION_ID='商店Item ID' \
WXT_GOOGLE_OAUTH_CLIENT_ID='实际-client-id.apps.googleusercontent.com' \
pnpm zip:release
```

发布命令会检查 Client ID、公钥生成的扩展 ID、权限集合、动态观察脚本和远程托管代码。占位 Client ID 或不匹配的 Item ID 无法通过正式构建。

## 授权范围说明

`drive.file` 允许扩展管理自己创建的文件，以及用户明确授权给该应用的文件。它不等于读取整个 Google Drive。Chrome 缓存短期访问令牌；BrainHub Capture 不把令牌写入 `chrome.storage`。
