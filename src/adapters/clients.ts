import type { SitePageTransport } from "../bridge/page-transport";
import type { NormalizedSession, WebSessionSource } from "../domain/session";
import { normalizeChatGptConversation, parseChatGptListPage } from "./chatgpt";
import { normalizeClaudeConversation, parseClaudeListPage } from "./claude";
import {
  decodeGeminiBatchResponse,
  normalizeGeminiConversation,
  parseGeminiListPayload,
} from "./gemini";
import { normalizeGrokConversation, parseGrokListPage } from "./grok";
import {
  AdapterSchemaError,
  type ConversationPage,
  type ConversationSummary,
  isRecord,
} from "./shared";

export interface BrowserSiteAdapter {
  readonly source: WebSessionSource;
  listPage(cursor?: string): Promise<ConversationPage>;
  getConversation(
    summary: ConversationSummary,
  ): Promise<NormalizedSession | undefined>;
}

export class ChatGptAdapter implements BrowserSiteAdapter {
  readonly source = "chatgpt-web" as const;

  constructor(
    private readonly transport: SitePageTransport,
    private readonly device: string,
  ) {}

  async listPage(cursor?: string): Promise<ConversationPage> {
    const { filterIndex, offset } = parseChatGptCursor(cursor);
    const filter = CHATGPT_LIST_FILTERS[filterIndex];
    if (!filter)
      throw new AdapterSchemaError("chatgpt", "filter cursor is invalid");
    const query = new URLSearchParams({
      offset: String(offset),
      limit: "28",
      order: "updated",
      is_archived: String(filter.archived),
      is_starred: String(filter.starred),
    });
    const page = parseChatGptListPage(
      await this.transport.send("chatgpt", {
        kind: "chatgpt-api",
        path: `/backend-api/conversations?${query}`,
      }),
    );
    const nextGroupCursor =
      filterIndex + 1 < CHATGPT_LIST_FILTERS.length
        ? `${filterIndex + 1}:0`
        : undefined;
    const nextCursor = page.nextCursor
      ? `${filterIndex}:${page.nextCursor}`
      : nextGroupCursor;
    return {
      items: page.items,
      globallyOrdered: false,
      ...(nextCursor ? { nextCursor } : {}),
      ...(nextGroupCursor ? { nextGroupCursor } : {}),
    };
  }

  async getConversation(
    summary: ConversationSummary,
  ): Promise<NormalizedSession> {
    const raw = await this.transport.send("chatgpt", {
      kind: "chatgpt-api",
      path: `/backend-api/conversation/${encodeURIComponent(summary.conversationId)}`,
    });
    return normalizeChatGptConversation(raw, {
      device: this.device,
      sourceUrl: `https://chatgpt.com/c/${summary.conversationId}`,
      ...(summary.workspaceId ? { workspaceId: summary.workspaceId } : {}),
    });
  }
}

const CHATGPT_LIST_FILTERS = [
  { archived: false, starred: false },
  { archived: false, starred: true },
  { archived: true, starred: false },
  { archived: true, starred: true },
] as const;

function parseChatGptCursor(cursor?: string): {
  filterIndex: number;
  offset: number;
} {
  if (cursor === undefined) return { filterIndex: 0, offset: 0 };
  const match = /^(\d+):(\d+)$/u.exec(cursor);
  if (!match) throw new AdapterSchemaError("chatgpt", "list cursor is invalid");
  const filterIndex = Number(match[1]);
  const offset = Number(match[2]);
  if (
    !Number.isInteger(filterIndex) ||
    filterIndex < 0 ||
    filterIndex >= CHATGPT_LIST_FILTERS.length ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new AdapterSchemaError("chatgpt", "list cursor is invalid");
  }
  return { filterIndex, offset };
}

export class ClaudeAdapter implements BrowserSiteAdapter {
  readonly source = "claude-web" as const;

  constructor(
    private readonly transport: SitePageTransport,
    private readonly device: string,
    private readonly organizationId: string,
  ) {
    if (!organizationId) throw new Error("Claude organization ID is required");
  }

  async listPage(cursor?: string): Promise<ConversationPage> {
    const { filterIndex, offset } = parseClaudeCursor(cursor);
    const starred = CLAUDE_STARRED_FILTERS[filterIndex];
    if (starred === undefined)
      throw new AdapterSchemaError("claude", "filter cursor is invalid");
    const query = new URLSearchParams({
      limit: "30",
      starred: String(starred),
      consistency: "eventual",
      ...(offset > 0 ? { offset: String(offset) } : {}),
    });
    const raw = await this.transport.send("claude", {
      kind: "site-api",
      site: "claude",
      path: `/api/organizations/${encodeURIComponent(this.organizationId)}/chat_conversations_v2?${query}`,
    });
    const page = parseClaudeListPage(raw, offset);
    const nextGroupCursor =
      filterIndex + 1 < CLAUDE_STARRED_FILTERS.length
        ? `${filterIndex + 1}:0`
        : undefined;
    const nextCursor = page.nextCursor
      ? `${filterIndex}:${page.nextCursor}`
      : nextGroupCursor;
    return {
      items: page.items,
      globallyOrdered: false,
      ...(nextCursor ? { nextCursor } : {}),
      ...(nextGroupCursor ? { nextGroupCursor } : {}),
    };
  }

