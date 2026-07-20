import { describe, expect, it } from "vitest";

import {
  normalizeChatGptConversation,
  parseChatGptListPage,
} from "../../../src/adapters/chatgpt";

describe("ChatGPT adapter", () => {
  it("parses list pagination", () => {
    expect(
      parseChatGptListPage({
        items: [
          {
            id: "chat-1",
            title: "Test chat",
            create_time: "2026-07-19T01:00:00+00:00",
            update_time: "2026-07-19T02:00:00+00:00",
            workspace_id: null,
          },
        ],
        total: 2,
        limit: 1,
        offset: 0,
      }),
    ).toEqual({
      items: [
        {
          conversationId: "chat-1",
          title: "Test chat",
          startedAt: "2026-07-19T01:00:00.000Z",
          updatedAt: "2026-07-19T02:00:00.000Z",
        },
      ],
      nextCursor: "1",
    });
  });

  it("walks current_node and excludes hidden reasoning", () => {
    const session = normalizeChatGptConversation(
      {
        conversation_id: "chat-1",
        title: "Adapter test",
        create_time: 1_752_888_000,
        update_time: 1_752_891_600,
        current_node: "final",
        mapping: {
          root: { id: "root", parent: null, children: ["user"], message: null },
          user: {
            id: "user",
            parent: "root",
            children: ["thoughts", "alternate"],
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: ["hello"] },
            },
          },
          thoughts: {
            id: "thoughts",
            parent: "user",
            children: ["final"],
            message: {
              author: { role: "assistant" },
              content: { content_type: "thoughts", thoughts: ["hidden"] },
            },
          },
          final: {
            id: "final",
            parent: "thoughts",
            children: [],
            message: {
              author: { role: "assistant" },
              channel: "final",
              content: { content_type: "text", parts: ["visible answer"] },
              metadata: {
                content_references: [
                  { title: "Example", url: "https://example.com/source" },
                ],
              },
            },
          },
          alternate: {
            id: "alternate",
            parent: "user",
            children: [],
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["not active"] },
            },
          },
        },
      },
      { device: "Chrome", sourceUrl: "https://chatgpt.com/c/chat-1" },
    );

    expect(session.turns).toEqual([
      { role: "user", text: "hello", media: [] },
      {
        role: "assistant",
        text: "visible answer\n\nSources:\n- [Example](https://example.com/source)",
        media: [],
      },
    ]);
  });
});
