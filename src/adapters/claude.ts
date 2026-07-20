import {
  NormalizedSessionSchema,
  type MediaRef,
  type NormalizedSession,
} from "../domain/session";
import {
  AdapterSchemaError,
  type ConversationPage,
  type NormalizeContext,
  isRecord,
  joinVisible,
  mediaRef,
  optionalString,
  requireRecord,
  requireString,
  sourceList,
  toIso,
  uniqueMedia,
} from "./shared";

const SITE = "claude";

export function parseClaudeListPage(
  value: unknown,
  offset: number,
): ConversationPage {
  const root = requireRecord(SITE, value, "list response");
  if (!Array.isArray(root.data))
    throw new AdapterSchemaError(SITE, "data is not an array");
  const items = root.data.map((candidate, index) => {
    const item = requireRecord(SITE, candidate, `data[${index}]`);
    const startedAt = toIso(item.created_at);
    const summary = {
      conversationId: requireString(SITE, item.uuid, `data[${index}].uuid`),
      startedAt,
      updatedAt: toIso(item.updated_at, startedAt),
    } as ConversationPage["items"][number];
    const title = optionalString(item.name);
    const workspaceId = optionalString(item.project_uuid);
    if (title) summary.title = title;
    if (workspaceId) summary.workspaceId = workspaceId;
    return summary;
  });
  return root.has_more === true
    ? { items, nextCursor: String(offset + items.length) }
    : { items };
}

export function normalizeClaudeConversation(
  value: unknown,
  context: NormalizeContext,
): NormalizedSession | undefined {
  const root = requireRecord(SITE, value, "conversation");
  if (!Array.isArray(root.chat_messages)) {
    throw new AdapterSchemaError(SITE, "chat_messages is not an array");
  }
  if (root.chat_messages.length === 0) return undefined;
  const messages = new Map<string, Record<string, unknown>>();
  for (const [index, candidate] of root.chat_messages.entries()) {
    const message = requireRecord(SITE, candidate, `chat_messages[${index}]`);
    messages.set(
      requireString(SITE, message.uuid, `chat_messages[${index}].uuid`),
      message,
    );
  }
  let messageId: string | undefined = requireString(
    SITE,
    root.current_leaf_message_uuid,
    "current_leaf_message_uuid",
  );
  const active: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  while (messageId && !seen.has(messageId)) {
    seen.add(messageId);
    const message = messages.get(messageId);
    if (!message) break;
    active.push(message);
    messageId = optionalString(message.parent_message_uuid);
  }
  active.reverse();
  const turns = active.flatMap((message) => {
    const sender = optionalString(message.sender);
    if (sender !== "human" && sender !== "assistant") return [];
    const rendered = renderClaudeMessage(message);
    if (!rendered.text && rendered.media.length === 0) return [];
    return [
      {
        role: sender === "human" ? ("user" as const) : ("assistant" as const),
        ...rendered,
      },
    ];
  });
  if (turns.length === 0)
    throw new AdapterSchemaError(SITE, "active branch has no visible turns");

  const conversationId = requireString(SITE, root.uuid, "uuid");
  const startedAt = toIso(root.created_at);
  const session: NormalizedSession = {
    source: "claude-web",
    conversationId,
    device: context.device,
    startedAt,
    updatedAt: toIso(root.updated_at, startedAt),
    turns,
    warnings: [],
  };
  const title = optionalString(root.name);
  if (title) session.title = title;
  if (context.workspaceId) session.workspaceId = context.workspaceId;
  if (context.sourceUrl) session.sourceUrl = context.sourceUrl;
  return NormalizedSessionSchema.parse(session);
}

function renderClaudeMessage(message: Record<string, unknown>): {
  text: string;
  media: MediaRef[];
} {
  const parts: string[] = [];
  const media: MediaRef[] = [];
  const blocks = Array.isArray(message.content) ? message.content : [];
  for (const candidate of blocks) {
    if (!isRecord(candidate)) continue;
    const type = optionalString(candidate.type);
    if (type === "thinking") continue;
    if (type === "text") {
      parts.push(
        joinVisible([
          optionalString(candidate.text),
          sourceList(candidate.citations),
        ]),
      );
      continue;
    }
    if (type === "tool_use" || type === "tool_result") {
      const label = type === "tool_use" ? "Tool" : "Tool result";
      const name = optionalString(candidate.name);
      const visible = firstVisibleString(
        candidate.display_content,
        candidate.message,
        candidate.content,
      );
      parts.push(
        visible
          ? `${label}${name ? `: ${name}` : ""}\n${visible.trim()}`
          : `${label}${name ? `: ${name}` : ""}`,
      );
    }
  }
  if (parts.length === 0) {
    const fallback = optionalString(message.text);
    if (fallback) parts.push(fallback);
  }
  for (const field of ["attachments", "files", "sync_sources"] as const) {
    const values = Array.isArray(message[field]) ? message[field] : [];
    for (const value of values) {
      if (!isRecord(value)) continue;
      const url =
        optionalString(value.url) ??
        optionalString(value.download_url) ??
        optionalString(value.preview_url);
      const mimeType =
        optionalString(value.mime_type) ?? optionalString(value.file_type);
      const kind =
        mimeType?.startsWith("image/") ||
        (field === "attachments" && value.type === "image")
          ? "image"
          : "attachment";
      const ref = mediaRef(kind, url, {
        name: value.file_name ?? value.name,
        mimeType,
        sizeBytes: value.file_size ?? value.size,
      });
      if (ref) media.push(ref);
    }
  }
  return {
    text: parts.filter(Boolean).join("\n\n"),
    media: uniqueMedia(media),
  };
}

function firstVisibleString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (isRecord(value)) {
      const text = optionalString(value.text) ?? optionalString(value.content);
      if (text) return text;
    }
  }
  return undefined;
}
