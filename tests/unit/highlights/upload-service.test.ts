import { describe, expect, it } from "vitest";

import type {
  DriveEntry,
  DriveObject,
  DrivePort,
  DrivePutInput,
} from "../../../src/drive/types";
import { prepareHighlight } from "../../../src/highlights/prepare";
import { HighlightUploadService } from "../../../src/highlights/upload-service";

class MemoryDrive implements DrivePort {
  readonly objects = new Map<string, DriveObject & { trashed: boolean }>();
  readonly events: string[] = [];
  readonly putInputs: DrivePutInput[] = [];
  corruptReads = false;
  readError: Error | undefined;
  #id = 0;

  async listByAppProperty(): Promise<DriveEntry[]> {
    return [];
  }

  async put(input: DrivePutInput): Promise<DriveEntry> {
    this.events.push("put");
    this.putInputs.push(input);
    const object = {
      id: `file-${++this.#id}`,
      path: input.path,
      mimeType: input.mimeType,
      modifiedTime: "2026-07-23T07:30:12.000Z",
      appProperties: input.appProperties ?? {},
      bytes: Uint8Array.from(input.bytes),
      trashed: false,
    };
    this.objects.set(object.id, object);
    return object;
  }

  async read(id: string): Promise<DriveObject> {
    this.events.push("read");
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
    this.events.push("move");
    const object = this.objects.get(id);
    if (!object) throw new Error("missing object");
    object.path = path;
    return object;
  }

  async trash(id: string): Promise<void> {
    this.events.push("trash");
    const object = this.objects.get(id);
    if (object) object.trashed = true;
  }
}

describe("HighlightUploadService", () => {
  it("verifies a temporary text file before publishing it", async () => {
    const drive = new MemoryDrive();
    const prepared = await prepareHighlight("api_key=secret-value", {
      now: () => new Date("2026-07-23T07:30:12.000Z"),
      randomUUID: () => "a1b2c3d4-1111-4222-8333-123456789abc",
    });

    await expect(
      new HighlightUploadService({ drive }).upload(prepared),
    ).resolves.toEqual({ status: "uploaded", driveFileId: "file-1" });

    expect(drive.events).toEqual(["put", "read", "move"]);
    expect(drive.putInputs[0]).toMatchObject({
      path: "highlights/2026-07/.a1b2c3d4-1111-4222-8333-123456789abc.tmp",
      mimeType: "text/plain; charset=utf-8",
      appProperties: {
        brainhubType: "highlight",
        highlightId: "a1b2c3d4-1111-4222-8333-123456789abc",
        capturedAt: "2026-07-23T07:30:12.000Z",
        redactionVersion: "1",
        redactionCount: "1",
      },
    });
    expect([...drive.objects.values()][0]).toMatchObject({
      path: prepared.path,
      trashed: false,
    });
    expect(
      new TextDecoder().decode([...drive.objects.values()][0]?.bytes),
    ).toBe("api_key=[REDACTED]");
  });

  it("trashes a candidate that fails byte verification", async () => {
    const drive = new MemoryDrive();
    drive.corruptReads = true;
    const prepared = await prepareHighlight("selected text");

    await expect(
      new HighlightUploadService({ drive }).upload(prepared),
    ).resolves.toEqual({
      status: "failed",
      errorCode: "UPLOAD_VERIFICATION_FAILED",
    });

    expect(drive.events).toEqual(["put", "read", "trash"]);
    expect([...drive.objects.values()]).toEqual([
      expect.objectContaining({ trashed: true }),
    ]);
  });

  it("trashes the temporary candidate without hiding a Drive error", async () => {
    const drive = new MemoryDrive();
    const error = new Error("Drive read failed");
    drive.readError = error;
    const prepared = await prepareHighlight("selected text");

    await expect(
      new HighlightUploadService({ drive }).upload(prepared),
    ).rejects.toBe(error);

    expect(drive.events).toEqual(["put", "read", "trash"]);
    expect([...drive.objects.values()][0]?.trashed).toBe(true);
  });
});
