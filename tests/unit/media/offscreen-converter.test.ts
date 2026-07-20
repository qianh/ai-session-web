import { describe, expect, it, vi } from "vitest";

import { OffscreenImageConverter } from "../../../src/media/offscreen-converter";

describe("OffscreenImageConverter", () => {
  it("creates one offscreen document and returns converted WebP bytes", async () => {
    const createDocument = vi.fn(async () => undefined);
    const sendMessage = vi.fn(async (message: unknown) => {
      const serialized = JSON.parse(JSON.stringify(message)) as {
        bytes?: unknown;
      };
      expect(serialized.bytes).toEqual(["AQID"]);
      return JSON.parse(
        JSON.stringify({
          ok: true,
          bytes: ["BAUG"],
        }),
      ) as { ok: true; bytes: string[] };
    });
    const converter = new OffscreenImageConverter({
      offscreen: {
        hasDocument: vi.fn(async () => false),
        createDocument,
      },
      runtime: {
        getURL: vi.fn(() => "chrome-extension://id/offscreen.html"),
        sendMessage,
      },
    });

    await expect(
      converter.convert(new Uint8Array([1, 2, 3]), "image/png"),
    ).resolves.toEqual(new Uint8Array([4, 5, 6]));
    expect(createDocument).toHaveBeenCalledWith({
      url: "chrome-extension://id/offscreen.html",
      reasons: ["BLOBS"],
      justification: "Convert archived AI images to WebP",
    });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "brain-capture-offscreen",
        type: "CONVERT_WEBP",
        bytes: ["AQID"],
      }),
    );
  });
});
