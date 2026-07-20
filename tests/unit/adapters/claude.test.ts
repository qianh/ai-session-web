import { describe, expect, it } from "vitest";

import {
  normalizeClaudeConversation,
  parseClaudeListPage,
} from "../../../src/adapters/claude";

describe("Claude adapter", () => {
  it("uses offset pagination", () => {
    expect(
      parseClaudeListPage(
        {
          data: [
            {
              uuid: "claude-1",
              name: "Test chat",
              created_at: "2026-07-19T01:00:00+00:00",
              updated_at: "2026-07-19T02:00:00+00:00",
            },
          ],
          has_more: true,
        },
        30,
      ),
    ).toMatchObject({ nextCursor: "31" });
  });

  it("keeps the active parent chain and visible tool output", () => {
    const session = normalizeClaudeConversation(
      {
        uuid: "claude-1",
        name: "Adapter test",
        created_at: "2026-07-19T01:00:00+00:00",
        updated_at: "2026-07-19T02:00:00+00:00",
        current_leaf_message_uuid: "assistant-final",
        chat_messages: [
          {
            uuid: "user",
            parent_message_uuid: "root",
            sender: "human",
            created_at: "2026-07-19T01:00:00+00:00",
            updated_at: "2026-07-19T01:00:00+00:00",
            text: "question",
            content: [{ type: "text", text: "question" }],
            attachments: [],
            files: [],
          },
          {
            uuid: "assistant-final",
            parent_message_uuid: "user",
            sender: "assistant",
            created_at: "2026-07-19T02:00:00+00:00",
            updated_at: "2026-07-19T02:00:00+00:00",
            text: "",
            content: [
              { type: "thinking", thinking: "hidden chain" },
              { type: "tool_use", name: "search", message: "Searching docs" },
              {
                type: "tool_result",
                name: "search",
                display_content: "Found one page",
              },
              {
                type: "text",
                text: "answer",
                citations: [{ title: "Docs", url: "https://example.com/docs" }],
              },
            ],
            attachments: [],
            files: [],
          },
          {
            uuid: "alternate",
            parent_message_uuid: "user",
            sender: "assistant",
            created_at: "2026-07-19T01:30:00+00:00",
            updated_at: "2026-07-19T01:30:00+00:00",
            text: "not active",
            content: [{ type: "text", text: "not active" }],
            attachments: [],
            files: [],
          },
        ],
      },
      { device: "Chrome", sourceUrl: "https://claude.ai/chat/claude-1" },
    );

    expect(session?.turns).toEqual([
      { role: "user", text: "question", media: [] },
      {
        role: "assistant",
        text: "Tool: search\nSearching docs\n\nTool result: search\nFound one page\n\nanswer\n\nSources:\n- [Docs](https://example.com/docs)",
        media: [],
      },
    ]);
  });

  it("skips a persisted conversation that has no messages", () => {
    expect(
      normalizeClaudeConversation(
        {
          uuid: "empty-claude-chat",
          name: "Empty chat",
          created_at: "2025-08-04T10:40:48.974352Z",
          updated_at: "2025-08-04T10:40:48.974352Z",
          is_temporary: false,
          chat_messages: [],
        },
        {
          device: "Chrome",
          sourceUrl: "https://claude.ai/chat/empty-claude-chat",
        },
      ),
    ).toBeUndefined();
  });
});
