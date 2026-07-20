export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
}

export interface DriveFolderApi {
  listFolders(name: string, parentId?: string): Promise<DriveFileMetadata[]>;
  createFolder(name: string, parentId?: string): Promise<DriveFileMetadata>;
}

function pathSegments(path: string): string[] {
  if (!path || path.startsWith("/") || path.includes("\\")) {
    throw new Error("Drive path must be relative to the BrainHub root");
  }
  const segments = path.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Drive path must be relative to the BrainHub root");
  }
  return segments;
}

export class DrivePathResolver {
  constructor(readonly api: DriveFolderApi) {}

  async ensureRoot(name: string): Promise<string> {
    const existing = (await this.api.listFolders(name)).sort((left, right) =>
      right.id.localeCompare(left.id),
    )[0];
    const folder = existing ?? (await this.api.createFolder(name));
    return folder.id;
  }

  async ensureFolderPath(rootId: string, path: string): Promise<string> {
    let parentId = rootId;
    for (const segment of pathSegments(path)) {
      const existing = (await this.api.listFolders(segment, parentId)).sort(
        (left, right) => right.id.localeCompare(left.id),
      )[0];
      const folder =
        existing ?? (await this.api.createFolder(segment, parentId));
      parentId = folder.id;
    }
    return parentId;
  }
}
