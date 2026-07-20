import { describe, expect, it, vi } from "vitest";

import { SessionPipeline } from "../../../src/sync/pipeline";

describe("SessionPipeline", () => {
  it("archives media, redacts text, and renders deterministic Markdown", async () => {
    const archive = vi.fn(async (session) => ({ session, warnings: [] }));
    const pipeline = new SessionPipeline(
      { archive },
      { internalDomains: ["corp.local"] },
    );

    const prepared = await pipeline.prepare({
      source: "grok-web",
      conversationId: "conversation-1",
      device: "device-test",
      startedAt: "2026-07-19T01:00:00.000Z",
      updatedAt: "2026-07-19T02:00:00.000Z",
      turns: [
        {
          role: "user",
          text: "token sk-12345678901234567890 at corp.local",
          media: [],
        },
      ],
      warnings: [],
    });

    expect(archive).toHaveBeenCalledOnce();
    expect(prepared.markdown).toContain("[REDACTED]");
    expect(prepared.markdown).not.toContain("sk-12345678901234567890");
    expect(prepared.markdown).toContain("redaction_count: 2");
  });

  it("archives with original URLs before redacting rendered metadata and fallbacks", async () => {
    const archive = vi.fn(async (session) => ({ session, warnings: [] }));
    const pipeline = new SessionPipeline({ archive });
    const originalUrl =
      "https://files.example.test/report.pdf?X-Amz-Signature=media-secret";

    const prepared = await pipeline.prepare({
      source: "claude-web",
      conversationId: "conversation-2",
      device: "device-test",
      title: "api_key=title-secret",
      sourceUrl:
        "https://claude.ai/chat/conversation-2?access_token=source-secret",
      startedAt: "2026-07-19T01:00:00.000Z",
      updatedAt: "2026-07-19T02:00:00.000Z",
      turns: [
        {
          role: "user",
          text: "password=turn-secret",
          media: [
            {
              kind: "attachment",
              name: "api_key=name-secret",
              url: originalUrl,
            },
          ],
        },
      ],
      warnings: [],
    });

    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "api_key=title-secret",
        turns: [
          expect.objectContaining({
            text: "password=turn-secret",
            media: [expect.objectContaining({ url: originalUrl })],
          }),
        ],
      }),
    );
    expect(JSON.stringify(prepared)).not.toMatch(
      /(?:title|source|turn|name|media)-secret/u,
    );
    expect(prepared.markdown).toContain("redaction_count: 5");
  });
});
