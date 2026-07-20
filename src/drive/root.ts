import type { DriveFolderApi } from "./paths";

export async function ensureBrainHubRoot(
  drive: Pick<DriveFolderApi, "listFolders" | "createFolder">,
): Promise<string> {
  const existing = await drive.listFolders("brain-hub");
  const winner = [...existing].sort((left, right) =>
    left.id.localeCompare(right.id),
  )[0];
  if (winner) return winner.id;
  return (await drive.createFolder("brain-hub")).id;
}
