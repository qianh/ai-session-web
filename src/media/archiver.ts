import { sha256Hex } from "../domain/hash";
import type {
  MediaRef,
  NormalizedSession,
  WebSessionSource,
} from "../domain/session";
import type { DrivePort } from "../drive/types";

export type MediaWarningCode =
  "MEDIA_TOO_LARGE" | "MEDIA_DOWNLOAD_FAILED" | "MEDIA_UPLOAD_FAILED";

export interface MediaWarning {
  code: MediaWarningCode;
  url: string;
}

interface MediaArchiverOptions {
  drive: DrivePort;
  fetch?: typeof globalThis.fetch;
  fetchMedia?: (
    url: string,
    source: WebSessionSource,
    maxBytes: number,
  ) => Promise<Response>;
  convertImage: (bytes: Uint8Array, mimeType?: string) => Promise<Uint8Array>;
  maxBytes?: number;
}

class MediaArchiveError extends Error {
  constructor(readonly code: MediaWarningCode) {
    super(code);
  }
}

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function attachmentExtension(media: MediaRef, mimeType: string): string {
  const fromName = media.name?.match(/\.([A-Za-z0-9]{1,10})$/u)?.[1];
  if (fromName) return fromName.toLowerCase();
  const extensions: Record<string, string> = {
    "application/json": "json",
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/csv": "csv",
    "text/markdown": "md",
    "text/plain": "txt",
  };
  return extensions[mimeType] ?? "bin";
}

export class MediaArchiver {
  readonly #drive: DrivePort;
  readonly #fetch: typeof globalThis.fetch;
  readonly #fetchMedia?: MediaArchiverOptions["fetchMedia"];
  readonly #convertImage: MediaArchiverOptions["convertImage"];
  readonly #maxBytes: number;

  constructor(options: MediaArchiverOptions) {
    this.#drive = options.drive;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#fetchMedia = options.fetchMedia;
    this.#convertImage = options.convertImage;
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  async archive(input: NormalizedSession): Promise<{
    session: NormalizedSession;
    warnings: MediaWarning[];
  }> {
    const warnings: MediaWarning[] = [];
    const archived = new Map<string, { sha256: string; drivePath: string }>();
    const turns = [] as NormalizedSession["turns"];

    for (const turn of input.turns) {
      const media: MediaRef[] = [];
      for (const item of turn.media) {
        try {
          media.push(await this.#archiveOne(item, archived, input.source));
        } catch (error) {
          const code =
            error instanceof MediaArchiveError
              ? error.code
              : "MEDIA_UPLOAD_FAILED";
          warnings.push({ code, url: item.url });
          media.push(item);
        }
      }
      turns.push({ ...turn, media });
    }

    return {
      session: {
        ...input,
        turns,
        warnings: [
          ...input.warnings,
          ...warnings.map((warning) => warning.code),
        ],
      },
      warnings,
    };
  }

  async #archiveOne(
    media: MediaRef,
    archived: Map<string, { sha256: string; drivePath: string }>,
    source: WebSessionSource,
  ): Promise<MediaRef> {
    const response = this.#fetchMedia
      ? await this.#fetchMedia(media.url, source, this.#maxBytes)
      : await this.#fetch(media.url, { credentials: "include" });
    if (!response.ok) throw new MediaArchiveError("MEDIA_DOWNLOAD_FAILED");
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (declaredSize > this.#maxBytes) {
      throw new MediaArchiveError("MEDIA_TOO_LARGE");
    }
    const original = new Uint8Array(await response.arrayBuffer());
    if (original.byteLength > this.#maxBytes) {
      throw new MediaArchiveError("MEDIA_TOO_LARGE");
    }
    const sha256 = await sha256Hex(original);
    const cacheKey = `${media.kind}:${sha256}`;
    const cached = archived.get(cacheKey);
    if (cached) return { ...media, ...cached };

    const mimeType =
      media.mimeType ??
      response.headers.get("content-type")?.split(";", 1)[0] ??
      "application/octet-stream";
    const isImage = media.kind === "image";
    const property = isImage ? "brainhubImageSha" : "brainhubAttachmentSha";
    const existing = await this.#drive.listByAppProperty(property, sha256);
    let drivePath = existing[0]?.path;
    if (!drivePath) {
      const extension = isImage ? "webp" : attachmentExtension(media, mimeType);
      const directory = isImage ? "images" : "attachments";
      drivePath = `${directory}/sha256/${sha256.slice(0, 2)}/${sha256}.${extension}`;
      const bytes = isImage
        ? await this.#convertImage(original, mimeType)
        : original;
      const uploaded = await this.#drive.put({
        path: drivePath,
        bytes,
        mimeType: isImage ? "image/webp" : mimeType,
        appProperties: { [property]: sha256 },
      });
      const verified = await this.#drive.read(uploaded.id);
      if (!equalBytes(verified.bytes, bytes)) {
        await this.#drive.trash(uploaded.id).catch(() => undefined);
        throw new MediaArchiveError("MEDIA_UPLOAD_FAILED");
      }
    }
    const result = { sha256, drivePath };
    archived.set(cacheKey, result);
    return { ...media, ...result };
  }
}
