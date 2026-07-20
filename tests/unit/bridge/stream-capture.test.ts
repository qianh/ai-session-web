import { describe, expect, it } from "vitest";

import {
  ChatGptStreamAccumulator,
  GrokStreamAccumulator,
  parseClaudeStreamCapture,
  parseGeminiStreamCapture,
} from "../../../src/bridge/stream-capture";

function chatFrame(
  topicId: string,
  type: "conversation-turn-stream" | "conversation-turn-complete",
  payload: Record<string, unknown>,
): string {
  return JSON.stringify([
    {
      type: "message",
      topic_id: topicId,
      payload: { type, payload },
    },
  ]);
}

function encodedData(value: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(value)}\n\n`;
}

describe("ChatGptStreamAccumulator", () => {
  it("reconstructs the visible final turn from v1 delta frames", () => {
    const accumulator = new ChatGptStreamAccumulator({
      sourceUrl: "https://chatgpt.com/c/chat-1",
      now: () => "2026-07-20T01:02:03.000Z",
    });

    accumulator.push(
      chatFrame("topic-1", "conversation-turn-stream", {
        encoded_item: encodedData({
          type: "input_message",
          conversation_id: "chat-1",
          input_message: { content: { parts: ["question"] } },
        }),
      }),
    );
    accumulator.push(
      chatFrame("topic-1", "conversation-turn-stream", {
        encoded_item: encodedData(
          {
            c: 0,
            v: {
              message: {
                author: { role: "assistant" },
                channel: null,
                content: { content_type: "thoughts", parts: ["private"] },
              },
            },
          },
          "delta",
        ),
      }),
    );
    accumulator.push(
      chatFrame("topic-1", "conversation-turn-stream", {
        encoded_item: encodedData(
          {
            c: 1,
            v: {
              message: {
                author: { role: "assistant" },
                channel: "final",
                content: { content_type: "text", parts: ["hello"] },
              },
            },
          },
          "delta",
        ),
      }),
    );
    accumulator.push(
      chatFrame("topic-1", "conversation-turn-stream", {
        encoded_item: encodedData(
          {
            o: "patch",
            v: [
              {
                p: "/message/content/parts/0",
                o: "append",
                v: " world",
              },
            ],
          },
          "delta",
        ),
      }),
    );

    const capture = accumulator.push(
      chatFrame("topic-1", "conversation-turn-complete", {
        conversation_id: "chat-1",
      }),
    );

    expect(capture).toEqual({
      conversationId: "chat-1",
      userText: "question",
      assistantText: "hello world",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://chatgpt.com/c/chat-1",
    });
    expect(JSON.stringify(capture)).not.toContain("private");
  });

  it("rejects a capture whose source URL is not ChatGPT-owned", () => {
    const accumulator = new ChatGptStreamAccumulator({
      sourceUrl: "https://example.com/c/chat-1",
    });
    accumulator.push(
      chatFrame("topic-1", "conversation-turn-stream", {
        encoded_item: encodedData({
          type: "input_message",
          conversation_id: "chat-1",
          input_message: { content: { parts: ["question"] } },
        }),
      }),
    );
    accumulator.push(
      chatFrame("topic-1", "conversation-turn-stream", {
        encoded_item: encodedData(
          {
            c: 0,
            v: {
              message: {
                author: { role: "assistant" },
                channel: "final",
                content: { content_type: "text", parts: ["answer"] },
              },
            },
          },
          "delta",
        ),
      }),
    );

    expect(
      accumulator.push(
        chatFrame("topic-1", "conversation-turn-complete", {
          conversation_id: "chat-1",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("parseClaudeStreamCapture", () => {
  it("assembles prompt and text deltas from a same-origin completion", () => {
    const responseText = [
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "private" },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello" },
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: " world" },
      })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ].join("");

    expect(
      parseClaudeStreamCapture({
        requestUrl:
          "https://claude.ai/api/organizations/org-1/chat_conversations/claude-1/completion",
        requestBody: JSON.stringify({ prompt: "question" }),
        responseText,
        sourceUrl: "https://claude.ai/chat/claude-1",
        observedAt: "2026-07-20T01:02:03.000Z",
      }),
    ).toEqual({
      conversationId: "claude-1",
      userText: "question",
      assistantText: "hello world",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://claude.ai/chat/claude-1",
    });
  });
});

describe("parseGeminiStreamCapture", () => {
  it("decodes the nested StreamGenerate request and final wrb.fr payload", () => {
    const requestPayload: unknown[] = Array.from({ length: 92 }, () => null);
    requestPayload[0] = ["question"];
    const requestBody = new URLSearchParams({
      "f.req": JSON.stringify([null, JSON.stringify(requestPayload)]),
    }).toString();
    const responsePayload: unknown[] = Array.from({ length: 47 }, () => null);
    responsePayload[4] = [[null, ["answer"]]];
    responsePayload[39] = "gemini-1";
    const responseText = `)]}'\n\n${JSON.stringify([
      ["wrb.fr", null, JSON.stringify(responsePayload)],
    ])}\n`;

    expect(
      parseGeminiStreamCapture({
        requestUrl:
          "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?rt=c",
        requestBody,
        responseText,
        sourceUrl: "https://gemini.google.com/app/gemini-1",
        observedAt: "2026-07-20T01:02:03.000Z",
      }),
    ).toEqual({
      conversationId: "gemini-1",
      userText: "question",
      assistantText: "answer",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://gemini.google.com/app/gemini-1",
    });
  });
});

describe("GrokStreamAccumulator", () => {
  it("captures only the assistant response channel when it is persisted", () => {
    const accumulator = new GrokStreamAccumulator({
      sourceUrl: "https://grok.com/c/grok-1?rid=response-1",
      now: () => "2026-07-20T01:02:03.000Z",
    });

    accumulator.push(
      JSON.stringify({
        session_id: "session-1",
        event: {
          type: "conversation.item.added",
          item: {
            role: "user",
            x_grok: {
              input_chunks: [{ text: { text: "question" } }],
            },
          },
        },
      }),
    );
    accumulator.push(
      JSON.stringify({
        session_id: "session-1",
        event: { type: "response.created", response: { id: "response-1" } },
      }),
    );
    accumulator.push(
      JSON.stringify({
        session_id: "session-1",
        event: {
          type: "response.chunk",
          chunk: {
            text: {
              channel: "CHANNEL_ASSISTANT_NOTETAKER_HEADER",
              text: "private",
            },
          },
        },
      }),
    );
    for (const text of ["hello", " world"]) {
      accumulator.push(
        JSON.stringify({
          session_id: "session-1",
          event: {
            type: "response.chunk",
            chunk: {
              text: { channel: "CHANNEL_ASSISTANT_RESPONSE", text },
            },
          },
        }),
      );
    }

    const capture = accumulator.push(
      JSON.stringify({
        session_id: "session-1",
        event: {
          type: "response.persisted",
          response_id: "response-1",
          status: "ok",
        },
      }),
    );

    expect(capture).toEqual({
      conversationId: "grok-1",
      userText: "question",
      assistantText: "hello world",
      observedAt: "2026-07-20T01:02:03.000Z",
      sourceUrl: "https://grok.com/c/grok-1?rid=response-1",
    });
    expect(JSON.stringify(capture)).not.toContain("private");
  });

  it("resolves the conversation URL at completion time", () => {
    let currentUrl = "https://grok.com/";
    const accumulator = new GrokStreamAccumulator({
      sourceUrl: () => currentUrl,
      now: () => "2026-07-20T01:02:03.000Z",
    });
    accumulator.push(
      JSON.stringify({
        event: {
          type: "conversation.item.added",
          item: {
            role: "user",
            x_grok: { input_chunks: [{ text: { text: "question" } }] },
          },
        },
      }),
    );
    accumulator.push(JSON.stringify({ event: { type: "response.created" } }));
    accumulator.push(
      JSON.stringify({
        event: {
          type: "response.chunk",
          chunk: {
            text: { channel: "CHANNEL_ASSISTANT_RESPONSE", text: "answer" },
          },
        },
      }),
    );
    currentUrl = "https://grok.com/c/grok-2";

    expect(
      accumulator.push(
        JSON.stringify({ event: { type: "response.persisted" } }),
      ),
    ).toMatchObject({
      conversationId: "grok-2",
      sourceUrl: "https://grok.com/c/grok-2",
    });
  });
});
