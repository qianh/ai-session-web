import { describe, expect, it } from "vitest";

import {
  DrivePathResolver,
  type DriveFolderApi,
  type DriveFileMetadata,
} from "../../../src/drive/paths";

class MemoryFolders implements DriveFolderApi {
  readonly files: DriveFileMetadata[] = [];
  #id = 0;

  async listFolders(name: string, parentId?: string) {
    return this.files.filter(
      (file) =>
        file.name === name &&
        file.mimeType === "application/vnd.google-apps.folder" &&
        (parentId === undefined || file.parents?.includes(parentId)),
    );
  }

  async createFolder(name: string, parentId?: string) {
    const file: DriveFileMetadata = {
      id: `folder-${++this.#id}`,
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId === undefined ? {} : { parents: [parentId] }),
    };
    this.files.push(file);
    return file;
  }
}

describe("DrivePathResolver", () => {
  it("creates the BrainHub root once and reuses it", async () => {
    const api = new MemoryFolders();
    const resolver = new DrivePathResolver(api);

    const first = await resolver.ensureRoot("brain-hub");
    const second = await resolver.ensureRoot("brain-hub");

    expect(second).toBe(first);
    expect(api.files).toHaveLength(1);
  });

  it("creates nested folders relative to the configured root", async () => {
    const api = new MemoryFolders();
    const resolver = new DrivePathResolver(api);
    const root = await resolver.ensureRoot("brain-hub");

    const inbox = await resolver.ensureFolderPath(root, "inbox/web-personal");
    const same = await resolver.ensureFolderPath(root, "inbox/web-personal");

    expect(inbox).toBe(same);
    expect(api.files.map((file) => file.name)).toEqual([
      "brain-hub",
      "inbox",
      "web-personal",
    ]);
  });

  it("rejects paths that can escape the BrainHub root", async () => {
    const api = new MemoryFolders();
    const resolver = new DrivePathResolver(api);
    const root = await resolver.ensureRoot("brain-hub");

    await expect(resolver.ensureFolderPath(root, "../other")).rejects.toThrow(
      "relative",
    );
    await expect(resolver.ensureFolderPath(root, "/other")).rejects.toThrow(
      "relative",
    );
  });
});
