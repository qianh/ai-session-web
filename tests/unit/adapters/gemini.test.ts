import { describe, expect, it } from "vitest";

import {
  decodeGeminiBatchResponse,
  normalizeGeminiConversation,
  parseGeminiListPayload,
} from "../../../src/adapters/gemini";

function batched(rpcId: string, payload: unknown): string {
  return `)]}'\n${JSON.stringify([
    [["wrb.fr", rpcId, JSON.stringify(payload), null, null, null, "generic"]],
    ["di", 1],
    ["af.httprm", 0, "-1", 1],
  ])}\n`;
}

describe("Gemini adapter", () => {
  it("decodes batchexecute envelopes and cursor pages", () => {
    const payload = [
      null,
      "next-token",
      [
        [
          "gemini-1",
          "Test chat",
          null,
          null,
          null,
          [1_752_888_000, 0],
          null,
          null,
          null,
          1_752_891_600,
        ],
      ],
    ];
    expect(
      decodeGeminiBatchResponse(batched("MaZiqc", payload), "MaZiqc"),
    ).toEqual(payload);
    expect(parseGeminiListPayload(payload)).toEqual({
      items: [
        {
          conversationId: "gemini-1",
          title: "Test chat",
          startedAt: "2025-07-19T01:20:00.000Z",
          updatedAt: "2025-07-19T02:20:00.000Z",
        },
      ],
      nextCursor: "next-token",
    });
  });

  it("selects the active candidate and visible structured segments", () => {
    const selected = [
      "answer-active",
      ["answer"],
      null,
      null,
      null,
      null,
      null,
      null,
      [1_752_891_600],
      "en",
    ];
    const alternate = ["answer-other", ["not active"]];
    const payload = [
      [
        [
          ["gemini-1", "Adapter test"],
          null,
          [["question"], 0, null, 0, "user-message"],
          [[alternate, selected], null, null, "answer-active"],
          [1_752_888_000, 0],
        ],
      ],
      null,
      null,
      [],
    ];

    const session = normalizeGeminiConversation(payload, {
      device: "Chrome",
      conversationId: "gemini-1",
      sourceUrl: "https://gemini.google.com/app/gemini-1",
    });

    expect(session.turns).toEqual([
      { role: "user", text: "question", media: [] },
      { role: "assistant", text: "answer", media: [] },
    ]);
  });
});
