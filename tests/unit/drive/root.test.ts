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
});
