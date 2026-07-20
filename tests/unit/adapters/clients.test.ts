import { describe, expect, it, vi } from "vitest";

import type { SitePageTransport } from "../../../src/bridge/page-transport";
import {
  ChatGptAdapter,
  ClaudeAdapter,
  GeminiAdapter,
  GrokAdapter,
} from "../../../src/adapters/clients";

function batch(rpcId: string, payload: unknown): string {
  return `)]}'\n${JSON.stringify([
    [["wrb.fr", rpcId, JSON.stringify(payload), null, null, null, "generic"]],
  ])}`;
}

describe("site clients", () => {
  it("uses ChatGPT list and detail endpoints", async () => {
    const send = vi.fn(async (_site: string, request: { path?: string }) => {
      if (request.path?.startsWith("/backend-api/conversations?")) {
        return { items: [], total: 0, limit: 28, offset: 0 };
      }
      return {
        conversation_id: "chat-1",
        create_time: 1,
        update_time: 2,
        current_node: "assistant",
        mapping: {
          assistant: {
            id: "assistant",
            parent: null,
            children: [],
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["answer"] },
            },
          },
        },
      };
    });
    const adapter = new ChatGptAdapter({ send } as SitePageTransport, "Chrome");

    await expect(adapter.listPage()).resolves.toEqual({
      items: [],
      nextCursor: "1:0",
      nextGroupCursor: "1:0",
      globallyOrdered: false,
    });
    await expect(adapter.listPage("1:0")).resolves.toEqual({
      items: [],
      nextCursor: "2:0",
      nextGroupCursor: "2:0",
      globallyOrdered: false,
    });
    await expect(adapter.listPage("2:0")).resolves.toEqual({
      items: [],
      nextCursor: "3:0",
      nextGroupCursor: "3:0",
      globallyOrdered: false,
    });
    await expect(adapter.listPage("3:0")).resolves.toEqual({
      items: [],
      globallyOrdered: false,
    });
    const listPaths = send.mock.calls
      .map(([, request]) => request.path)
      .filter((path) => path?.startsWith("/backend-api/conversations?"));
    expect(
      listPaths.map((path) =>
        new URL(path!, "https://chatgpt.com").searchParams.get("is_archived"),
      ),
    ).toEqual(["false", "false", "true", "true"]);
    expect(
      listPaths.map((path) =>
        new URL(path!, "https://chatgpt.com").searchParams.get("is_starred"),
      ),
    ).toEqual(["false", "true", "false", "true"]);
    await expect(
      adapter.getConversation({
        conversationId: "chat-1",
        startedAt: new Date(1000).toISOString(),
        updatedAt: new Date(2000).toISOString(),
      }),
    ).resolves.toMatchObject({
      source: "chatgpt-web",
      conversationId: "chat-1",
    });
    expect(send).toHaveBeenLastCalledWith(
      "chatgpt",
      expect.objectContaining({ path: "/backend-api/conversation/chat-1" }),
    );
  });

  it("uses Claude organization offset pagination", async () => {
    const send = vi.fn(async (site: string, request: { path?: string }) => {
      expect(site).toBe("claude");
      expect(request.path).toBeDefined();
      return {
        data: [],
        has_more: false,
      };
    });
    const adapter = new ClaudeAdapter(
      { send } as SitePageTransport,
      "Chrome",
      "org-1",
    );

    await expect(adapter.listPage("30")).resolves.toEqual({
      items: [],
      nextCursor: "1:0",
      nextGroupCursor: "1:0",
      globallyOrdered: false,
    });
    await expect(adapter.listPage("1:0")).resolves.toEqual({
      items: [],
      globallyOrdered: false,
    });
    expect(send).toHaveBeenCalledWith(
      "claude",
      expect.objectContaining({
        path: expect.stringContaining(
          "/api/organizations/org-1/chat_conversations_v2?",
        ),
      }),
    );
    expect(send.mock.calls[0]?.[1].path).toContain("offset=30");
    expect(
      new URL(
        send.mock.calls[0]?.[1].path ?? "",
        "https://claude.ai",
      ).searchParams.get("starred"),
    ).toBe("false");
    expect(
      new URL(
        send.mock.calls[1]?.[1].path ?? "",
        "https://claude.ai",
      ).searchParams.get("starred"),
    ).toBe("true");
  });

  it("uses Gemini MaZiqc and hNvQHb RPC payloads", async () => {
    const detailPayload = [
      [
        [
          ["gemini-1", "Test"],
          null,
          [["question"]],
          [[["answer-id", ["answer"]]], null, null, "answer-id"],
          [1, 0],
        ],
      ],
      null,
      null,
      [],
    ];
    const send = vi.fn(async (_site: string, request: { rpcId?: string }) =>
      request.rpcId === "MaZiqc"
        ? batch("MaZiqc", [null, null, []])
        : batch("hNvQHb", detailPayload),
    );
    const adapter = new GeminiAdapter({ send } as SitePageTransport, "Chrome");

    await expect(adapter.listPage()).resolves.toEqual({ items: [] });
    await expect(
      adapter.getConversation({
        conversationId: "gemini-1",
        startedAt: new Date(1000).toISOString(),
        updatedAt: new Date(2000).toISOString(),
      }),
    ).resolves.toMatchObject({
      source: "gemini-web",
      conversationId: "gemini-1",
    });
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      rpcId: "MaZiqc",
      payload: [20, null, [0, null, 1]],
    });
    expect(send.mock.calls[1]?.[1]).toMatchObject({
      rpcId: "hNvQHb",
      payload: ["gemini-1", 10, null, 1, [1], [4], null, 1],
    });
  });

  it("loads Grok metadata, response tree, then active response bodies", async () => {
    const send = vi.fn(
      async (_site: string, request: { path?: string; body?: unknown }) => {
        if (request.path?.includes("conversations_v2")) {
          return {
            conversation: {
              conversationId: "grok-1",
              createTime: "2026-07-19T01:00:00Z",
              modifyTime: "2026-07-19T02:00:00Z",
            },
          };
        }
        if (request.path?.endsWith("response-node")) {
          return {
            responseNodes: [
              { responseId: "user", sender: "human", parentResponseId: "root" },
              {
                responseId: "answer",
                sender: "assistant",
                parentResponseId: "user",
              },
            ],
          };
        }
        expect(request.body).toEqual({ responseIds: ["user", "answer"] });
        return {
          responses: [
            {
              responseId: "user",
              sender: "human",
              parentResponseId: "root",
              message: "question",
              createTime: "2026-07-19T01:00:00Z",
            },
            {
              responseId: "answer",
              sender: "assistant",
              parentResponseId: "user",
              message: "answer",
              createTime: "2026-07-19T02:00:00Z",
            },
          ],
        };
      },
    );
    const adapter = new GrokAdapter({ send } as SitePageTransport, "Chrome");

    await expect(
      adapter.getConversation({
        conversationId: "grok-1",
        startedAt: "2026-07-19T01:00:00.000Z",
        updatedAt: "2026-07-19T02:00:00.000Z",
      }),
    ).resolves.toMatchObject({ source: "grok-web", conversationId: "grok-1" });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
