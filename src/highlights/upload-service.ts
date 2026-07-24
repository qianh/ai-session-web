import type { DrivePort } from "../drive/types";
import type { PreparedHighlight } from "./prepare";

export type HighlightUploadResult =
  | { status: "uploaded"; driveFileId: string }
  | { status: "failed"; errorCode: "UPLOAD_VERIFICATION_FAILED" };

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

export class HighlightUploadService {
  constructor(private readonly options: { drive: DrivePort }) {}

  async upload(prepared: PreparedHighlight): Promise<HighlightUploadResult> {
    const directory = prepared.path.slice(0, prepared.path.lastIndexOf("/"));
    const candidate = await this.options.drive.put({
      path: `${directory}/.${prepared.id}.tmp`,
      bytes: prepared.bytes,
      mimeType: "text/plain; charset=utf-8",
      appProperties: {
        brainhubType: "highlight",
        highlightId: prepared.id,
        capturedAt: prepared.capturedAt,
        redactionVersion: String(prepared.redactionVersion),
        redactionCount: String(prepared.redactionCount),
      },
    });
    try {
      const verified = await this.options.drive.read(candidate.id);
      if (!equalBytes(verified.bytes, prepared.bytes)) {
        await this.options.drive.trash(candidate.id);
        return { status: "failed", errorCode: "UPLOAD_VERIFICATION_FAILED" };
      }
      await this.options.drive.move(candidate.id, prepared.path);
      return { status: "uploaded", driveFileId: candidate.id };
    } catch (error) {
      await this.options.drive.trash(candidate.id).catch(() => undefined);
      throw error;
    }
  }
}
