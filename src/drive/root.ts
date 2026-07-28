import type { DriveFileMetadata, DriveFolderApi } from "./paths";

export class DriveRootConflictError extends Error {
  readonly code = "DRIVE_ROOT_CONFLICT";

  constructor(readonly candidates: DriveFileMetadata[]) {
    super("Multiple brain-hub folders require an explicit choice");
    this.name = "DriveRootConflictError";
  }
}

export async function ensureBrainHubRoot(
  drive: Pick<DriveFolderApi, "listFolders" | "createFolder">,
  selectedId?: string,
): Promise<string> {
  const existing = [...(await drive.listFolders("brain-hub"))].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  if (selectedId) {
    const selected = existing.find((folder) => folder.id === selectedId);
    if (!selected) throw new Error("Selected brain-hub folder is unavailable");
    return selected.id;
  }
  if (existing.length > 1) throw new DriveRootConflictError(existing);
  const winner = existing[0];
  if (winner) return winner.id;
  return (await drive.createFolder("brain-hub")).id;
}
