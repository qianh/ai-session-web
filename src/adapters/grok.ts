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

const SITE = "grok";

export function parseGrokListPage(value: unknown): ConversationPage {
  const root = requireRecord(SITE, value, "list response");
  if (!Array.isArray(root.conversations)) {
    throw new AdapterSchemaError(SITE, "conversations is not an array");
  }
  const items = root.conversations.map((candidate, index) => {
    const item = requireRecord(SITE, candidate, `conversations[${index}]`);
    const startedAt = toIso(item.createTime);
    const summary = {
      conversationId: requireString(
        SITE,
        item.conversationId,
        `conversations[${index}].conversationId`,
      ),
      startedAt,
      updatedAt: toIso(item.modifyTime, startedAt),
    } as ConversationPage["items"][number];
    const title = optionalString(item.title);
    const workspaceId =
      optionalString(item.workspaceId) ?? optionalString(item.workspace_id);
    if (title) summary.title = title;
    if (workspaceId) summary.workspaceId = workspaceId;
    return summary;
  });
  const cursor = optionalString(root.nextPageToken);
  return cursor ? { items, nextCursor: cursor } : { items };
}

export function normalizeGrokConversation(
  value: unknown,
  context: NormalizeContext & { selectedLeafId?: string },
): NormalizedSession {
  const root = requireRecord(SITE, value, "conversation bundle");
  const conversation = requireRecord(SITE, root.conversation, "conversation");
  if (!Array.isArray(root.responseNodes) || !Array.isArray(root.responses)) {
    throw new AdapterSchemaError(
      SITE,
      "responseNodes or responses is not an array",
    );
  }
  const nodes = new Map<string, Record<string, unknown>>();
  const parentIds = new Set<string>();
  for (const [index, candidate] of root.responseNodes.entries()) {
    const node = requireRecord(SITE, candidate, `responseNodes[${index}]`);
    const id = requireString(
      SITE,
      node.responseId,
      `responseNodes[${index}].responseId`,
    );
    nodes.set(id, node);
    const parent = optionalString(node.parentResponseId);
    if (parent) parentIds.add(parent);
  }
  const responses = new Map<string, Record<string, unknown>>();
  for (const [index, candidate] of root.responses.entries()) {
    const response = requireRecord(SITE, candidate, `responses[${index}]`);
    responses.set(
      requireString(
        SITE,
        response.responseId,
        `responses[${index}].responseId`,
      ),
      response,
    );
  }
  const leaves = [...nodes.keys()].filter((id) => !parentIds.has(id));
  let leafId =
    context.selectedLeafId && nodes.has(context.selectedLeafId)
      ? context.selectedLeafId
      : newestLeaf(leaves, responses);
  if (!leafId) throw new AdapterSchemaError(SITE, "response tree has no leaf");
  const path: string[] = [];
  const seen = new Set<string>();
  while (leafId && !seen.has(leafId)) {
    seen.add(leafId);
    path.push(leafId);
    leafId = optionalString(nodes.get(leafId)?.parentResponseId) ?? "";
  }
  path.reverse();
  const turns = path.flatMap((id) => {
    const response = responses.get(id);
    if (!response) return [];
    const sender = optionalString(response.sender);
    if (sender !== "human" && sender !== "assistant") return [];
    const message =
      optionalString(response.message) ?? optionalString(response.query) ?? "";
    const sources =
      sender === "assistant" ? sourceList(response.citedWebSearchResults) : "";
    const media = collectGrokMedia(response);
    const text = joinVisible([message, sources]);
    if (!text && media.length === 0) return [];
    return [
      {
        role: sender === "human" ? ("user" as const) : ("assistant" as const),
        text,
        media,
      },
    ];
  });
  if (turns.length === 0)
    throw new AdapterSchemaError(SITE, "active branch has no visible turns");

  const conversationId = requireString(
    SITE,
    conversation.conversationId,
    "conversationId",
  );
  const startedAt = toIso(conversation.createTime);
  const session: NormalizedSession = {
    source: "grok-web",
    conversationId,
    device: context.device,
    startedAt,
    updatedAt: toIso(conversation.modifyTime, startedAt),
    turns,
    warnings: [],
  };
  const title = optionalString(conversation.title);
  if (title) session.title = title;
  if (context.workspaceId) session.workspaceId = context.workspaceId;
  if (context.sourceUrl) session.sourceUrl = context.sourceUrl;
  return NormalizedSessionSchema.parse(session);
}

function newestLeaf(
  leaves: string[],
  responses: Map<string, Record<string, unknown>>,
): string | undefined {
  return leaves.sort((left, right) => {
    const leftTime =
      Date.parse(optionalString(responses.get(left)?.createTime) ?? "") || 0;
    const rightTime =
      Date.parse(optionalString(responses.get(right)?.createTime) ?? "") || 0;
    return rightTime - leftTime;
  })[0];
}

function collectGrokMedia(response: Record<string, unknown>): MediaRef[] {
  const media: MediaRef[] = [];
  for (const url of Array.isArray(response.generatedImageUrls)
    ? response.generatedImageUrls
    : []) {
    const ref = mediaRef("image", url);
    if (ref) media.push(ref);
  }
  for (const field of [
    "imageAttachments",
    "fileAttachments",
    "fileAttachmentsMetadata",
  ] as const) {
    for (const value of Array.isArray(response[field]) ? response[field] : []) {
      if (!isRecord(value)) continue;
      const kind = field === "imageAttachments" ? "image" : "attachment";
      const ref = mediaRef(
        kind,
        value.url ?? value.downloadUrl ?? value.fileUrl ?? value.uri,
        {
          name: value.name ?? value.fileName,
          mimeType: value.mimeType ?? value.mime_type,
          sizeBytes: value.sizeBytes ?? value.size,
        },
      );
      if (ref) media.push(ref);
    }
  }
  for (const url of Array.isArray(response.fileUris) ? response.fileUris : []) {
    const ref = mediaRef("attachment", url);
    if (ref) media.push(ref);
  }
  return uniqueMedia(media);
}
