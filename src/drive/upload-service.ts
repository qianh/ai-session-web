import { conversationKey, sessionFilename } from "../domain/hash";
import type { NormalizedSession } from "../domain/session";
import type { DriveEntry, DrivePort } from "./types";

export interface PreparedSession {
  session: NormalizedSession;
  markdown: string;
  contentSha256: string;
}

export type UploadResult =
  | { status: "uploaded"; driveFileId: string }
  | { status: "unchanged"; driveFileId: string }
  | { status: "failed"; errorCode: "UPLOAD_VERIFICATION_FAILED" };

function compareCandidates(left: DriveEntry, right: DriveEntry): number {
  const leftTuple = [
    left.appProperties.updatedAt ?? "",
    left.appProperties.contentSha256 ?? "",
    left.id,
  ];
  const rightTuple = [
    right.appProperties.updatedAt ?? "",
    right.appProperties.contentSha256 ?? "",
    right.id,
  ];
  return rightTuple.join("\0").localeCompare(leftTuple.join("\0"));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function isTemporaryCandidate(path: string): boolean {
  return /(?:^|\/)\.[^/]+\.tmp$/u.test(path);
}

export class SessionUploadService {
  readonly #drive: DrivePort;

  constructor(options: { drive: DrivePort }) {
    this.#drive = options.drive;
  }

  async upload(prepared: PreparedSession): Promise<UploadResult> {
    const { session } = prepared;
    const key = await conversationKey(session.source, session.conversationId);
    const existing = await this.#drive.listByAppProperty("brainhubKey", key);
    const winner = existing.sort(compareCandidates)[0];
    const winnerUpdatedAt = winner?.appProperties.updatedAt ?? "";
    const winnerContentSha = winner?.appProperties.contentSha256 ?? "";
    if (
      winner &&
      !isTemporaryCandidate(winner.path) &&
      (winnerUpdatedAt > session.updatedAt ||
        (winnerUpdatedAt === session.updatedAt &&
          winnerContentSha >= prepared.contentSha256))
    ) {
      return { status: "unchanged", driveFileId: winner.id };
    }

    const bytes = new TextEncoder().encode(prepared.markdown);
    let candidateId: string | null = null;
    try {
      const candidate = await this.#drive.put({
        path: `inbox/${session.device}/.${crypto.randomUUID()}.tmp`,
        bytes,
        mimeType: "text/markdown",
        appProperties: {
          brainhubKey: key,
          source: session.source,
          conversationId: session.conversationId,
          deviceId: session.device,
          updatedAt: session.updatedAt,
          contentSha256: prepared.contentSha256,
        },
      });
      candidateId = candidate.id;
      const verified = await this.#drive.read(candidate.id);
      if (!equalBytes(verified.bytes, bytes)) {
        await this.#drive.trash(candidate.id);
        return { status: "failed", errorCode: "UPLOAD_VERIFICATION_FAILED" };
      }

      const candidates = await this.#drive.listByAppProperty(
        "brainhubKey",
        key,
      );
      const canonical = candidates.sort(compareCandidates)[0];
      if (!canonical) throw new Error("Drive candidate disappeared");
      const path = `inbox/${session.device}/${sessionFilename(session)}`;
      await this.#drive.move(canonical.id, path);
      for (const duplicate of candidates.slice(1)) {
        await this.#drive.trash(duplicate.id);
      }
      candidateId = null;
      return { status: "uploaded", driveFileId: canonical.id };
    } catch (error) {
      if (candidateId)
        await this.#drive.trash(candidateId).catch(() => undefined);
      throw error;
    }
  }
}
