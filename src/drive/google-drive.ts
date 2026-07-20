import type { DriveFolderApi, DriveFileMetadata } from "./paths";
import { DrivePathResolver } from "./paths";
import type { DriveHttp } from "./rest-client";
import type {
  DriveEntry,
  DriveObject,
  DrivePort,
  DrivePutInput,
} from "./types";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const FILE_FIELDS =
  "id,name,mimeType,parents,size,modifiedTime,appProperties,trashed";
const RESUMABLE_UPLOAD_THRESHOLD = 5 * 1024 * 1024;
const RESUMABLE_CHUNK_SIZE = 8 * 1024 * 1024;

interface GoogleFile extends DriveFileMetadata {
  modifiedTime?: string;
  appProperties?: Record<string, string>;
  trashed?: boolean;
}

function escapeQuery(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function params(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

function pathParts(path: string): { directory: string; name: string } {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw new Error("Drive path must be relative to the BrainHub root");
  }
  const segments = path.split("/");
  const name = segments.pop();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Drive path must be relative to the BrainHub root");
  }
  return { directory: segments.join("/"), name };
}

function concatenate(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(
    chunks.reduce((size, chunk) => size + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export class GoogleDriveGateway implements DriveFolderApi {
  constructor(readonly http: DriveHttp) {}

  async listFolders(
    name: string,
    parentId?: string,
  ): Promise<DriveFileMetadata[]> {
    const clauses = [
      `name = '${escapeQuery(name)}'`,
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false",
    ];
    if (parentId) clauses.push(`'${escapeQuery(parentId)}' in parents`);
    return this.listFiles(clauses.join(" and "));
  }

  async createFolder(
    name: string,
    parentId?: string,
  ): Promise<DriveFileMetadata> {
    return this.http.json<GoogleFile>(
      `/files?${params({ fields: FILE_FIELDS })}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME_TYPE,
          ...(parentId ? { parents: [parentId] } : {}),
        }),
      },
    );
  }

  async listFiles(query: string): Promise<GoogleFile[]> {
    const files: GoogleFile[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.http.json<{
        files?: GoogleFile[];
        nextPageToken?: string;
      }>(
        `/files?${params({
          q: query,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          spaces: "drive",
          ...(pageToken ? { pageToken } : {}),
        })}`,
      );
      files.push(...(response.files ?? []));
      pageToken = response.nextPageToken;
    } while (pageToken);
    return files;
  }

  getFile(id: string): Promise<GoogleFile> {
    return this.http.json<GoogleFile>(
      `/files/${encodeURIComponent(id)}?${params({ fields: FILE_FIELDS })}`,
    );
  }

  async upload(input: {
    name: string;
    parentId: string;
    bytes: Uint8Array;
    mimeType: string;
    appProperties: Record<string, string>;
  }): Promise<GoogleFile> {
    if (input.bytes.byteLength > RESUMABLE_UPLOAD_THRESHOLD) {
      return this.#uploadResumable(input);
    }
    return this.#uploadMultipart(input);
  }

  async #uploadMultipart(input: {
    name: string;
    parentId: string;
    bytes: Uint8Array;
    mimeType: string;
    appProperties: Record<string, string>;
  }): Promise<GoogleFile> {
    const boundary = `brainhub-${crypto.randomUUID()}`;
    const encode = (value: string) => new TextEncoder().encode(value);
    const metadata = JSON.stringify({
      name: input.name,
      parents: [input.parentId],
      appProperties: input.appProperties,
    });
    const body = concatenate([
      encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      ),
      encode(`--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`),
      input.bytes,
      encode(`\r\n--${boundary}--`),
    ]);
    return this.http.json<GoogleFile>(
      `https://www.googleapis.com/upload/drive/v3/files?${params({
        uploadType: "multipart",
        fields: FILE_FIELDS,
      })}`,
      {
        method: "POST",
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
  }

  async #uploadResumable(input: {
    name: string;
    parentId: string;
    bytes: Uint8Array;
    mimeType: string;
    appProperties: Record<string, string>;
  }): Promise<GoogleFile> {
    const metadata = JSON.stringify({
      name: input.name,
      parents: [input.parentId],
      appProperties: input.appProperties,
    });
    const session = await this.http.request(
      `https://www.googleapis.com/upload/drive/v3/files?${params({
        uploadType: "resumable",
        fields: FILE_FIELDS,
      })}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-upload-content-length": String(input.bytes.byteLength),
          "x-upload-content-type": input.mimeType,
        },
        body: metadata,
      },
    );
    const location = session.headers.get("location");
    if (!location) throw new Error("Drive resumable upload session is missing");

    for (
      let offset = 0;
      offset < input.bytes.byteLength;
      offset += RESUMABLE_CHUNK_SIZE
    ) {
      const end = Math.min(
        offset + RESUMABLE_CHUNK_SIZE,
        input.bytes.byteLength,
      );
      const response = await this.http.request(
        location,
        {
          method: "PUT",
          headers: {
            "content-type": input.mimeType,
            "content-range": `bytes ${offset}-${end - 1}/${input.bytes.byteLength}`,
          },
          body: input.bytes.slice(offset, end),
        },
        [308],
      );
      if (response.status !== 308) {
        return (await response.json()) as GoogleFile;
      }
    }
    throw new Error("Drive resumable upload did not complete");
  }

  forRoot(rootFolderId: string): DrivePort {
    return new GoogleDrivePort(this, rootFolderId);
  }
}

