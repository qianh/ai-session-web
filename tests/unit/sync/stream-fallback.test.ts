import { describe, expect, it, vi } from "vitest";

import type { StreamTurnCapture } from "../../../src/bridge/stream-capture";
import { SessionPipeline } from "../../../src/sync/pipeline";
import { buildStreamFallbackSession } from "../../../src/sync/stream-fallback";

const capture: StreamTurnCapture = {
  conversationId: "conversation-1",
  userText: "token sk-12345678901234567890",
  assistantText: "answer",
  observedAt: "2026-07-20T01:02:03.000Z",
  sourceUrl: "https://grok.com/c/conversation-1",
};

describe("buildStreamFallbackSession", () => {
  it("builds a deterministic, explicitly partial session for every site", async () => {
    const expectedSources = {
      chatgpt: "chatgpt-web",
      claude: "claude-web",
      gemini: "gemini-web",
      grok: "grok-web",
    } as const;

    for (const [site, source] of Object.entries(expectedSources)) {
      const session = await buildStreamFallbackSession(
        site as keyof typeof expectedSources,
        capture,
        "device-test",
      );

      expect(session).toMatchObject({
        source,
        device: "device-test",
        title: "Partial stream capture: conversation-1",
        sourceUrl: capture.sourceUrl,
        startedAt: capture.observedAt,
        updatedAt: capture.observedAt,
        turns: [
          { role: "user", text: capture.userText, media: [] },
          { role: "assistant", text: capture.assistantText, media: [] },
        ],
        warnings: ["STREAM_FALLBACK_PARTIAL"],
      });
      expect(session.conversationId).toMatch(/^[a-f0-9]{64}-stream$/u);
    }
  });

  it("deduplicates repeated captures independently of observation time", async () => {
    const first = await buildStreamFallbackSession(
      "grok",
      capture,
      "device-test",
    );
    const repeated = await buildStreamFallbackSession(
      "grok",
      {
        ...capture,
        observedAt: "2026-07-20T01:02:05.000Z",
        sourceUrl: `${capture.sourceUrl}?utm_source=observer`,
      },
      "device-test",
    );

    expect(repeated.conversationId).toBe(first.conversationId);
  });

  it("passes fallback text through the normal redaction pipeline", async () => {
    const session = await buildStreamFallbackSession(
      "grok",
      capture,
      "device-test",
    );
    const pipeline = new SessionPipeline({
      archive: vi.fn(async (input) => ({ session: input, warnings: [] })),
    });

    const prepared = await pipeline.prepare(session);

    expect(prepared.markdown).toContain("STREAM_FALLBACK_PARTIAL");
    expect(prepared.markdown).toContain("[REDACTED]");
    expect(prepared.markdown).not.toContain("sk-12345678901234567890");
  });
});
