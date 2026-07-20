import { describe, expect, it } from "vitest";

import {
  normalizeGrokConversation,
  parseGrokListPage,
} from "../../../src/adapters/grok";

describe("Grok adapter", () => {
  it("uses pageToken pagination", () => {
    expect(
      parseGrokListPage({
        conversations: [
          {
            conversationId: "grok-1",
            title: "Test chat",
            workspaceId: "workspace-1",
            createTime: "2026-07-19T01:00:00+00:00",
            modifyTime: "2026-07-19T02:00:00+00:00",
          },
        ],
        nextPageToken: "next-page",
      }),
    ).toEqual({
      items: [
        {
          conversationId: "grok-1",
          title: "Test chat",
          workspaceId: "workspace-1",
          startedAt: "2026-07-19T01:00:00.000Z",
          updatedAt: "2026-07-19T02:00:00.000Z",
        },
      ],
      nextCursor: "next-page",
    });
  });

  it("chooses the newest leaf and walks its parent chain", () => {
    const session = normalizeGrokConversation(
      {
        conversation: {
          conversationId: "grok-1",
          title: "Adapter test",
          createTime: "2026-07-19T01:00:00+00:00",
          modifyTime: "2026-07-19T03:00:00+00:00",
        },
        responseNodes: [
          { responseId: "user", sender: "human", parentResponseId: "root" },
          { responseId: "old", sender: "assistant", parentResponseId: "user" },
          {
            responseId: "active",
            sender: "assistant",
            parentResponseId: "user",
          },
        ],
        responses: [
          {
            responseId: "user",
            sender: "human",
            parentResponseId: "root",
            message: "question",
            createTime: "2026-07-19T01:00:00+00:00",
          },
          {
            responseId: "old",
            sender: "assistant",
            parentResponseId: "user",
            message: "not active",
            createTime: "2026-07-19T02:00:00+00:00",
          },
          {
            responseId: "active",
            sender: "assistant",
            parentResponseId: "user",
            message: "answer",
            createTime: "2026-07-19T03:00:00+00:00",
            generatedImageUrls: ["https://example.com/image.png"],
            citedWebSearchResults: [
              { title: "Docs", url: "https://example.com/docs" },
            ],
          },
        ],
      },
      { device: "Chrome", sourceUrl: "https://grok.com/c/grok-1" },
    );

    expect(session.turns).toEqual([
      { role: "user", text: "question", media: [] },
      {
        role: "assistant",
        text: "answer\n\nSources:\n- [Docs](https://example.com/docs)",
        media: [{ kind: "image", url: "https://example.com/image.png" }],
      },
    ]);
  });
});
