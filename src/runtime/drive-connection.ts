import type { DriveFolderApi } from "../drive/paths";
import { DriveApiError } from "../drive/rest-client";
import { DriveRootConflictError, ensureBrainHubRoot } from "../drive/root";
import { DEVELOPMENT_OAUTH_CLIENT_ID } from "../platform/manifest";
import type { StateStore } from "../state/store";

interface InteractiveTokenProvider {
  connect(): Promise<string>;
}

interface DriveConnectionOptions {
  oauthClientId: string;
  tokenProvider: InteractiveTokenProvider;
  drive: Pick<DriveFolderApi, "listFolders" | "createFolder"> & {
    getAccount(): Promise<{
      email: string;
      displayName: string;
      permissionId: string;
    }>;
  };
  store: StateStore;
  now?: () => Date;
}

export class DriveConnectionError extends Error {
  constructor(
    readonly code: string,
    readonly diagnosticCause?: unknown,
  ) {
    super(code);
    this.name = "DriveConnectionError";
  }
}

function driveConnectionErrorCode(error: unknown): string {
  if (error instanceof DriveApiError && error.status === 403) {
    return "DRIVE_PERMISSION_DENIED";
  }
  if (error instanceof TypeError) return "DRIVE_NETWORK_FAILED";
  return "DRIVE_CONNECT_FAILED";
}

function driveDiagnostic(
  error: unknown,
  stage: "oauth" | "drive-root",
): { stage: "oauth" | "drive-root"; name: string; message: string } {
  const name = error instanceof Error ? error.name : typeof error;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .slice(0, 240);
  return {
    stage,
    name: (name || "UnknownError").slice(0, 64),
    message: message || "Unknown error",
  };
}

export class DriveConnectionService {
  readonly #options: DriveConnectionOptions;

  constructor(options: DriveConnectionOptions) {
    this.#options = options;
  }

  async connect(selectedRootId?: string): Promise<string> {
    if (
      !this.#options.oauthClientId ||
      this.#options.oauthClientId === DEVELOPMENT_OAUTH_CLIENT_ID
    ) {
      throw new DriveConnectionError("OAUTH_CLIENT_ID_REQUIRED");
    }
    let stage: "oauth" | "drive-root" = "oauth";
    try {
      try {
        await this.#options.tokenProvider.connect();
      } catch (error) {
        throw new DriveConnectionError("GOOGLE_AUTH_FAILED", error);
      }
      stage = "drive-root";
      const account = await this.#options.drive.getAccount();
      const rootFolderId = await ensureBrainHubRoot(
        this.#options.drive,
        selectedRootId,
      );
      const connectedAt = (
        this.#options.now ?? (() => new Date())
      )().toISOString();
      await this.#options.store.update((state) => ({
        ...state,
        drive: {
          status: "connected",
          rootFolderId,
          accountEmail: account.email,
          accountDisplayName: account.displayName,
          accountPermissionId: account.permissionId,
          connectedAt,
        },
      }));
      return rootFolderId;
    } catch (error) {
      const code =
        error instanceof DriveConnectionError
          ? error.code
          : error instanceof DriveRootConflictError
            ? error.code
            : driveConnectionErrorCode(error);
      await this.#options.store.update((state) => ({
        ...state,
        drive: {
          ...state.drive,
          status: "error",
          errorCode: code,
          ...(error instanceof DriveRootConflictError
            ? { rootCandidates: error.candidates }
            : {}),
          diagnostic: driveDiagnostic(
            error instanceof DriveConnectionError &&
              error.diagnosticCause !== undefined
              ? error.diagnosticCause
              : error,
            stage,
          ),
        },
      }));
      if (error instanceof DriveConnectionError) throw error;
      throw new DriveConnectionError(code, error);
    }
  }
}