class GoogleDrivePort implements DrivePort {
  readonly #resolver: DrivePathResolver;

  constructor(
    readonly gateway: GoogleDriveGateway,
    readonly rootFolderId: string,
  ) {
    if (!rootFolderId) throw new Error("Drive root folder is required");
    this.#resolver = new DrivePathResolver(gateway);
  }

  async listByAppProperty(key: string, value: string): Promise<DriveEntry[]> {
    const files = await this.gateway.listFiles(
      `appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' } and trashed = false`,
    );
    const output: DriveEntry[] = [];
    for (const file of files) {
      try {
        output.push(await this.#entry(file, await this.#pathFor(file)));
      } catch {
        // Ignore app-owned files outside this BrainHub root.
      }
    }
    return output;
  }

  async put(input: DrivePutInput): Promise<DriveEntry> {
    const { directory, name } = pathParts(input.path);
    const parentId = directory
      ? await this.#resolver.ensureFolderPath(this.rootFolderId, directory)
      : this.rootFolderId;
    const file = await this.gateway.upload({
      name,
      parentId,
      bytes: input.bytes,
      mimeType: input.mimeType,
      appProperties: input.appProperties ?? {},
    });
    return this.#entry(file, input.path);
  }

  async read(id: string): Promise<DriveObject> {
    const file = await this.gateway.getFile(id);
    const path = await this.#pathFor(file);
    const bytes = await this.gateway.http.bytes(
      `/files/${encodeURIComponent(id)}?alt=media`,
    );
    return { ...(await this.#entry(file, path)), bytes };
  }

  async move(id: string, path: string): Promise<DriveEntry> {
    const current = await this.gateway.getFile(id);
    await this.#pathFor(current);
    const { directory, name } = pathParts(path);
    const parentId = directory
      ? await this.#resolver.ensureFolderPath(this.rootFolderId, directory)
      : this.rootFolderId;
    const currentParents = current.parents ?? [];
    const parentsToRemove = currentParents.filter(
      (currentParentId) => currentParentId !== parentId,
    );
    const updated = await this.gateway.http.json<GoogleFile>(
      `/files/${encodeURIComponent(id)}?${params({
        ...(currentParents.includes(parentId) ? {} : { addParents: parentId }),
        ...(parentsToRemove.length > 0
          ? { removeParents: parentsToRemove.join(",") }
          : {}),
        fields: FILE_FIELDS,
      })}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    return this.#entry(updated, path);
  }

  async trash(id: string): Promise<void> {
    const file = await this.gateway.getFile(id);
    await this.#pathFor(file);
    await this.gateway.http.json(
      `/files/${encodeURIComponent(id)}?${params({ fields: "id,trashed" })}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
    );
  }

  async #pathFor(file: GoogleFile): Promise<string> {
    const segments: string[] = [];
    let current = file;
    const visited = new Set<string>();
    while (current.id !== this.rootFolderId) {
      if (visited.has(current.id))
        throw new Error("Drive parent cycle detected");
      visited.add(current.id);
      segments.unshift(current.name);
      const parentId = current.parents?.[0];
      if (!parentId) throw new Error("Drive object is outside BrainHub root");
      if (parentId === this.rootFolderId) break;
      current = await this.gateway.getFile(parentId);
    }
    return segments.join("/");
  }

  async #entry(file: GoogleFile, path: string): Promise<DriveEntry> {
    return {
      id: file.id,
      path,
      mimeType: file.mimeType || "application/octet-stream",
      modifiedTime: file.modifiedTime ?? new Date(0).toISOString(),
      appProperties: file.appProperties ?? {},
    };
  }
}
