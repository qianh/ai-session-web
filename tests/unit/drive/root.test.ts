import { describe, expect, it, vi } from "vitest";

import { ensureBrainHubRoot } from "../../../src/drive/root";

describe("ensureBrainHubRoot", () => {
  it("reuses an existing app-visible root and creates it only once", async () => {
    const existing = { id: "root-1", name: "brain-hub", mimeType: "folder" };
    const listFolders = vi.fn(async () => [existing]);
    const createFolder = vi.fn();

    await expect(
      ensureBrainHubRoot({ listFolders, createFolder }),
    ).resolves.toBe("root-1");
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("creates brain-hub when Drive is empty", async () => {
    const createFolder = vi.fn(async () => ({
      id: "root-new",
      name: "brain-hub",
      mimeType: "folder",
    }));

    await expect(
      ensureBrainHubRoot({ listFolders: vi.fn(async () => []), createFolder }),
    ).resolves.toBe("root-new");
    expect(createFolder).toHaveBeenCalledWith("brain-hub");
  });

  it("requires an explicit choice when duplicate roots exist", async () => {
    const roots = [
      { id: "root-b", name: "brain-hub", mimeType: "folder" },
      { id: "root-a", name: "brain-hub", mimeType: "folder" },
    ];
    const drive = {
      listFolders: vi.fn(async () => roots),
      createFolder: vi.fn(),
    };

    await expect(ensureBrainHubRoot(drive)).rejects.toMatchObject({
      code: "DRIVE_ROOT_CONFLICT",
      candidates: [roots[1], roots[0]],
    });
    await expect(ensureBrainHubRoot(drive, "root-b")).resolves.toBe("root-b");
    expect(drive.createFolder).not.toHaveBeenCalled();
  });
});
