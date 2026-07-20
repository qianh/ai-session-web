export interface DriveEntry {
  id: string;
  path: string;
  mimeType: string;
  modifiedTime: string;
  appProperties: Record<string, string>;
}

export interface DriveObject extends DriveEntry {
  bytes: Uint8Array;
}

export interface DrivePutInput {
  path: string;
  bytes: Uint8Array;
  mimeType: string;
  appProperties?: Record<string, string>;
}

export interface DrivePort {
  listByAppProperty(key: string, value: string): Promise<DriveEntry[]>;
  put(input: DrivePutInput): Promise<DriveEntry>;
  read(id: string): Promise<DriveObject>;
  move(id: string, path: string): Promise<DriveEntry>;
  trash(id: string): Promise<void>;
}
