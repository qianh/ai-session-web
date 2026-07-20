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

const SITE = "chatgpt";

export function parseChatGptListPage(value: unknown): ConversationPage {
  const root = requireRecord(SITE, value, "list response");
  if (!Array.isArray(root.items))
    throw new AdapterSchemaError(SITE, "items is not an array");
  const items = root.items.map((candidate, index) => {
    const item = requireRecord(SITE, candidate, `items[${index}]`);
    const startedAt = toIso(item.create_time);
    const summary = {
      conversationId: requireString(SITE, item.id, `items[${index}].id`),
      startedAt,
      updatedAt: toIso(item.update_time, startedAt),
    } as ConversationPage["items"][number];
    const title = optionalString(item.title);
    const workspaceId = optionalString(item.workspace_id);
    if (title) summary.title = title;
    if (workspaceId) summary.workspaceId = workspaceId;
    return summary;
  });
  const offset = typeof root.offset === "number" ? root.offset : 0;
  const limit = typeof root.limit === "number" ? root.limit : items.length;
  const total =
    typeof root.total === "number" ? root.total : offset + items.length;
  const next = offset + limit;
  return next < total ? { items, nextCursor: String(next) } : { items };
}

export function normalizeChatGptConversation(
  value: unknown,
  context: NormalizeContext,
): NormalizedSession {
  const root = requireRecord(SITE, value, "conversation");
  const conversationId = requireString(
    SITE,
    root.conversation_id,
    "conversation_id",
  );
  const mapping = requireRecord(SITE, root.mapping, "mapping");
  let nodeId: string | undefined = requireString(
    SITE,
    root.current_node,
    "current_node",
  );
  const path: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = requireRecord(SITE, mapping[nodeId], `mapping.${nodeId}`);
    path.push(node);
    nodeId = optionalString(node.parent);
  }
  path.reverse();

  const turns = path.flatMap((node) => {
    if (!isRecord(node.message)) return [];
    const message = node.message;
    const author = isRecord(message.author) ? message.author : {};
    const authorRole = optionalString(author.role);
    if (
      authorRole !== "user" &&
      authorRole !== "assistant" &&
      authorRole !== "tool"
    ) {
      return [];
    }
    const content = isRecord(message.content) ? message.content : {};
    const contentType = optionalString(content.content_type);
    if (contentType === "thoughts" || contentType === "reasoning_recap")
      return [];
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    if (metadata.is_visually_hidden_from_conversation === true) return [];
    const extracted = extractChatGptContent(content);
    const references = sourceList(metadata.content_references);
    const text = joinVisible([extracted.text, references]);
    if (!text && extracted.media.length === 0) return [];
    return [
      {
        role:
          authorRole === "user" ? ("user" as const) : ("assistant" as const),
        text,
        media: extracted.media,
      },
    ];
  });
  if (turns.length === 0)
    throw new AdapterSchemaError(SITE, "active branch has no visible turns");

  const startedAt = toIso(root.create_time);
  const session: NormalizedSession = {
    source: "chatgpt-web",
    conversationId,
    device: context.device,
    startedAt,
    updatedAt: toIso(root.update_time, startedAt),
    turns,
    warnings: [],
  };
  const title = optionalString(root.title);
  const workspaceId = context.workspaceId ?? optionalString(root.workspace_id);
  if (title) session.title = title;
  if (workspaceId) session.workspaceId = workspaceId;
  if (context.sourceUrl) session.sourceUrl = context.sourceUrl;
  return NormalizedSessionSchema.parse(session);
}

function extractChatGptContent(content: Record<string, unknown>): {
  text: string;
  media: MediaRef[];
} {
  const text: string[] = [];
  const media: MediaRef[] = [];
  const parts = Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    if (typeof part === "string") {
      text.push(part);
      continue;
    }
    if (!isRecord(part)) continue;
    const partText = optionalString(part.text) ?? optionalString(part.content);
    if (partText) text.push(partText);
    const url =
      optionalString(part.asset_pointer) ??
      (isRecord(part.image_url)
        ? optionalString(part.image_url.url)
        : undefined) ??
      optionalString(part.url);
    const kind = String(part.content_type ?? "").includes("image")
      ? "image"
      : "attachment";
    const ref = mediaRef(kind, url, {
      name: part.name,
      mimeType: part.mime_type,
      sizeBytes: part.size_bytes,
    });
    if (ref) media.push(ref);
  }
  const directText =
    optionalString(content.text) ?? optionalString(content.content);
  if (parts.length === 0 && directText) text.push(directText);
  return { text: text.join("\n\n"), media: uniqueMedia(media) };
}
