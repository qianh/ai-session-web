import { describe, expect, it } from "vitest";

import type { NormalizedSession } from "../../../src/domain/session";
import type {
  DriveEntry,
  DriveObject,
  DrivePort,
  DrivePutInput,
} from "../../../src/drive/types";
import { DriveApiError } from "../../../src/drive/rest-client";
import { SessionUploadService } from "../../../src/drive/upload-service";

class MemoryDrive implements DrivePort {
  readonly objects = new Map<string, DriveObject & { trashed: boolean }>();
  corruptReads = false;
  readError: Error | undefined;
  #id = 0;

  async listByAppProperty(key: string, value: string): Promise<DriveEntry[]> {
    return Array.from(this.objects.values()).filter(
      (object) => !object.trashed && object.appProperties[key] === value,
    );
  }

  async put(input: DrivePutInput): Promise<DriveEntry> {
    const id = `file-${++this.#id}`;
    const object = {
      id,
      path: input.path,
      mimeType: input.mimeType,
      modifiedTime: new Date(this.#id * 1000).toISOString(),
      appProperties: input.appProperties ?? {},
      bytes: Uint8Array.from(input.bytes),
      trashed: false,
    };
    this.objects.set(id, object);
    return object;
  }

  async read(id: string): Promise<DriveObject> {
    const object = this.objects.get(id);
    if (!object) throw new Error("missing object");
    if (this.readError) throw this.readError;
    return {
      ...object,
      bytes: this.corruptReads
        ? new TextEncoder().encode("corrupt")
        : Uint8Array.from(object.bytes),
    };
  }

  async move(id: string, path: string): Promise<DriveEntry> {
    const object = this.objects.get(id);
    if (!object) throw new Error("missing object");
    object.path = path;
    return object;
  }

  async trash(id: string): Promise<void> {
    const object = this.objects.get(id);
    if (object) object.trashed = true;
  }
}

const session: NormalizedSession = {
  source: "chatgpt-web",
  conversationId: "conversation-1",
  device: "web-personal",
  startedAt: "2026-07-19T10:00:00.000Z",
  updatedAt: "2026-07-19T10:05:00.000Z",
  turns: [{ role: "user", text: "hello", media: [] }],
  warnings: [],
};

const prepared = {
  session,
  markdown: "---\nsource: chatgpt-web\n---\n## User\nhello\n",
  contentSha256:
    "c866b9f9fca0fd4e8d78b0ec84197c135cb4e54e3c194364cda0e2cf70bcfbe5",
};

describe("SessionUploadService", () => {
  it("publishes one verified stable file and skips the identical retry", async () => {
    const drive = new MemoryDrive();
    const service = new SessionUploadService({ drive });

    await expect(service.upload(prepared)).resolves.toMatchObject({
      status: "uploaded",
    });
    await expect(service.upload(prepared)).resolves.toMatchObject({
      status: "unchanged",
    });

    const live = Array.from(drive.objects.values()).filter(
      (object) => !object.trashed,
    );
    expect(live).toHaveLength(1);
    expect(live[0]?.path).toBe(
      "inbox/web-personal/chatgpt-web-20260719-conversa.md",
    );
    expect(live[0]?.appProperties).toMatchObject({
      source: "chatgpt-web",
      conversationId: "conversation-1",
      updatedAt: "2026-07-19T10:05:00.000Z",
      contentSha256: prepared.contentSha256,
    });
  });

  it("keeps the newer remote snapshot without creating a candidate", async () => {
    const drive = new MemoryDrive();
    await drive.put({
      path: "inbox/web-other/newer.md",
      bytes: new TextEncoder().encode("newer"),
      mimeType: "text/markdown",
      appProperties: {
        brainhubKey:
          "9395981a6ef5a45501d66c3809749aeae505895d1c847f84c3f6437344414434",
        updatedAt: "2026-07-20T00:00:00.000Z",
        contentSha256: "ffff",
      },
    });
    const service = new SessionUploadService({ drive });

    await expect(service.upload(prepared)).resolves.toMatchObject({
      status: "unchanged",
    });
    expect(drive.objects).toHaveLength(1);
  });

  it("recovers an orphaned temporary candidate on the next upload", async () => {
    const drive = new MemoryDrive();
    await drive.put({
      path: "inbox/web-personal/.orphaned.tmp",
      bytes: new TextEncoder().encode(prepared.markdown),
      mimeType: "text/markdown",
      appProperties: {
        brainhubKey:
          "9395981a6ef5a45501d66c3809749aeae505895d1c847f84c3f6437344414434",
        source: session.source,
        conversationId: session.conversationId,
        deviceId: session.device,
        updatedAt: session.updatedAt,
        contentSha256: prepared.contentSha256,
      },
    });
    const service = new SessionUploadService({ drive });

    await expect(service.upload(prepared)).resolves.toMatchObject({
      status: "uploaded",
    });

    const live = Array.from(drive.objects.values()).filter(
      (object) => !object.trashed,
    );
    expect(live).toHaveLength(1);
    expect(live[0]?.path).toBe(
      "inbox/web-personal/chatgpt-web-20260719-conversa.md",
    );
  });

  it("trashes an unverifiable candidate and reports failure", async () => {
    const drive = new MemoryDrive();
    drive.corruptReads = true;
    const service = new SessionUploadService({ drive });

    await expect(service.upload(prepared)).resolves.toMatchObject({
      status: "failed",
      errorCode: "UPLOAD_VERIFICATION_FAILED",
    });
    expect(
      Array.from(drive.objects.values()).every((object) => object.trashed),
    ).toBe(true);
  });

  it.each([
    [403, false],
    [429, true],
  ])(
    "preserves a DriveApiError with status %i after candidate creation",
    async (status, retryable) => {
      const drive = new MemoryDrive();
      const error = new DriveApiError(status, retryable);
      drive.readError = error;
      const service = new SessionUploadService({ drive });

      await expect(service.upload(prepared)).rejects.toBe(error);
      expect(
        Array.from(drive.objects.values()).every((object) => object.trashed),
      ).toBe(true);
    },
  );
});
