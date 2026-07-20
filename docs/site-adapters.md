# 站点适配器与协议边界

以下边界于 2026-07-20 使用四个隔离测试对话核验。站点内部接口均为非公开接口，可能随时变化；实现按站点隔离，单站错误不会中止其他站点。

| 站点    | 主拉取                                            | 回答完成观察                                | 完成信号                     |
| ------- | ------------------------------------------------- | ------------------------------------------- | ---------------------------- |
| ChatGPT | `backend-api/conversations` + conversation detail | 旧版 conversation SSE；当前版共享 WebSocket | `conversation-turn-complete` |
| Claude  | organization conversation list/detail             | completion SSE                              | `message_stop` 后响应流结束  |
| Gemini  | `MaZiqc` list + `hNvQHb` detail                   | `StreamGenerate` 批处理流                   | 响应流结束                   |
| Grok    | conversations metadata/tree/load-responses        | 第一方 WebSocket                            | `response.persisted`         |

ChatGPT 当前的 `/backend-api/f/conversation` 只返回流接力信息，不能作为回答完成边界，因此不会在该响应结束时触发同步。Gemini 的 `ESY5D` 也只是生成握手；观察器等待后续 `StreamGenerate` 完成。

## 调度

- 每 30 分钟对所有已启用站点执行一次增量拉取。
- 首次启用默认全量补拉。
- 用户手动同步、定时同步和完成观察均按站点合并，四站可并行且互不阻断。
- 完成观察先加速主拉取。主拉取成功时丢弃内存捕获；主拉取失败且当前轮解析完整时，才上传一份带 `STREAM_FALLBACK_PARTIAL` 警告的降级会话。

## 降级捕获

- ChatGPT 与 Grok 从已核验的 WebSocket 事件重建当前轮；Claude 与 Gemini 从克隆的流式 `fetch` 响应重建，不改变页面原响应。
- 只接受可见的用户文本和最终助手回答。思考、推理摘要、notetaker 等非最终频道不会进入归档。
- 每个响应最多在内存缓冲 1 MiB，每段正文最多 512 KiB；超限或结构不完整时只发送完成信号，不发送正文。
- 页面消息和运行时消息都要求精确字段、受支持站点及同源 `sourceUrl`。Cookie、鉴权头与 OAuth 令牌不进入捕获对象。
- 降级会话以站点、原会话 ID 和问答正文的 SHA-256 生成稳定 ID，重复完成事件不会生成重复文件。

## 失败状态

- 权限缺失：`SITE_PERMISSION_REQUIRED`
- 没有已登录标签页：`SITE_TAB_REQUIRED`
- Claude Organization 未识别：`CLAUDE_ORG_REQUIRED`
- 列表或详情结构变化：`SITE_SCHEMA_CHANGED`

错误会写入该站点状态并显示 `!` 徽标。即使当前轮已通过降级路径归档，错误也不会被清除；其他站点继续调度，失败站点的水位不会推进。