  async getConversation(
    summary: ConversationSummary,
  ): Promise<NormalizedSession | undefined> {
    const query = new URLSearchParams({
      tree: "True",
      rendering_mode: "messages",
      render_all_tools: "true",
      consistency: "strong",
    });
    const raw = await this.transport.send("claude", {
      kind: "site-api",
      site: "claude",
      path: `/api/organizations/${encodeURIComponent(this.organizationId)}/chat_conversations/${encodeURIComponent(summary.conversationId)}?${query}`,
    });
    return normalizeClaudeConversation(raw, {
      device: this.device,
      sourceUrl: `https://claude.ai/chat/${summary.conversationId}`,
      ...(summary.workspaceId ? { workspaceId: summary.workspaceId } : {}),
    });
  }
}

const CLAUDE_STARRED_FILTERS = [false, true] as const;

function parseClaudeCursor(cursor?: string): {
  filterIndex: number;
  offset: number;
} {
  if (cursor === undefined) return { filterIndex: 0, offset: 0 };
  if (/^\d+$/u.test(cursor)) {
    const offset = Number(cursor);
    if (Number.isSafeInteger(offset) && offset >= 0) {
      return { filterIndex: 0, offset };
    }
    throw new AdapterSchemaError("claude", "list cursor is invalid");
  }
  const match = /^(\d+):(\d+)$/u.exec(cursor);
  if (!match) throw new AdapterSchemaError("claude", "list cursor is invalid");
  const filterIndex = Number(match[1]);
  const offset = Number(match[2]);
  if (
    !Number.isInteger(filterIndex) ||
    filterIndex < 0 ||
    filterIndex >= CLAUDE_STARRED_FILTERS.length ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new AdapterSchemaError("claude", "list cursor is invalid");
  }
  return { filterIndex, offset };
}

export class GeminiAdapter implements BrowserSiteAdapter {
  readonly source = "gemini-web" as const;

  constructor(
    private readonly transport: SitePageTransport,
    private readonly device: string,
  ) {}

  async listPage(cursor?: string): Promise<ConversationPage> {
    const raw = await this.transport.send("gemini", {
      kind: "gemini-rpc",
      rpcId: "MaZiqc",
      payload: [20, cursor ?? null, [0, null, 1]],
    });
    if (typeof raw !== "string") {
      throw new AdapterSchemaError("gemini", "MaZiqc response is not text");
    }
    return parseGeminiListPayload(decodeGeminiBatchResponse(raw, "MaZiqc"));
  }

  async getConversation(
    summary: ConversationSummary,
  ): Promise<NormalizedSession | undefined> {
    const raw = await this.transport.send("gemini", {
      kind: "gemini-rpc",
      rpcId: "hNvQHb",
      payload: [summary.conversationId, 10, null, 1, [1], [4], null, 1],
    });
    if (typeof raw !== "string") {
      throw new AdapterSchemaError("gemini", "hNvQHb response is not text");
    }
    return normalizeGeminiConversation(
      decodeGeminiBatchResponse(raw, "hNvQHb"),
      {
        device: this.device,
        conversationId: summary.conversationId,
        startedAt: summary.startedAt,
        updatedAt: summary.updatedAt,
        sourceUrl: `https://gemini.google.com/app/${summary.conversationId}`,
        ...(summary.workspaceId ? { workspaceId: summary.workspaceId } : {}),
      },
    );
  }
}

export class GrokAdapter implements BrowserSiteAdapter {
  readonly source = "grok-web" as const;

  constructor(
    private readonly transport: SitePageTransport,
    private readonly device: string,
  ) {}

  async listPage(cursor?: string): Promise<ConversationPage> {
    const query = new URLSearchParams({
      pageSize: "60",
      ...(cursor ? { pageToken: cursor } : {}),
    });
    return parseGrokListPage(
      await this.transport.send("grok", {
        kind: "site-api",
        site: "grok",
        path: `/rest/app-chat/conversations?${query}`,
      }),
    );
  }

  async getConversation(
    summary: ConversationSummary,
  ): Promise<NormalizedSession> {
    const id = encodeURIComponent(summary.conversationId);
    const [metadata, tree] = await Promise.all([
      this.transport.send("grok", {
        kind: "site-api",
        site: "grok",
        path: `/rest/app-chat/conversations_v2/${id}?includeWorkspaces=true&includeTaskResult=true`,
      }),
      this.transport.send("grok", {
        kind: "site-api",
        site: "grok",
        path: `/rest/app-chat/conversations/${id}/response-node`,
      }),
    ]);
    const metadataRoot = requireObject(metadata, "conversation metadata");
    const treeRoot = requireObject(tree, "response tree");
    const nodes = Array.isArray(treeRoot.responseNodes)
      ? treeRoot.responseNodes
      : [];
    const responseIds = nodes.flatMap((candidate) => {
      if (!isRecord(candidate) || typeof candidate.responseId !== "string")
        return [];
      return [candidate.responseId];
    });
    const loaded = await this.transport.send("grok", {
      kind: "site-api",
      site: "grok",
      path: `/rest/app-chat/conversations/${id}/load-responses`,
      method: "POST",
      body: { responseIds },
    });
    const loadedRoot = requireObject(loaded, "loaded responses");
    return normalizeGrokConversation(
      {
        conversation: metadataRoot.conversation,
        responseNodes: nodes,
        responses: loadedRoot.responses,
      },
      {
        device: this.device,
        sourceUrl: `https://grok.com/c/${summary.conversationId}`,
        ...(summary.workspaceId ? { workspaceId: summary.workspaceId } : {}),
      },
    );
  }
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value))
    throw new AdapterSchemaError("grok", `${field} is not an object`);
  return value;
}
