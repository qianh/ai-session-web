import { describe, expect, it } from "vitest";

import { prepareHighlight } from "../../../src/highlights/prepare";

describe("prepareHighlight", () => {
  it("trims only outer whitespace and creates a monthly text path", async () => {
    const prepared = await prepareHighlight(" \nfirst line\n  second line\n ", {
      now: () => new Date("2026-07-23T07:30:12.000Z"),
      randomUUID: () => "a1b2c3d4-1111-4222-8333-123456789abc",
    });

    expect(prepared.text).toBe("first line\n  second line");
    expect(prepared.path).toBe(
      "highlights/2026-07/highlight-20260723-073012-a1b2c3d4.txt",
    );
    expect(new TextDecoder().decode(prepared.bytes)).toBe(prepared.text);
  });

  it("rejects an empty selection after trimming", async () => {
    await expect(prepareHighlight(" \n\t ")).rejects.toMatchObject({
      code: "HIGHLIGHT_EMPTY",
    });
  });

  it("rejects selected text over 512 KiB measured as UTF-8", async () => {
    const oversized = "你".repeat(Math.floor((512 * 1024) / 3) + 1);

    await expect(prepareHighlight(oversized)).rejects.toMatchObject({
      code: "HIGHLIGHT_TOO_LARGE",
    });
  });

  it("redacts credentials before encoding the text file", async () => {
    const prepared = await prepareHighlight(
      "Useful command\napi_key=secret-value-123",
    );

    expect(prepared.text).toBe("Useful command\napi_key=[REDACTED]");
    expect(new TextDecoder().decode(prepared.bytes)).not.toContain(
      "secret-value-123",
    );
    expect(prepared.redactionVersion).toBe(1);
    expect(prepared.redactionCount).toBe(1);
  });
});
