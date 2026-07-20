import { describe, expect, it } from "vitest";

import {
  conversationKey,
  sessionFilename,
  sha256Hex,
} from "../../../src/domain/hash";

describe("BrainHub hashing contract", () => {
  it("matches the MCP conversation key algorithm", async () => {
    await expect(
      conversationKey("chatgpt-web", "conversation-1"),
    ).resolves.toBe(
      "9395981a6ef5a45501d66c3809749aeae505895d1c847f84c3f6437344414434",
    );
  });

  it("hashes bytes without string coercion", async () => {
    await expect(sha256Hex(new Uint8Array([0, 1, 2]))).resolves.toBe(
      "ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc",
    );
  });

  it("matches the unified session filename", () => {
    expect(
      sessionFilename({
        source: "gemini-web",
        conversationId: "abc-12_34/unsafe",
        startedAt: "2026-07-19T10:00:00.000Z",
      }),
    ).toBe("gemini-web-20260719-abc1234u.md");
  });
});
