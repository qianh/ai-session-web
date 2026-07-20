import { describe, expect, it } from "vitest";

import { sha256Hex } from "../../../src/domain/hash";
import { renderSessionMarkdown } from "../../../src/domain/markdown";
import type { NormalizedSession } from "../../../src/domain/session";

const session: NormalizedSession = {
  source: "chatgpt-web",
  conversationId: "conversation-1",
  device: "web-personal",
  title: "Archive design",
  workspaceId: "personal",
  sourceUrl: "https://chatgpt.com/c/conversation-1",
  startedAt: "2026-07-19T10:00:00.000Z",
  updatedAt: "2026-07-19T10:05:00.000Z",
  turns: [
    {
      role: "user",
      text: "See image",
      media: [
        {
          kind: "image",
          url: "https://chatgpt.com/file.png",
          drivePath: "images/sha256/ab/abcdef.webp",
        },
      ],
    },
    {
      role: "assistant",
      text: "See file",
      media: [
        {
          kind: "attachment",
          url: "https://chatgpt.com/file.pdf",
          name: "design.pdf",
          drivePath: "attachments/sha256/cd/cdef.pdf",
        },
      ],
    },
  ],
  warnings: [],
};

describe("renderSessionMarkdown", () => {
  it("renders compatible required fields and stable archived media links", async () => {
    const rendered = await renderSessionMarkdown(session, {
      redactionVersion: 1,
      redactionCount: 2,
    });

    expect(rendered.markdown).toContain("source: chatgpt-web");
    expect(rendered.markdown).toContain("conversation_id: conversation-1");
    expect(rendered.markdown).toContain("turn_count: 2");
    expect(rendered.markdown).toContain("![](images/sha256/ab/abcdef.webp)");
    expect(rendered.markdown).toContain(
      "[design.pdf](attachments/sha256/cd/cdef.pdf)",
    );
  });

  it("hashes the canonical document before inserting content_sha256", async () => {
    const rendered = await renderSessionMarkdown(session, {
      redactionVersion: 1,
      redactionCount: 0,
    });
    const canonical = rendered.markdown
      .slice(4)
      .replace(/^content_sha256: [a-f0-9]{64}\n/mu, "");

    expect(rendered.contentSha256).toBe(await sha256Hex(canonical));
    expect(rendered.markdown).toContain(
      `content_sha256: ${rendered.contentSha256}`,
    );
  });

  it("falls back to the original URL when media archival failed", async () => {
    const fallback: NormalizedSession = {
      ...session,
      turns: [
        {
          role: "user",
          text: "image",
          media: [
            {
              kind: "image",
              url: "https://chatgpt.com/temporary.png",
            },
          ],
        },
      ],
    };

    const rendered = await renderSessionMarkdown(fallback, {
      redactionVersion: 1,
      redactionCount: 0,
    });

    expect(rendered.markdown).toContain(
      "![](https://chatgpt.com/temporary.png)",
    );
  });
});
