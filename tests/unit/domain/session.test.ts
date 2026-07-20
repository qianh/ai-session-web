import { describe, expect, it } from "vitest";

import {
  NormalizedSessionSchema,
  WEB_SESSION_SOURCES,
} from "../../../src/domain/session";

describe("NormalizedSessionSchema", () => {
  it("accepts visible web turns and downloadable media metadata", () => {
    const session = NormalizedSessionSchema.parse({
      source: "chatgpt-web",
      conversationId: "conversation-1",
      device: "web-personal",
      title: "OAuth design",
      workspaceId: "personal",
      sourceUrl: "https://chatgpt.com/c/conversation-1",
      startedAt: "2026-07-19T10:00:00.000Z",
      updatedAt: "2026-07-19T10:05:00.000Z",
      turns: [
        {
          role: "user",
          text: "Review the attachment",
          media: [
            {
              kind: "attachment",
              url: "https://chatgpt.com/backend-api/files/file-1",
              name: "design.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          ],
        },
        { role: "assistant", text: "Reviewed.", media: [] },
      ],
      warnings: [],
    });

    expect(session.turns).toHaveLength(2);
    expect(session.turns[0]?.media[0]?.name).toBe("design.pdf");
  });

  it("supports exactly the four agreed web sources", () => {
    expect(WEB_SESSION_SOURCES).toEqual([
      "claude-web",
      "chatgpt-web",
      "gemini-web",
      "grok-web",
    ]);
    expect(() =>
      NormalizedSessionSchema.parse({
        source: "grok-x",
        conversationId: "1",
        device: "web-personal",
        startedAt: "2026-07-19T10:00:00.000Z",
        updatedAt: "2026-07-19T10:00:00.000Z",
        turns: [{ role: "assistant", text: "hidden", media: [] }],
        warnings: [],
      }),
    ).toThrow();
  });

  it("rejects hidden roles and reversed timestamps", () => {
    expect(() =>
      NormalizedSessionSchema.parse({
        source: "claude-web",
        conversationId: "1",
        device: "web-personal",
        startedAt: "2026-07-19T10:05:00.000Z",
        updatedAt: "2026-07-19T10:00:00.000Z",
        turns: [{ role: "reasoning", text: "private", media: [] }],
        warnings: [],
      }),
    ).toThrow();
  });
});
