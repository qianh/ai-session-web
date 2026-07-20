import { describe, expect, it, vi } from "vitest";

import { sha256Hex } from "../../../src/domain/hash";
import type { NormalizedSession } from "../../../src/domain/session";
import type {
  DriveEntry,
  DriveObject,
  DrivePort,
  DrivePutInput,
} from "../../../src/drive/types";
import { MediaArchiver } from "../../../src/media/archiver";

class MediaDrive implements DrivePort {
  readonly objects: DriveObject[] = [];

  async listByAppProperty(key: string, value: string): Promise<DriveEntry[]> {
    return this.objects.filter((object) => object.appProperties[key] === value);
  }

  async put(input: DrivePutInput): Promise<DriveEntry> {
    const object: DriveObject = {
      id: `media-${this.objects.length + 1}`,
      path: input.path,
      mimeType: input.mimeType,
      modifiedTime: new Date().toISOString(),
      appProperties: input.appProperties ?? {},
      bytes: Uint8Array.from(input.bytes),
    };
    this.objects.push(object);
    return object;
  }

  async read(id: string): Promise<DriveObject> {
    const object = this.objects.find((candidate) => candidate.id === id);
    if (!object) throw new Error("missing media");
    return object;
  }

  async move(): Promise<DriveEntry> {
    throw new Error("not used");
  }

  async trash(): Promise<void> {
    throw new Error("not used");
  }
}

function sessionWithMedia(
  media: NormalizedSession["turns"][number]["media"],
): NormalizedSession {
  return {
    source: "claude-web",
    conversationId: "conversation-1",
    device: "web-personal",
    startedAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T10:00:00.000Z",
    turns: [{ role: "user", text: "files", media }],
    warnings: [],
  };
}

describe("MediaArchiver", () => {
  it("converts and globally deduplicates images by original bytes", async () => {
    const original = new TextEncoder().encode("original-png");
    const converted = new TextEncoder().encode("converted-webp");
    const drive = new MediaDrive();
    const fetch = vi.fn(
      async () =>
        new Response(original, {
          headers: { "content-type": "image/png" },
        }),
    );
    const convertImage = vi.fn(async () => converted);
    const archiver = new MediaArchiver({ drive, fetch, convertImage });
    const session = sessionWithMedia([
      { kind: "image", url: "https://claude.ai/api/file-1" },
      { kind: "image", url: "https://claude.ai/api/file-1" },
    ]);

    const result = await archiver.archive(session);
    const sha = await sha256Hex(original);

    expect(
      result.session.turns[0]?.media.map((media) => media.drivePath),
    ).toEqual([
      `images/sha256/${sha.slice(0, 2)}/${sha}.webp`,
      `images/sha256/${sha.slice(0, 2)}/${sha}.webp`,
    ]);
    expect(drive.objects).toHaveLength(1);
    expect(Array.from(drive.objects[0]?.bytes ?? [])).toEqual(
      Array.from(converted),
    );
    expect(convertImage).toHaveBeenCalledTimes(1);
  });

  it("archives attachments with a sanitized extension", async () => {
    const bytes = new TextEncoder().encode("pdf-content");
    const drive = new MediaDrive();
    const archiver = new MediaArchiver({
      drive,
      fetch: async () =>
        new Response(bytes, {
          headers: { "content-type": "application/pdf" },
        }),
      convertImage: async (value) => value,
    });

    const result = await archiver.archive(
      sessionWithMedia([
        {
          kind: "attachment",
          url: "https://claude.ai/api/file-2",
          name: "../../design.PDF",
        },
      ]),
    );
    const sha = await sha256Hex(bytes);

    expect(result.session.turns[0]?.media[0]?.drivePath).toBe(
      `attachments/sha256/${sha.slice(0, 2)}/${sha}.pdf`,
    );
    expect(drive.objects[0]?.appProperties).toEqual({
      brainhubAttachmentSha: sha,
    });
  });

  it("keeps the original URL and warns when a file exceeds the limit", async () => {
    const drive = new MediaDrive();
    const archiver = new MediaArchiver({
      drive,
      maxBytes: 4,
      fetch: async () =>
        new Response(new Uint8Array([1, 2, 3, 4, 5]), {
          headers: { "content-length": "5" },
        }),
      convertImage: async (value) => value,
    });

    const result = await archiver.archive(
      sessionWithMedia([
        { kind: "attachment", url: "https://claude.ai/api/large" },
      ]),
    );

    expect(result.session.turns[0]?.media[0]?.drivePath).toBeUndefined();
    expect(result.warnings).toEqual([
      { code: "MEDIA_TOO_LARGE", url: "https://claude.ai/api/large" },
    ]);
    expect(drive.objects).toHaveLength(0);
  });

  it("falls back without leaking a failed response body", async () => {
    const drive = new MediaDrive();
    const archiver = new MediaArchiver({
      drive,
      fetch: async () =>
        new Response("private upstream error", { status: 403 }),
      convertImage: async (value) => value,
    });

    const result = await archiver.archive(
      sessionWithMedia([
        { kind: "image", url: "https://claude.ai/api/denied" },
      ]),
    );

    expect(result.warnings).toEqual([
      { code: "MEDIA_DOWNLOAD_FAILED", url: "https://claude.ai/api/denied" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private upstream error");
  });
});
