import { describe, expect, it } from "vitest";

import type { DriveHttp } from "../../../src/drive/rest-client";
import { GoogleDriveGateway } from "../../../src/drive/google-drive";

class HandlerHttp implements DriveHttp {
  readonly calls: Array<{ path: string; init: RequestInit }> = [];

  constructor(
    readonly handler: (
      path: string,
      init: RequestInit,
    ) => unknown | Promise<unknown>,
  ) {}

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    this.calls.push({ path, init });
    return (await this.handler(path, init)) as T;
  }

  async bytes(): Promise<Uint8Array> {
    return new TextEncoder().encode("bytes");
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    this.calls.push({ path, init });
    const result = await this.handler(path, init);
    return result instanceof Response ? result : Response.json(result);
  }
}

describe("GoogleDriveGateway", () => {
  it("lists or creates folders with escaped Drive queries", async () => {
    const http = new HandlerHttp((path, init) => {
      if ((init.method ?? "GET") === "GET") return { files: [] };
      expect(JSON.parse(String(init.body))).toMatchObject({
        name: "brain-'hub",
        mimeType: "application/vnd.google-apps.folder",
      });
      return {
        id: "root",
        name: "brain-'hub",
        mimeType: "application/vnd.google-apps.folder",
      };
    });
    const gateway = new GoogleDriveGateway(http);

    await expect(gateway.listFolders("brain-'hub")).resolves.toEqual([]);
    await expect(gateway.createFolder("brain-'hub")).resolves.toMatchObject({
      id: "root",
    });

    const query = new URL(
      `https://drive.test${http.calls[0]?.path ?? ""}`,
    ).searchParams.get("q");
    expect(query).toContain("name = 'brain-\\'hub'");
  });

  it("creates missing path folders and uploads multipart bytes", async () => {
    const folders = new Map<string, string>();
    const http = new HandlerHttp(async (path, init) => {
      const method = init.method ?? "GET";
      if (method === "GET" && path.startsWith("/files?")) {
        const query =
          new URL(`https://drive.test${path}`).searchParams.get("q") ?? "";
        const name = query.match(/name = '([^']+)'/u)?.[1];
        const parent = query.match(/'([^']+)' in parents/u)?.[1];
        const id =
          name && parent ? folders.get(`${parent}/${name}`) : undefined;
        return {
          files: id
            ? [
                {
                  id,
                  name,
                  mimeType: "application/vnd.google-apps.folder",
                  parents: [parent],
                },
              ]
            : [],
        };
      }
      if (method === "POST" && path.startsWith("/files?")) {
        const body = JSON.parse(String(init.body)) as {
          name: string;
          parents: string[];
        };
        const id = `folder-${folders.size + 1}`;
        folders.set(`${body.parents[0]}/${body.name}`, id);
        return {
          id,
          name: body.name,
          mimeType: "application/vnd.google-apps.folder",
          parents: body.parents,
        };
      }
      if (method === "POST" && path.includes("upload/drive/v3/files")) {
        const body = new TextDecoder().decode(init.body as Uint8Array);
        expect(new Headers(init.headers).get("content-type")).toContain(
          "multipart/related",
        );
        expect(body).toContain('"name":"session.md"');
        expect(body).toContain('"brainhubKey":"key-1"');
        expect(body).toContain("markdown-bytes");
        return {
          id: "session",
          name: "session.md",
          mimeType: "text/markdown",
          parents: [folders.get("folder-1/web-personal")],
          modifiedTime: "2026-07-19T10:00:00.000Z",
          appProperties: { brainhubKey: "key-1" },
        };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const gateway = new GoogleDriveGateway(http);
    const drive = gateway.forRoot("root");

    await expect(
      drive.put({
        path: "inbox/web-personal/session.md",
        bytes: new TextEncoder().encode("markdown-bytes"),
        mimeType: "text/markdown",
        appProperties: { brainhubKey: "key-1" },
      }),
    ).resolves.toMatchObject({
      id: "session",
      path: "inbox/web-personal/session.md",
    });
  });

  it("uploads large objects through a chunked resumable session", async () => {
    const chunkSize = 8 * 1024 * 1024;
    const bytes = new Uint8Array(17 * 1024 * 1024);
    const file = {
      id: "large-file",
      name: "large.bin",
      mimeType: "application/octet-stream",
      parents: ["root"],
      modifiedTime: "2026-07-20T10:00:00.000Z",
      appProperties: { brainhubAttachmentSha: "abc" },
    };
    let uploadedChunks = 0;
    const http = new HandlerHttp((path, init) => {
      if (path.includes("uploadType=resumable")) {
        return new Response(null, {
          status: 200,
          headers: { location: "https://upload.example.test/session-1" },
        });
      }
      if (path === "https://upload.example.test/session-1") {
        uploadedChunks += 1;
        return uploadedChunks < 3
          ? new Response(null, { status: 308 })
          : Response.json(file);
      }
      if (path.includes("uploadType=multipart")) return file;
      throw new Error(`Unexpected ${init.method ?? "GET"} ${path}`);
    });
    const gateway = new GoogleDriveGateway(http);

    await expect(
      gateway.upload({
        name: "large.bin",
        parentId: "root",
        bytes,
        mimeType: "application/octet-stream",
        appProperties: { brainhubAttachmentSha: "abc" },
      }),
    ).resolves.toMatchObject({ id: "large-file" });

    const sessionCalls = http.calls.filter(
      ({ path }) => path === "https://upload.example.test/session-1",
    );
    expect(
      http.calls.some(({ path }) => path.includes("uploadType=resumable")),
    ).toBe(true);
    expect(
      http.calls.some(({ path }) => path.includes("uploadType=multipart")),
    ).toBe(false);
    expect(
      sessionCalls.map(({ init }) =>
        new Headers(init.headers).get("content-range"),
      ),
    ).toEqual([
      `bytes 0-${chunkSize - 1}/${bytes.byteLength}`,
      `bytes ${chunkSize}-${2 * chunkSize - 1}/${bytes.byteLength}`,
      `bytes ${2 * chunkSize}-${bytes.byteLength - 1}/${bytes.byteLength}`,
    ]);
    expect(
      sessionCalls.map(
        ({ init }) => (init.body as Uint8Array | undefined)?.byteLength,
      ),
    ).toEqual([chunkSize, chunkSize, 1024 * 1024]);
  });

  it("returns only app-property matches inside the configured root", async () => {
    const metadata: Record<string, unknown> = {
      session: {
        id: "session",
        name: "session.md",
        mimeType: "text/markdown",
        parents: ["web"],
        modifiedTime: "2026-07-19T10:00:00.000Z",
        appProperties: { brainhubKey: "key-1" },
      },
      web: {
        id: "web",
        name: "web-personal",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["inbox"],
      },
      inbox: {
        id: "inbox",
        name: "inbox",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      },
    };
    const http = new HandlerHttp((path) => {
      if (path.startsWith("/files?")) return { files: [metadata.session] };
      const id = path.match(/^\/files\/([^?]+)/u)?.[1];
      if (id && metadata[id]) return metadata[id];
      throw new Error(`Unexpected ${path}`);
    });
    const drive = new GoogleDriveGateway(http).forRoot("root");

    await expect(
      drive.listByAppProperty("brainhubKey", "key-1"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "session",
        path: "inbox/web-personal/session.md",
      }),
    ]);
  });

  it("renames a file in place without adding and removing the same parent", async () => {
    const metadata: Record<string, unknown> = {
      candidate: {
        id: "candidate",
        name: ".candidate.tmp",
        mimeType: "text/markdown",
        parents: ["device"],
        modifiedTime: "2026-07-20T07:00:00.000Z",
        appProperties: { brainhubKey: "key-1" },
      },
      device: {
        id: "device",
        name: "web-personal",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["inbox"],
      },
      inbox: {
        id: "inbox",
        name: "inbox",
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      },
    };
    const http = new HandlerHttp((path, init) => {
      const method = init.method ?? "GET";
      const id = path.match(/^\/files\/([^?]+)/u)?.[1];
      if (method === "GET" && id && metadata[id]) return metadata[id];
      if (method === "GET" && path.startsWith("/files?")) {
        return { files: [metadata.device] };
      }
      if (method === "PATCH" && id === "candidate") {
        const query = new URL(`https://drive.test${path}`).searchParams;
        expect(query.has("addParents")).toBe(false);
        expect(query.has("removeParents")).toBe(false);
        expect(JSON.parse(String(init.body))).toEqual({
          name: "chatgpt-web-20260720-conversa.md",
        });
        return {
          ...(metadata.candidate as Record<string, unknown>),
          name: "chatgpt-web-20260720-conversa.md",
        };
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    const drive = new GoogleDriveGateway(http).forRoot("root");

    await expect(
      drive.move(
        "candidate",
        "inbox/web-personal/chatgpt-web-20260720-conversa.md",
      ),
    ).resolves.toMatchObject({
      id: "candidate",
      path: "inbox/web-personal/chatgpt-web-20260720-conversa.md",
    });
  });
});
